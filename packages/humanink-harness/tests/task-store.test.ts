import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTaskStore } from '../src/services/file-task-store.js';
import { TaskRuntime, type TaskRecord } from '../src/runtime/task-runtime.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'humanink-task-store-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('FileTaskStore', () => {
  it('persists task transitions as JSONL and restores the latest snapshot', async () => {
    const root = createRoot();
    const store = new FileTaskStore(root);
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_persisted`,
      clock: () => new Date('2026-09-01T01:00:00.000Z'),
      store,
    });

    const task = runtime.start({ projectId: 'project_1', type: 'draft' }, async ({ update }) => {
      update({ contentVersionId: 'version_9' });
      return { contentVersionId: 'version_9' };
    });
    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({ status: 'succeeded' });

    const lines = readFileSync(join(root, 'tasks.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const restarted = new TaskRuntime({ store });
    expect(restarted.get(task.id)).toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_9',
    });
    expect(Object.isFrozen(restarted.get(task.id))).toBe(true);
  });

  it('persists the cancelling snapshot and cancellation timestamp', async () => {
    const root = createRoot();
    const store = new FileTaskStore(root);
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_cancelling`,
      clock: () => new Date('2026-09-01T01:00:30.000Z'),
      store,
    });
    let releaseOperation: (() => void) | undefined;
    const operationRelease = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });

    const task = runtime.start(
      { projectId: 'project_1', type: 'review' },
      async ({ signal }) => {
        await operationRelease;
        if (signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
      },
    );
    await runtime.waitForStatus(task.id, 'running');

    expect(runtime.cancel(task.id)).toBe(true);
    expect(runtime.cancel(task.id)).toBe(true);

    const records = readFileSync(join(root, 'tasks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as TaskRecord);
    expect(records.at(-1)).toMatchObject({
      id: task.id,
      status: 'running',
      cancellationRequested: true,
      cancelRequestedAt: '2026-09-01T01:00:30.000Z',
    });

    releaseOperation?.();
    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({ status: 'cancelled' });
  });
  it('recovers cancelling, committed, and interrupted non-terminal tasks deterministically', () => {
    const root = createRoot();
    const store = new FileTaskStore(root);
    const records: readonly TaskRecord[] = [
      {
        id: 'task_cancelling',
        operationId: 'op_cancelling',
        projectId: 'project_1',
        type: 'draft',
        status: 'running',
        cancellationRequested: true,
        cancelRequestedAt: '2026-09-01T00:58:00.000Z',
        startedAt: '2026-09-01T00:57:00.000Z',
      },
      {
        id: 'task_committed',
        operationId: 'op_committed',
        projectId: 'project_1',
        type: 'humanize',
        status: 'running',
        contentVersionId: 'version_committed',
        result: { contentVersionId: 'version_committed', payload: 'durable' },
        startedAt: '2026-09-01T00:59:00.000Z',
      },
      {
        id: 'task_interrupted',
        operationId: 'op_interrupted',
        projectId: 'project_1',
        type: 'outline',
        status: 'queued',
      },
    ];
    for (const record of records) {
      store.save(record);
    }

    const runtime = new TaskRuntime({
      store,
      clock: () => new Date('2026-09-01T01:01:00.000Z'),
    });

    expect(runtime.get('task_cancelling')).toMatchObject({
      status: 'cancelled',
      cancellationRequested: true,
      errorCode: 'TASK_CANCELLED',
      safeMessage: '任务已取消',
      cancelRequestedAt: '2026-09-01T00:58:00.000Z',
      finishedAt: '2026-09-01T01:01:00.000Z',
    });
    expect(runtime.get('task_committed')).toMatchObject({
      status: 'succeeded',
      contentVersionId: 'version_committed',
      result: { contentVersionId: 'version_committed', payload: 'durable' },
      finishedAt: '2026-09-01T01:01:00.000Z',
    });
    expect(runtime.get('task_interrupted')).toMatchObject({
      status: 'failed',
      errorCode: 'TASK_INTERRUPTED',
      safeMessage: '任务因进程中断而失败，请重新执行',
      finishedAt: '2026-09-01T01:01:00.000Z',
    });
  });
});
