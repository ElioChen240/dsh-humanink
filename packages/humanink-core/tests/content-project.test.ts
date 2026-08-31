import { describe, expect, it } from 'vitest';
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