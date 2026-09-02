import { describe, expect, it, vi } from 'vitest';
import { createHumanInkRpcHandler, registerHumanInkUiRpc, type HumanInkUiRouteFacade } from '../src/ui/humanink-ui-transport.js';

function facade(overrides: Partial<HumanInkUiRouteFacade> = {}): HumanInkUiRouteFacade {
  return {
    listProjects: vi.fn(async () => []),
    getProject: vi.fn(async () => null),
    createProject: vi.fn(async () => ({ project: { id: 'project-1' }, sourceVersion: { id: 'version-1' } } as never)),
    saveManualEdit: vi.fn(async () => ({ id: 'version-manual' } as never)),
    restoreVersion: vi.fn(async () => ({ id: 'version-restored' } as never)),
    runWorkflow: vi.fn(() => ({ id: 'task-1', status: 'queued' } as never)),
    listTasks: vi.fn(() => []),
    cancelTask: vi.fn(() => true),
    exportMarkdown: vi.fn(async () => '# 标题\n\n正文\n'),
    ...overrides,
  };
}

const activeSignal = new AbortController().signal;

describe('HumanInk UI Connection RPC', () => {
  it('dispatches project reads over the dedicated channel handler', async () => {
    const listProjects = vi.fn(async () => [{ id: 'project-1', title: '文章' } as never]);
    const handler = createHumanInkRpcHandler(facade({ listProjects }));

    await expect(handler('projects/list', {}, activeSignal)).resolves.toEqual({
      ok: true,
      value: [{ id: 'project-1', title: '文章' }],
    });
  });

  it('dispatches manual saves, workflows, cancellation, restore, and export', async () => {
    const target = facade();
    const handler = createHumanInkRpcHandler(target);

    await handler('versions/save', {
      projectId: 'project-1', parentVersionId: 'version-1', title: '新标题', body: '新正文',
    }, activeSignal);
    await handler('workflow/run', {
      projectId: 'project-1', workflow: 'humanize', versionId: 'version-1',
    }, activeSignal);
    await handler('tasks/cancel', { taskId: 'task-1' }, activeSignal);
    await handler('versions/restore', { projectId: 'project-1', versionId: 'version-1' }, activeSignal);
    const exported = await handler('export/markdown', { versionId: 'version-1' }, activeSignal);

    expect(target.saveManualEdit).toHaveBeenCalledWith({
      projectId: 'project-1', parentVersionId: 'version-1', title: '新标题', body: '新正文',
    });
    expect(target.runWorkflow).toHaveBeenCalledWith({
      projectId: 'project-1', workflow: 'humanize', versionId: 'version-1',
    });
    expect(target.cancelTask).toHaveBeenCalledWith('task-1');
    expect(target.restoreVersion).toHaveBeenCalledWith('project-1', 'version-1');
    expect(exported).toEqual({ ok: true, value: '# 标题\n\n正文\n' });
  });

  it('returns stable failures for invalid, cancelled, and internal requests', async () => {
    const handler = createHumanInkRpcHandler(facade({
      listProjects: vi.fn(async () => { throw new Error('secret provider message'); }),
    }));
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(handler('unknown', {}, activeSignal)).resolves.toMatchObject({
      ok: false, error: { code: 'humanink/bad-request' },
    });
    await expect(handler('projects/list', {}, cancelled.signal)).resolves.toMatchObject({
      ok: false, error: { code: 'gateway/cancelled' },
    });
    const failed = await handler('projects/list', {}, activeSignal);
    expect(failed).toMatchObject({ ok: false, error: { code: 'humanink/internal' } });
    expect(JSON.stringify(failed)).not.toContain('secret provider message');
  });

  it('registers the dedicated authenticated Connection channel and returns its disposer', () => {
    const dispose = vi.fn(async () => undefined);
    const handle = vi.fn(() => dispose);
    const routeDispose = registerHumanInkUiRpc({ rpc: { handle } }, facade() as never);

    expect(handle).toHaveBeenCalledWith('/humanink', expect.any(Function));
    expect(routeDispose).toBe(dispose);
  });
});
