import { describe, expect, it } from 'vitest';
import { TaskRuntime } from '../src/runtime/task-runtime.js';

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

  it('cancels a running task and exposes a stable cancellation state', async () => {
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
    expect(runtime.get(task.id)).toMatchObject({ status: 'cancelled' });
    release?.();

    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
      safeMessage: '任务已取消',
    });
    expect(runtime.cancel(task.id)).toBe(false);
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

});
