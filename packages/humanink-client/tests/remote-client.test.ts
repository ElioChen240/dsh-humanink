import { describe, expect, it, vi } from 'vitest';
import { createHumanInkWorkbenchRemoteClient } from '../src/remote/client.js';

const version = { id: 'version-1', projectId: 'project-1', kind: 'source', content: { format: 'markdown', title: '标题', body: '正文' }, createdBy: 'user', createdAt: '2026-09-03T00:00:00.000Z' };
const project = { id: 'project-1', title: '标题', status: 'active', currentVersionId: 'version-1', updatedAt: '2026-09-03T01:00:00.000Z' };

describe('HumanInk typed workbench remote client', () => {
  it('maps the typed workbench channel into the existing UI API', async () => {
    const call = vi.fn(async (_channel: string, invocation: string) => {
      if (invocation === 'listContents') return { ok: true, value: [project] };
      if (invocation === 'getContent') return { ok: true, value: { project, currentVersion: version, versions: [version] } };
      if (invocation === 'startAction') return { ok: true, value: { id: 'task-1', projectId: 'project-1', type: 'title', status: 'queued', operationId: 'op-1' } };
      return { ok: true, value: version };
    });
    const api = createHumanInkWorkbenchRemoteClient({ call });
    await expect(api.listProjects()).resolves.toEqual([expect.objectContaining({ id: 'project-1', activeVersionId: 'version-1' })]);
    await expect(api.getProject('project-1')).resolves.toEqual(expect.objectContaining({ currentVersion: expect.objectContaining({ body: '正文' }), versions: [expect.objectContaining({ kind: 'source' })] }));
    await expect(api.runWorkflow({ projectId: 'project-1', workflow: 'titles', activeVersionId: 'version-1', versions: [version as never] })).resolves.toMatchObject({ id: 'task-1', action: 'titles' });
    expect(call).toHaveBeenCalledWith('/humanink/workbench', 'listContents', {}, undefined);
    expect(call).toHaveBeenCalledWith('/humanink/workbench', 'startAction', { contentId: 'project-1', action: 'titles', sourceVersionId: 'version-1' }, undefined);
  });

  it('maps stable remote errors without exposing payload details', async () => {
    const api = createHumanInkWorkbenchRemoteClient({ call: vi.fn(async () => ({ ok: false, error: { code: 'INTERNAL', message: 'Authorization: Bearer secret-token', retryable: false } })) });
    await expect(api.listProjects()).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(api.listProjects()).rejects.not.toThrow('secret-token');
  });

  it('passes AbortSignal through the client boundary', async () => {
    const call = vi.fn(async () => ({ ok: true, value: [] }));
    const controller = new AbortController();
    const api = createHumanInkWorkbenchRemoteClient({ call });
    await api.listProjects(controller.signal);
    expect(call).toHaveBeenCalledWith('/humanink/workbench', 'listContents', {}, controller.signal);
  });
});
