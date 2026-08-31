import { describe, expect, it } from 'vitest';
import { createContentProject } from '../src/project/content-project.js';
import { ContentProjectService } from '../src/project/content-project-service.js';
import {
  createContentVersion,
  deriveContentVersion,
  restoreContentVersion,
  type ContentVersion,
} from '../src/versioning/content-version.js';
import {
  InMemoryContentRepository,
  VersionConflictError,
} from '../src/repository/in-memory-content-repository.js';
import type { TextContentInput } from '../src/versioning/content-version.js';

const content: TextContentInput = {
  title: '首期标题',
  body: '首期正文',
};

function testDependencies() {
  let idSequence = 0;
  let timeSequence = 0;
  return {
    idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
    clock: () => new Date(`2026-08-31T00:00:0${++timeSequence}.000Z`),
  };
}

describe('humanink-core content project and versioning', () => {
  it('creates a project and immutable source version with injectable identity and time', async () => {
    const dependencies = testDependencies();
    const repository = new InMemoryContentRepository();
    const service = new ContentProjectService(repository, dependencies);

    const result = await service.createProject({ title: '我的项目', source: content });

    expect(result.project.id).toBe('project_1');
    expect(result.project.currentVersionId).toBe(result.sourceVersion.id);
    expect(result.sourceVersion.id).toBe('version_2');
    expect(result.sourceVersion.kind).toBe('source');
    expect(result.sourceVersion.createdBy).toBe('user');
    expect(result.sourceVersion.content.format).toBe('markdown');
    expect(result.sourceVersion.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await repository.listVersions(result.project.id)).toHaveLength(1);
  });

  it('makes saved versions deeply immutable and idempotent by content', async () => {
    const repository = new InMemoryContentRepository();
    const version = createContentVersion({
      id: 'version_same',
      projectId: 'project_same',
      kind: 'source',
      content,
      createdBy: 'user',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    await repository.createProject({ id: version.projectId, title: '项目' });
    await repository.saveVersion(version);
    await repository.saveVersion({
      ...version,
      content: { ...version.content },
      contentHash: 'incorrect-but-content-is-identical',
    });

    const stored = await repository.getVersion(version.id);
    expect(stored).not.toBeNull();
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.content)).toBe(true);
    expect(() => {
      if (stored) {
        (stored.content as { body: string }).body = 'changed';
      }
    }).toThrow();

    await expect(
      repository.saveVersion({
        ...version,
        content: { ...version.content, body: '不同正文' },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('derives a child without changing its parent and restores from history as a new version', () => {
    const dependencies = testDependencies();
    const parent = createContentVersion({
      id: 'version_parent',
      projectId: 'project_1',
      kind: 'source',
      content,
      createdBy: 'user',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    const derived = deriveContentVersion(parent, {
      kind: 'humanized',
      content: { title: '新标题', body: '新正文' },
      createdBy: 'llm',
    }, dependencies);
    const restored = restoreContentVersion(parent, { createdBy: 'user' }, dependencies);

    expect(derived.id).toBe('version_1');
    expect(derived.parentVersionId).toBe(parent.id);
    expect(derived.projectId).toBe(parent.projectId);
    expect(derived.kind).toBe('humanized');
    expect(derived.content.body).toBe('新正文');
    expect(restored.parentVersionId).toBe(parent.id);
    expect(restored.kind).toBe('restored');
    expect(restored.content).toEqual(parent.content);
    expect(parent.content.body).toBe('首期正文');
  });

  it('validates that a derived version parent exists and belongs to the project', async () => {
    const dependencies = testDependencies();
    const repository = new InMemoryContentRepository();
    const service = new ContentProjectService(repository, dependencies);
    const first = await service.createProject({ title: '项目一', source: content });
    const second = await service.createProject({ title: '项目二', source: content });

    await expect(
      service.createDerivedVersion({
        projectId: second.project.id,
        parentVersionId: first.sourceVersion.id,
        kind: 'draft',
        content,
        createdBy: 'llm',
      }),
    ).rejects.toThrow('父版本不属于当前项目');

    await expect(
      service.createDerivedVersion({
        projectId: second.project.id,
        parentVersionId: 'version_missing',
        kind: 'draft',
        content,
        createdBy: 'llm',
      }),
    ).rejects.toThrow('父版本不存在');
  });

  it('restores a historical version through the service and advances currentVersionId', async () => {
    const dependencies = testDependencies();
    const repository = new InMemoryContentRepository();
    const service = new ContentProjectService(repository, dependencies);
    const { project, sourceVersion } = await service.createProject({ title: '项目', source: content });
    const edited = await service.createDerivedVersion({
      projectId: project.id,
      parentVersionId: sourceVersion.id,
      kind: 'draft',
      content: { title: '编辑标题', body: '编辑正文' },
      createdBy: 'user',
    });

    const restored = await service.restoreVersion({
      projectId: project.id,
      versionId: sourceVersion.id,
      createdBy: 'user',
    });

    expect(restored.kind).toBe('restored');
    expect(restored.parentVersionId).toBe(sourceVersion.id);
    expect(restored.content).toEqual(sourceVersion.content);
    expect(restored.id).not.toBe(sourceVersion.id);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(restored.id);
    expect((await repository.getVersion(edited.id))?.content.body).toBe('编辑正文');
  });

  it('creates a project directly with immutable metadata', () => {
    const project = createContentProject({
      id: 'project_direct',
      title: '直接创建',
      metadata: { nested: { value: 'original' } },
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
      updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    expect(project.status).toBe('active');
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.metadata)).toBe(true);
    expect(Object.isFrozen((project.metadata as { nested: object }).nested)).toBe(true);
  });
});
