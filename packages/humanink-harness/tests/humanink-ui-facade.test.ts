import type {
  ContentProject,
  ContentProjectService,
  ContentRepository,
  ContentVersion,
  ContentVersionSummary,
  CreateProjectWithSourceRequest,
} from '@humanink/core';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectCreationResult } from '../src/runtime/humanink-application.js';
import type { TaskRecord } from '../src/runtime/task-runtime.js';
import {
  HumanInkUiFacade,
  type HumanInkUiFacadeDependencies,
} from '../src/ui/humanink-ui-facade.js';

function project(overrides: Partial<ContentProject> = {}): ContentProject {
  return {
    id: 'project-1',
    title: '一篇文章',
    status: 'active',
    currentVersionId: 'version-2',
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-09-02T08:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

function version(overrides: Partial<ContentVersion> = {}): ContentVersion {
  return {
    id: 'version-1',
    projectId: 'project-1',
    kind: 'source',
    content: {
      format: 'markdown',
      title: '一篇文章',
      body: '正文',
    },
    protectedFields: [],
    sourceRefs: [],
    createdBy: 'user',
    userConfirmed: true,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    contentHash: 'hash-version-1',
    ...overrides,
  };
}

function summary(item: ContentVersion): ContentVersionSummary {
  return {
    id: item.id,
    projectId: item.projectId,
    kind: item.kind,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    contentHash: item.contentHash,
    ...(item.parentVersionId === undefined ? {} : { parentVersionId: item.parentVersionId }),
  };
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    operationId: 'operation-1',
    projectId: 'project-1',
    type: 'draft',
    status: 'running',
    ...overrides,
  };
}

type UiApplication = HumanInkUiFacadeDependencies['application'];
type UiCatalog = HumanInkUiFacadeDependencies['catalog'];
type UiProjectService = HumanInkUiFacadeDependencies['projectService'];

function createDependencies(overrides: {
  application?: Partial<UiApplication>;
  catalog?: Partial<UiCatalog>;
  projectService?: Partial<UiProjectService>;
} = {}): HumanInkUiFacadeDependencies {
  const application: UiApplication = {
    createProject: vi.fn(),
    getProject: vi.fn(),
    getVersion: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(() => []),
    cancelTask: vi.fn(),
    exportVersion: vi.fn(),
    generateTitles: vi.fn(),
    generateBrief: vi.fn(),
    generateOutline: vi.fn(),
    generateDraft: vi.fn(),
    humanizeContent: vi.fn(),
    reviewContent: vi.fn(),
    ...overrides.application,
  };
  const catalog: UiCatalog = {
    listProjects: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    ...overrides.catalog,
  };
  const projectService: UiProjectService = {
    createDerivedVersion: vi.fn(),
    restoreVersion: vi.fn(),
    ...overrides.projectService,
  };

  return { application, catalog, projectService };
}

describe('HumanInkUiFacade', () => {
  it('lists projects through the injected project catalog', async () => {
    const projects = [project(), project({ id: 'project-2', title: '第二篇' })];
    const dependencies = createDependencies({
      catalog: { listProjects: vi.fn(async () => projects) },
    });
    const facade = new HumanInkUiFacade(dependencies);

    await expect(facade.listProjects()).resolves.toEqual(projects);
    expect(dependencies.catalog.listProjects).toHaveBeenCalledOnce();
  });

  it('reads a project together with complete versions and the current version', async () => {
    const source = version();
    const current = version({
      id: 'version-2',
      kind: 'draft',
      parentVersionId: source.id,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      contentHash: 'hash-version-2',
    });
    const item = project();
    const getVersion = vi.fn(async (versionId: string) => {
      return new Map([[source.id, source], [current.id, current]]).get(versionId) ?? null;
    });
    const dependencies = createDependencies({
      application: {
        getProject: vi.fn(async () => item),
        getVersion,
      },
      catalog: {
        listVersions: vi.fn(async () => [summary(source), summary(current)]),
      },
    });
    const facade = new HumanInkUiFacade(dependencies);

    await expect(facade.getProject(item.id)).resolves.toEqual({
      project: item,
      currentVersion: current,
      versions: [source, current],
    });
    expect(dependencies.application.getProject).toHaveBeenCalledWith(item.id);
    expect(dependencies.catalog.listVersions).toHaveBeenCalledWith(item.id);
    expect(getVersion).toHaveBeenCalledTimes(2);
  });

  it('returns null for a missing project without reading versions', async () => {
    const dependencies = createDependencies({
      application: { getProject: vi.fn(async () => null) },
    });
    const facade = new HumanInkUiFacade(dependencies);

    await expect(facade.getProject('missing')).resolves.toBeNull();
    expect(dependencies.catalog.listVersions).not.toHaveBeenCalled();
  });

  it('fails loudly when a listed version cannot be loaded', async () => {
    const source = version();
    const dependencies = createDependencies({
      application: {
        getProject: vi.fn(async () => project({ currentVersionId: source.id })),
        getVersion: vi.fn(async () => null),
      },
      catalog: { listVersions: vi.fn(async () => [summary(source)]) },
    });
    const facade = new HumanInkUiFacade(dependencies);

    await expect(facade.getProject('project-1')).rejects.toThrow(
      'Content version not found: version-1',
    );
  });

  it('creates projects through HumanInkApplication', async () => {
    const input: CreateProjectWithSourceRequest = {
      title: '新项目',
      source: { title: '新项目', body: '原始正文' },
    };
    const created: ProjectCreationResult = {
      project: project({ title: input.title }),
      sourceVersion: version({ content: { format: 'markdown', ...input.source } }),
    };
    const createProject = vi.fn(async () => created);
    const facade = new HumanInkUiFacade(createDependencies({
      application: { createProject },
    }));

    await expect(facade.createProject(input)).resolves.toEqual(created);
    expect(createProject).toHaveBeenCalledWith(input);
  });

  it('saves a manual edit as a user-confirmed derived version', async () => {
    const parent = version({
      id: 'version-parent',
      kind: 'humanized',
      protectedFields: ['brandName'],
      sourceRefs: ['source:https://example.com'],
    });
    const saved = version({
      id: 'version-manual',
      kind: 'draft',
      parentVersionId: parent.id,
      content: { format: 'markdown', title: '手工标题', body: '手工正文' },
    });
    const createDerivedVersion = vi.fn(async () => saved);
    const facade = new HumanInkUiFacade(createDependencies({
      application: { getVersion: vi.fn(async () => parent) },
      projectService: { createDerivedVersion },
    }));

    await expect(facade.saveManualEdit({
      projectId: parent.projectId,
      parentVersionId: parent.id,
      title: '手工标题',
      body: '手工正文',
    })).resolves.toEqual(saved);
    expect(createDerivedVersion).toHaveBeenCalledWith({
      projectId: parent.projectId,
      parentVersionId: parent.id,
      kind: 'draft',
      content: { format: 'markdown', title: '手工标题', body: '手工正文' },
      createdBy: 'user',
      userConfirmed: true,
      protectedFields: parent.protectedFields,
      sourceRefs: parent.sourceRefs,
    });
  });

  it('rejects a manual edit when its parent version is missing or belongs to another project', async () => {
    const missingFacade = new HumanInkUiFacade(createDependencies({
      application: { getVersion: vi.fn(async () => null) },
    }));
    await expect(missingFacade.saveManualEdit({
      projectId: 'project-1',
      parentVersionId: 'missing',
      title: '标题',
      body: '正文',
    })).rejects.toThrow('Content version not found: missing');

    const foreign = version({ projectId: 'project-2' });
    const mismatchedFacade = new HumanInkUiFacade(createDependencies({
      application: { getVersion: vi.fn(async () => foreign) },
    }));
    await expect(mismatchedFacade.saveManualEdit({
      projectId: 'project-1',
      parentVersionId: foreign.id,
      title: '标题',
      body: '正文',
    })).rejects.toThrow('Content version version-1 does not belong to project project-1');
  });

  it('delegates task queries, cancellation, and Markdown export to HumanInkApplication', async () => {
    const runningTask = task();
    const getTask = vi.fn(() => runningTask);
    const listTasks = vi.fn(() => [runningTask]);
    const cancelTask = vi.fn(() => true);
    const exportVersion = vi.fn(async () => '# 标题\n\n正文\n');
    const facade = new HumanInkUiFacade(createDependencies({
      application: { getTask, listTasks, cancelTask, exportVersion },
    }));

    expect(facade.getTask(runningTask.id)).toEqual(runningTask);
    expect(facade.listTasks(runningTask.projectId)).toEqual([runningTask]);
    expect(facade.cancelTask(runningTask.id)).toBe(true);
    await expect(facade.exportMarkdown('version-1')).resolves.toBe('# 标题\n\n正文\n');

    expect(getTask).toHaveBeenCalledWith(runningTask.id);
    expect(listTasks).toHaveBeenCalledWith(runningTask.projectId);
    expect(cancelTask).toHaveBeenCalledWith(runningTask.id);
    expect(exportVersion).toHaveBeenCalledWith('version-1');
  });
});
