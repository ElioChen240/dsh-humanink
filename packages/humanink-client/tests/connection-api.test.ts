import { describe, expect, it, vi } from 'vitest';
import { createHumanInkConnectionApi } from '../src/host-adapter.js';
import type { ContentVersion } from '../src/api.js';

const rawProject = {
  id: 'project-1', title: '测试文章', status: 'active', currentVersionId: 'draft-1',
  createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z', metadata: {},
};
const rawVersions = [
  { id: 'draft-1', projectId: 'project-1', kind: 'draft', parentVersionId: 'outline-1', content: { format: 'markdown', title: '测试文章', body: '正文' }, createdBy: 'llm', createdAt: '2026-09-02T08:00:00.000Z' },
  { id: 'outline-1', projectId: 'project-1', kind: 'outline', parentVersionId: 'brief-1', content: { format: 'markdown', title: '大纲', body: '一、开头' }, createdBy: 'llm', createdAt: '2026-09-02T07:00:00.000Z' },
  { id: 'brief-1', projectId: 'project-1', kind: 'brief', parentVersionId: 'source-1', content: { format: 'markdown', title: '简报', body: '{}' }, createdBy: 'llm', createdAt: '2026-09-02T06:00:00.000Z' },
  { id: 'source-1', projectId: 'project-1', kind: 'source', content: { format: 'markdown', title: '原始材料', body: '素材' }, createdBy: 'user', createdAt: '2026-09-01T08:00:00.000Z' },
];

describe('HumanInk Connection RPC adapter', () => {
  it('maps Core projects and project details into UI DTOs', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'projects/list'
      ? { ok: true, value: [rawProject] }
      : { ok: true, value: { project: rawProject, currentVersion: rawVersions[0], versions: rawVersions } });
    const api = createHumanInkConnectionApi({ call });
    const projects = await api.listProjects();
    const details = await api.getProject('project-1');
    expect(call).toHaveBeenNthCalledWith(1, '/humanink', 'projects/list', {}, undefined);
    expect(call).toHaveBeenNthCalledWith(2, '/humanink', 'projects/get', { projectId: 'project-1' }, undefined);
    expect(projects[0]).toMatchObject({ id: 'project-1', activeVersionId: 'draft-1', updatedAt: '2026-09-02T08:00:00.000Z' });
    expect(details.currentVersion).toMatchObject({ id: 'draft-1', kind: 'draft', title: '测试文章', body: '正文', createdBy: 'llm' });
    expect(details.versions).toHaveLength(4);
  });

  it('uses parentVersionId for saves and exposes restore/cancel/export endpoints', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'tasks/cancel') return { ok: true, value: true };
      if (endpoint === 'export/markdown') return { ok: true, value: '# 标题\n\n正文\n' };
      return { ok: true, value: rawVersions[0] };
    });
    const api = createHumanInkConnectionApi({ call });
    await api.saveVersion({ projectId: 'project-1', parentVersionId: 'draft-1', title: '手工标题', body: '手工正文' });
    await api.restoreVersion('project-1', 'source-1');
    await api.cancelTask('task-1');
    await api.exportMarkdown('draft-1');
    expect(call).toHaveBeenNthCalledWith(1, '/humanink', 'versions/save', { projectId: 'project-1', parentVersionId: 'draft-1', title: '手工标题', body: '手工正文' }, undefined);
    expect(call).toHaveBeenNthCalledWith(2, '/humanink', 'versions/restore', { projectId: 'project-1', versionId: 'source-1' }, undefined);
    expect(call).toHaveBeenNthCalledWith(3, '/humanink', 'tasks/cancel', { taskId: 'task-1' }, undefined);
    expect(call).toHaveBeenNthCalledWith(4, '/humanink', 'export/markdown', { versionId: 'draft-1' }, undefined);
  });

  it.each([
    ['titles', { projectId: 'project-1', workflow: 'titles', sourceVersionId: 'source-1' }],
    ['brief', { projectId: 'project-1', workflow: 'brief', sourceVersionId: 'source-1', selectedTitle: '选中的标题' }],
    ['outline', { projectId: 'project-1', workflow: 'outline', briefVersionId: 'brief-1' }],
    ['draft', { projectId: 'project-1', workflow: 'draft', briefVersionId: 'brief-1', outlineVersionId: 'outline-1' }],
    ['humanize', { projectId: 'project-1', workflow: 'humanize', versionId: 'draft-1' }],
    ['review', { projectId: 'project-1', workflow: 'review', versionId: 'draft-1' }],
  ] as const)('builds dependency-aware %s workflow payloads', async (workflow, expectedPayload) => {
    const call = vi.fn(async () => ({ ok: true, value: { id: 'task-1', projectId: 'project-1', type: workflow, status: 'queued', operationId: 'op-1' } }));
    const api = createHumanInkConnectionApi({ call });
    await api.runWorkflow({
      projectId: 'project-1', workflow, activeVersionId: 'draft-1', versions: rawVersions as unknown as ContentVersion[],
      ...(workflow === 'brief' ? { selectedTitle: '选中的标题' } : {}),
    });
    expect(call).toHaveBeenCalledWith('/humanink', 'workflow/run', expectedPayload, undefined);
  });

  it('maps task listing and reads nested host error messages', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [{ id: 'task-1', projectId: 'project-1', type: 'humanize', status: 'running', operationId: 'op-1' }] })
      .mockResolvedValueOnce({ ok: false, error: { code: 'humanink/internal', message: '主线程服务不可用', details: {} } });
    const api = createHumanInkConnectionApi({ call });
    await expect(api.listTasks('project-1')).resolves.toEqual([expect.objectContaining({ id: 'task-1', action: 'humanize', status: 'running' })]);
    await expect(api.listProjects()).rejects.toThrow('主线程服务不可用');
    expect(call).toHaveBeenNthCalledWith(1, '/humanink', 'tasks/list', { projectId: 'project-1' }, undefined);
  });

  it('rejects malformed envelopes at the adapter boundary', async () => {
    const api = createHumanInkConnectionApi({ call: vi.fn(async () => ({ data: [] })) });
    await expect(api.listProjects()).rejects.toThrow('Invalid HumanInk RPC response');
  });
});
