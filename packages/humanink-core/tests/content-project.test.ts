import { describe, expect, it } from 'vitest';
import type { CommitVersionAndProjectInput, ContentRepository } from '../src/repository/content-repository.js';
import type { ContentVersion } from '../src/versioning/content-version.js';
import {
  ContentProjectService,
  InMemoryContentRepository,
  VersionConflictError,
  createContentVersion,
} from '../src/index.js';

const sourceInput = {
  title: '普通人的选择',
  body: '这是一段由用户提供的原始素材。',
};

function createService() {
  const repository = new InMemoryContentRepository();
  return {
    repository,
    service: new ContentProjectService(repository, {
      idFactory: (() => {
        let sequence = 0;
        return (prefix: string) => `${prefix}_${++sequence}`;
      })(),
      clock: (() => {
        let sequence = 0;
        return () => new Date(`2026-08-31T00:00:0${++sequence}.000Z`);
      })(),
    }),
  };
}

class FailingSourceRepository extends InMemoryContentRepository {
  override async commitVersionAndProject(
    input: CommitVersionAndProjectInput,
  ): Promise<import('../src/project/content-project.js').ContentProject> {
    if (input.version.kind === 'source') {
      throw new Error('source persistence failed');
    }
    return super.commitVersionAndProject(input);
  }
}

class LegacyRuntimeRepository implements ContentRepository {
  constructor(private readonly backing: InMemoryContentRepository) {}

  createProject: ContentRepository['createProject'] = (input) => this.backing.createProject(input);
  getProject: ContentRepository['getProject'] = (projectId) => this.backing.getProject(projectId);
  listProjects: ContentRepository['listProjects'] = () => this.backing.listProjects();
  updateProject: ContentRepository['updateProject'] = (project) => this.backing.updateProject(project);
  saveVersion: ContentRepository['saveVersion'] = (version) => this.backing.saveVersion(version);
  getVersion: ContentRepository['getVersion'] = (versionId) => this.backing.getVersion(versionId);
  listVersions: ContentRepository['listVersions'] = (projectId) => this.backing.listVersions(projectId);
}

class AtomicTrackingRepository extends InMemoryContentRepository {
  atomicCommitCalls = 0;
  legacyVersionWrites = 0;
  legacyProjectUpdates = 0;

  override async commitVersionAndProject(
    input: CommitVersionAndProjectInput,
  ): Promise<import('../src/project/content-project.js').ContentProject> {
    this.atomicCommitCalls += 1;
    return super.commitVersionAndProject(input);
  }

  override async saveVersion(version: ContentVersion): Promise<void> {
    this.legacyVersionWrites += 1;
    await super.saveVersion(version);
  }

  override async updateProject(
    project: import('../src/project/content-project.js').ContentProject,
  ): Promise<import('../src/project/content-project.js').ContentProject> {
    this.legacyProjectUpdates += 1;
    return super.updateProject(project);
  }
}
describe('content project versioning', () => {
  it('creates a project with an immutable source version', async () => {
    const { repository, service } = createService();

    const result = await service.createProject({
      title: '我的内容项目',
      source: sourceInput,
    });

    expect(result.project.currentVersionId).toBe(result.sourceVersion.id);
    expect(result.sourceVersion.kind).toBe('source');
    expect(result.sourceVersion.createdBy).toBe('user');
    expect(await repository.listVersions(result.project.id)).toHaveLength(1);
  });

  it('does not leave a dangling current-version pointer when source persistence fails', async () => {
    let idSequence = 0;
    const repository = new FailingSourceRepository();
    const service = new ContentProjectService(repository, {
      idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
      clock: () => new Date('2026-08-31T00:00:00.000Z'),
    });

    await expect(service.createProject({
      title: '失败项目',
      source: sourceInput,
    })).rejects.toThrow('source persistence failed');

    expect(await repository.getProject('project_1')).toBeNull();
    expect(await repository.getVersion('version_2')).toBeNull();
  });
  it('keeps repositories without the optional atomic capability runtime-compatible', async () => {
    let idSequence = 0;
    const backing = new InMemoryContentRepository();
    const repository = new LegacyRuntimeRepository(backing);
    const service = new ContentProjectService(repository, {
      idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
      clock: () => new Date(`2026-09-01T00:00:0${idSequence}.000Z`),
    });

    const created = await service.createProject({ title: 'Legacy project', source: sourceInput });
    const derived = await service.createDerivedVersion({
      projectId: created.project.id,
      parentVersionId: created.sourceVersion.id,
      kind: 'draft',
      content: { title: 'Legacy draft', body: 'Written through the legacy repository flow.' },
      createdBy: 'llm',
    });
    const restored = await service.restoreVersion({
      projectId: created.project.id,
      versionId: derived.id,
    });

    expect((await backing.getProject(created.project.id))?.currentVersionId).toBe(restored.id);
    expect(await backing.listVersions(created.project.id)).toHaveLength(3);
  });

  it('uses the atomic repository capability for source, derived, and restored versions', async () => {
    let idSequence = 0;
    const repository = new AtomicTrackingRepository();
    const service = new ContentProjectService(repository, {
      idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    });

    const created = await service.createProject({ title: 'Atomic project', source: sourceInput });
    const derived = await service.createDerivedVersion({
      projectId: created.project.id,
      parentVersionId: created.sourceVersion.id,
      kind: 'draft',
      content: { title: 'Draft', body: 'Derived body.' },
      createdBy: 'llm',
    });
    await service.restoreVersion({
      projectId: created.project.id,
      versionId: derived.id,
    });

    expect(repository.atomicCommitCalls).toBe(3);
    expect(repository.legacyVersionWrites).toBe(0);
    expect(repository.legacyProjectUpdates).toBe(0);
  });

  it('derives a new version without changing the parent version', async () => {
    const { repository, service } = createService();
    const { project, sourceVersion } = await service.createProject({
      title: '我的内容项目',
      source: sourceInput,
    });

    const derived = await service.createDerivedVersion({
      projectId: project.id,
      parentVersionId: sourceVersion.id,
      kind: 'humanized',
      content: {
        title: '更具体的标题',
        body: '这是保留原意后的候选稿。',
      },
      createdBy: 'llm',
    });

    expect(derived.parentVersionId).toBe(sourceVersion.id);
    expect(derived.id).not.toBe(sourceVersion.id);
    expect(derived.content.body).not.toBe(sourceVersion.content.body);
    expect((await repository.getVersion(sourceVersion.id))?.content.body).toBe(sourceVersion.content.body);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(derived.id);
  });

  it('rejects a parent version from another project', async () => {
    const { service } = createService();
    const first = await service.createProject({ title: '项目一', source: sourceInput });
    const second = await service.createProject({ title: '项目二', source: sourceInput });

    await expect(
      service.createDerivedVersion({
        projectId: second.project.id,
        parentVersionId: first.sourceVersion.id,
        kind: 'draft',
        content: sourceInput,
        createdBy: 'llm',
      }),
    ).rejects.toThrow('父版本不属于当前项目');
  });

  it('makes identical version writes idempotent and rejects conflicting writes', async () => {
    const repository = new InMemoryContentRepository();
    const version = createContentVersion({
      id: 'version_same',
      projectId: 'project_same',
      kind: 'source',
      content: sourceInput,
      createdBy: 'user',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    await repository.createProject({ id: version.projectId, title: '测试项目' });
    await repository.saveVersion(version);
    await repository.saveVersion(version);

    await expect(
      repository.saveVersion({
        ...version,
        content: { ...version.content, body: '被篡改的内容' },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});
