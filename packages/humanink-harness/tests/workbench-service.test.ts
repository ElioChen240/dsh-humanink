import { describe, expect, it, vi } from 'vitest';
import { HumanInkWorkbenchService } from '../src/application/workbench-service.js';

function project(id = 'project-1') {
  return { id, title: '文章', status: 'active' as const, currentVersionId: 'version-1', createdAt: new Date('2026-09-03T00:00:00Z'), updatedAt: new Date('2026-09-03T01:00:00Z'), metadata: {} };
}

function version(id = 'version-1') {
  return { id, projectId: 'project-1', kind: 'source' as const, content: { format: 'markdown' as const, title: '文章', body: '正文' }, protectedFields: [], sourceRefs: [], createdBy: 'user' as const, userConfirmed: true, createdAt: new Date('2026-09-03T00:00:00Z'), contentHash: 'hash' };
}

function application() {
  const task = { id: 'task-1', operationId: 'operation-1', projectId: 'project-1', type: 'title' as const, status: 'queued' as const };
  return {
    listProjects: vi.fn(async () => [project()]),
    getProject: vi.fn(async () => project()),
    listVersions: vi.fn(async () => [{ id: 'version-1', projectId: 'project-1', kind: 'source' as const, createdBy: 'user' as const, createdAt: new Date('2026-09-03T00:00:00Z'), contentHash: 'hash' }]),
    getVersion: vi.fn(async () => version()),
    createProject: vi.fn(async () => ({ project: project(), sourceVersion: version() })),
    createDerivedVersion: vi.fn(async () => version('version-2')),
    generateTitles: vi.fn(() => task),
    generateBrief: vi.fn(() => task),
    generateOutline: vi.fn(() => task),
    generateDraft: vi.fn(() => task),
    humanizeContent: vi.fn(() => task),
    reviewContent: vi.fn(() => task),
    getTask: vi.fn(() => task),
  };
}

describe('HumanInkWorkbenchService', () => {
  it('exposes content summaries and full current content through one facade', async () => {
    const app = application();
    const service = new HumanInkWorkbenchService({ application: app });
    await expect(service.listContents({})).resolves.toEqual([expect.objectContaining({ id: 'project-1', title: '文章', currentVersionId: 'version-1' })]);
    await expect(service.getContent('project-1')).resolves.toEqual(expect.objectContaining({ project: expect.objectContaining({ id: 'project-1' }), currentVersion: expect.objectContaining({ id: 'version-1' }) }));
  });

  it('delegates creation, version saves, actions, task reads, and AbortSignal', async () => {
    const app = application();
    const service = new HumanInkWorkbenchService({ application: app });
    const signal = new AbortController().signal;
    await service.createContent({ title: '文章', sourceBody: '正文' }, signal);
    await service.saveVersion({ contentId: 'project-1', parentVersionId: 'version-1', title: '新标题', body: '新正文' }, signal);
    const task = await service.startAction({ contentId: 'project-1', action: 'titles', sourceVersionId: 'version-1' }, signal);
    expect(task.id).toBe('task-1');
    expect(app.generateTitles).toHaveBeenCalledWith({ projectId: 'project-1', sourceVersionId: 'version-1', count: 5 }, signal);
    await expect(service.getTask('task-1', signal)).resolves.toEqual(expect.objectContaining({ id: 'task-1' }));
  });

  it('publishes baseline capabilities and a monotonic revision', async () => {
    const service = new HumanInkWorkbenchService({ application: application() });
    const first = await service.getRevision();
    await service.createContent({ title: '文章' });
    const second = await service.getRevision();
    expect(second).toBeGreaterThan(first);
    await expect(service.getCapabilities()).resolves.toMatchObject({ core: { state: 'ready' }, storage: { state: 'ready' } });
  });
});