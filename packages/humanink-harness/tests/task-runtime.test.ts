import { describe, expect, it, vi } from 'vitest';
import { TaskRuntime, type TaskRecord, type TaskStore } from '../src/runtime/task-runtime.js';
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((currentResolve) => {
    resolve = currentResolve;
  });
  return { promise, resolve };
}

describe('TaskRuntime', () => {
  it('runs a task through queued, running, and succeeded states', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_1`,
      clock: () => new Date('2026-08-31T12:00:00.000Z'),
    });
    const states: string[] = [];
    let receivedOperationId: string | undefined;

    const queued = runtime.start(
      { projectId: 'project_1', type: 'title' },
      async ({ signal, update, operationId }) => {
        receivedOperationId = operationId;
        states.push('operation-start');
        expect(signal.aborted).toBe(false);
        update({ contentVersionId: 'version_1' });
        return { contentVersionId: 'version_1' };
      },
    );

    expect(queued).toMatchObject({
      id: 'task_1',
      projectId: 'project_1',
      type: 'title',
      status: 'queued',
      operationId: 'task_1',
    });

    const succeeded = await runtime.waitForTerminal(queued.id);
    states.push(succeeded.status);

    expect(states).toEqual(['operation-start', 'succeeded']);
    expect(receivedOperationId).toBe(queued.operationId);
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_1',
      result: { contentVersionId: 'version_1' },
      startedAt: '2026-08-31T12:00:00.000Z',
      finishedAt: '2026-08-31T12:00:00.000Z',
    });
  });

  it('settles as cancelled when a running operation responds to cancellation', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_2`,
      clock: () => new Date('2026-08-31T12:01:00.000Z'),
    });
    let release: (() => void) | undefined;
    const operationReady = new Promise<void>((resolve) => {
      release = resolve;
    });

    const task = runtime.start(
      { projectId: 'project_1', type: 'draft' },
      async ({ signal }) => {
        await operationReady;
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
    );

    await runtime.waitForStatus(task.id, 'running');
    expect(runtime.cancel(task.id)).toBe(true);
    expect(runtime.get(task.id)).toMatchObject({
      status: 'running',
      cancellationRequested: true,
      cancelRequestedAt: '2026-08-31T12:01:00.000Z',
    });
    expect(runtime.cancel(task.id)).toBe(true);
    release?.();

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
      safeMessage: '任务已取消',
    });
    expect(runtime.cancel(task.id)).toBe(false);
  });

  it('settles as succeeded when cancellation arrives after an operation starts committing', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_commit_wins`,
      clock: () => new Date('2026-08-31T13:00:00.000Z'),
    });
    let notifyCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      notifyCommitStarted = resolve;
    });
    let releaseCommit: (() => void) | undefined;
    const commitFinished = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    const task = runtime.start(
      { projectId: 'project_1', type: 'humanize' },
      async ({ signal, update }) => {
        notifyCommitStarted?.();
        await commitFinished;
        expect(signal.aborted).toBe(true);
        update({ contentVersionId: 'version_committed' });
        return { contentVersionId: 'version_committed' };
      },
    );

    await commitStarted;
    expect(runtime.cancel(task.id)).toBe(true);
    expect(runtime.cancel(task.id)).toBe(true);
    expect(runtime.get(task.id)).toMatchObject({
      status: 'running',
      cancellationRequested: true,
    });

    releaseCommit?.();

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_committed',
      result: { contentVersionId: 'version_committed' },
      finishedAt: '2026-08-31T13:00:00.000Z',
    });
  });

  it('preserves allowlisted safe error codes without exposing provider details', async () => {
    const runtime = new TaskRuntime({ idFactory: (prefix) => `${prefix}_safe_error` });
    const task = runtime.start(
      { projectId: 'project_1', type: 'humanize' },
      async () => {
        throw Object.assign(new Error('raw provider secret'), { code: 'LLM_TIMEOUT' });
      },
    );

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'LLM_TIMEOUT',
      safeMessage: '模型请求超时，请稍后重试',
    });
    expect(JSON.stringify(runtime.get(task.id))).not.toContain('raw provider secret');
  });

  it('captures operation failures without exposing a stack trace in the task snapshot', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_3`,
      clock: () => new Date('2026-08-31T12:02:00.000Z'),
    });
    const task = runtime.start(
      { projectId: 'project_1', type: 'brief' },
      async () => {
        throw new Error('provider secret should not be rendered');
      },
    );

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'TASK_FAILED',
      safeMessage: '任务执行失败',
    });
    expect(runtime.get(task.id)).not.toHaveProperty('stack');
  });
  it('rejects a status wait that is impossible after the task has settled', async () => {
    const runtime = new TaskRuntime({ idFactory: (prefix) => `${prefix}_settled` });
    const task = runtime.start({ projectId: 'project_1', type: 'brief' }, async () => ({ ok: true }));
    await runtime.waitForTerminal(task.id);

    await expect(runtime.waitForStatus(task.id, 'running')).rejects.toThrow('settled as succeeded');
  }, 250);

  it('returns deeply isolated task results', async () => {
    const runtime = new TaskRuntime({ idFactory: (prefix) => `${prefix}_immutable` });
    const task = runtime.start({ projectId: 'project_1', type: 'draft' }, async () => ({ nested: { value: 1 } }));
    const settled = await runtime.waitForTerminal(task.id);
    const result = settled.result as { nested: { value: number } };

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nested)).toBe(true);
    expect(() => { result.nested.value = 2; }).toThrow();
    expect(runtime.get(task.id)?.result).toEqual({ nested: { value: 1 } });
  });

  it('cancels a pre-aborted task without invoking its operation', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => ({ ok: true }));
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_pre_aborted`,
      clock: () => new Date('2026-09-01T12:02:00.000Z'),
    });

    const task = runtime.start(
      { projectId: 'project_1', type: 'brief', signal: controller.signal },
      operation,
    );

    expect(task).toMatchObject({
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
      cancelRequestedAt: '2026-09-01T12:02:00.000Z',
    });
    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({ status: 'cancelled' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('cancels a queued task before the operation microtask starts', async () => {
    const operation = vi.fn(async () => ({ ok: true }));
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_queued_cancel`,
      clock: () => new Date('2026-09-01T12:03:00.000Z'),
    });

    const task = runtime.start({ projectId: 'project_1', type: 'outline' }, operation);
    expect(runtime.cancel(task.id)).toBe(true);
    expect(runtime.get(task.id)).toMatchObject({
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
      cancelRequestedAt: '2026-09-01T12:03:00.000Z',
    });

    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();
  });

  it('marks an ordinary operation error as failed even after cancellation was requested', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_cancel_then_fail`,
      clock: () => new Date('2026-09-01T13:01:00.000Z'),
    });
    const operationStarted = deferred();
    const releaseOperation = deferred();

    const task = runtime.start(
      { projectId: 'project_1', type: 'review' },
      async () => {
        operationStarted.resolve();
        await releaseOperation.promise;
        throw new Error('disk write failed');
      },
    );

    await operationStarted.promise;
    expect(runtime.cancel(task.id)).toBe(true);
    releaseOperation.resolve();

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'TASK_FAILED',
      safeMessage: '任务执行失败',
      cancelRequestedAt: '2026-09-01T13:01:00.000Z',
    });
  });

  it('removes the external abort listener after reaching a terminal state', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const runtime = new TaskRuntime({ idFactory: (prefix) => `${prefix}_listener_cleanup` });

    const task = runtime.start(
      { projectId: 'project_1', type: 'title', signal: controller.signal },
      async () => ({ ok: true }),
    );
    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({ status: 'succeeded' });

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(runtime.get(task.id)).toMatchObject({ status: 'succeeded' });
  });

  it('fails safely without invoking the operation when persisting running state fails', async () => {
    let saves = 0;
    const store: TaskStore = {
      load: () => [],
      save() {
        saves += 1;
        if (saves === 2) {
          throw new Error('disk unavailable');
        }
      },
    };
    const operation = vi.fn(async () => ({ ok: true }));
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_running_store_failure`,
      clock: () => new Date('2026-09-01T14:00:00.000Z'),
      store,
    });

    const task = runtime.start({ projectId: 'project_1', type: 'draft' }, operation);

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'TASK_STORE_FAILED',
      safeMessage: '任务状态保存失败，请重新执行',
      durability: 'failed',
      finishedAt: '2026-09-01T14:00:00.000Z',
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it('recovers a complete result checkpoint when persisting the terminal snapshot fails', async () => {
    const saved: TaskRecord[] = [];
    let saves = 0;
    const store: TaskStore = {
      load: () => saved,
      save(record) {
        saves += 1;
        if (saves === 5) {
          throw new Error('disk unavailable');
        }
        saved.push(record);
      },
    };
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_terminal_store_failure`,
      clock: () => new Date('2026-09-01T14:01:00.000Z'),
      store,
    });

    const task = runtime.start(
      { projectId: 'project_1', type: 'brief' },
      async ({ update }) => {
        update({ contentVersionId: 'version_1' });
        return { contentVersionId: 'version_1', payload: { summary: '完整结果' } };
      },
    );

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_1',
      result: { contentVersionId: 'version_1', payload: { summary: '完整结果' } },
      durability: 'failed',
      finishedAt: '2026-09-01T14:01:00.000Z',
    });
    expect(saved.at(-1)).toMatchObject({
      status: 'running',
      contentVersionId: 'version_1',
      result: { contentVersionId: 'version_1', payload: { summary: '完整结果' } },
    });

    const restarted = new TaskRuntime({ store });
    expect(restarted.get(task.id)).toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_1',
      result: { contentVersionId: 'version_1', payload: { summary: '完整结果' } },
    });
  });

  it('marks a recovered committed task without a durable result for manual recovery', () => {
    const store: TaskStore = {
      load: () => [{
        id: 'task_recovery_required',
        operationId: 'operation_recovery_required',
        projectId: 'project_1',
        type: 'humanize',
        status: 'running',
        startedAt: '2026-09-01T14:02:00.000Z',
      }],
      save() {},
    };
    const runtime = new TaskRuntime({
      store,
      clock: () => new Date('2026-09-01T14:03:00.000Z'),
      resolveCommittedVersionId: (operationId) =>
        operationId === 'operation_recovery_required' ? 'version_recovered' : null,
    });

    expect(runtime.get('task_recovery_required')).toMatchObject({
      status: 'failed',
      contentVersionId: 'version_recovered',
      errorCode: 'TASK_RECOVERY_REQUIRED',
      safeMessage: '内容已保存，但任务结果未完整持久化，请人工核对',
      finishedAt: '2026-09-01T14:03:00.000Z',
    });
  });
});
