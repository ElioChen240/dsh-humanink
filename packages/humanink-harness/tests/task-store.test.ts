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

  it('marks an interrupted queued or running task as failed during recovery', () => {
    const root = createRoot();
    const store = new FileTaskStore(root);
    const interrupted: TaskRecord = {
      id: 'task_interrupted',
      operationId: 'op_interrupted',
      projectId: 'project_1',
      type: 'outline',
      status: 'running',
      startedAt: '2026-09-01T00:59:00.000Z',
    };
    store.save(interrupted);

    const runtime = new TaskRuntime({
      store,
      clock: () => new Date('2026-09-01T01:01:00.000Z'),
    });

    expect(runtime.get(interrupted.id)).toMatchObject({
      status: 'failed',
      errorCode: 'TASK_INTERRUPTED',
      safeMessage: '任务因进程中断而失败，请重新执行',
      finishedAt: '2026-09-01T01:01:00.000Z',
    });
  });
});
