import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createContentProject,
  createContentVersion,
  type ContentRepository,
  type ContentVersion,
  CurrentVersionNotFoundError,
  ProjectConflictError,
  ParentVersionNotFoundError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  VersionConflictError,
} from '@humanink/core';
import { FileContentRepository } from '../src/index.js';

const roots: string[] = [];
const sourceContent = {
  title: '本地内容仓储测试',
  body: '这是一段用于验证 JSONL 持久化的正文。',
} as const;

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'humanink-storage-'));
  roots.push(root);
  return root;
}

function createSourceVersion(projectId: string, id: string, body = sourceContent.body): ContentVersion {
  return createContentVersion({
    id,
    projectId,
    kind: 'source',
    content: { ...sourceContent, body },
    createdBy: 'user',
    userConfirmed: true,
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
  });
}

async function createProjectWithSource(repository: ContentRepository, projectId = 'project_one') {
  const project = await repository.createProject({
    id: projectId,
    title: 'JSONL 内容项目',
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    metadata: { category: '自媒体' },
  });
  const sourceVersion = createSourceVersion(project.id, `${project.id}_source`);
  await repository.saveVersion(sourceVersion);
  const initializedProject = await repository.updateProject({
    ...project,
    currentVersionId: sourceVersion.id,
    updatedAt: new Date('2026-08-31T00:01:00.000Z'),
  });
  return { project: initializedProject, sourceVersion };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('FileContentRepository', () => {
  it('creates an empty storage directory and JSONL files on startup', async () => {
    const root = join(tmpdir(), 'humanink-storage-missing', `${Date.now()}-${Math.random()}`);
    roots.push(root);

    const repository = new FileContentRepository(root);

    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, 'projects.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'versions.jsonl'))).toBe(true);
    expect(readFileSync(join(root, 'projects.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(root, 'versions.jsonl'), 'utf8')).toBe('');
    expect(await repository.getProject('missing')).toBeNull();
    expect(await repository.getVersion('missing')).toBeNull();
    expect(await repository.listVersions('missing')).toEqual([]);
  });

  it('recovers the latest project and version records after a restart', async () => {
    const root = createRoot();
    const firstRepository = new FileContentRepository(root);
    const { project, sourceVersion } = await createProjectWithSource(firstRepository);
    const updatedProject = await firstRepository.updateProject({
      ...project,
      title: '重启后读取的项目',
      updatedAt: new Date('2026-08-31T00:02:00.000Z'),
    });
    const derivedVersion = createContentVersion({
      id: 'project_one_draft',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: '初稿', body: '这是从源版本派生的初稿。' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:03:00.000Z'),
      modelInfo: { model: 'test-model', usage: { totalTokens: 42 } },
    });
    await firstRepository.saveVersion(derivedVersion);

    const restartedRepository = new FileContentRepository(root);
    const recoveredProject = await restartedRepository.getProject(project.id);
    const recoveredSource = await restartedRepository.getVersion(sourceVersion.id);
    const recoveredDraft = await restartedRepository.getVersion(derivedVersion.id);

    expect(recoveredProject).toEqual(updatedProject);
    expect(recoveredSource).toEqual(sourceVersion);
    expect(recoveredDraft).toEqual(derivedVersion);
    expect(await restartedRepository.listVersions(project.id)).toHaveLength(2);
  });

  it('uses the last record for an id and returns deeply isolated immutable snapshots', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const { project, sourceVersion } = await createProjectWithSource(repository);

    const projectSnapshot = await repository.getProject(project.id);
    const versionSnapshot = await repository.getVersion(sourceVersion.id);
    const summaries = await repository.listVersions(project.id);

    expect(projectSnapshot).not.toBeNull();
    expect(versionSnapshot).not.toBeNull();
    expect(Object.isFrozen(projectSnapshot)).toBe(true);
    expect(Object.isFrozen(projectSnapshot?.metadata)).toBe(true);
    expect(Object.isFrozen(versionSnapshot)).toBe(true);
    expect(Object.isFrozen(versionSnapshot?.content)).toBe(true);
    expect(Object.isFrozen(summaries)).toBe(true);
    expect(Object.isFrozen(summaries[0])).toBe(true);

    expect(() => {
      (projectSnapshot as { metadata: Record<string, unknown> }).metadata.category = 'changed';
    }).toThrow();
    expect(() => {
      (versionSnapshot as { content: { body: string } }).content.body = 'changed';
    }).toThrow();

    const rereadProject = await repository.getProject(project.id);
    const rereadVersion = await repository.getVersion(sourceVersion.id);
    expect(rereadProject?.metadata.category).toBe('自媒体');
    expect(rereadVersion?.content.body).toBe(sourceContent.body);
  });

  it('treats identical project and version writes as idempotent', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const project = createContentProject({
      id: 'project_idempotent',
      title: '幂等项目',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
      updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    await repository.createProject(project);
    await expect(repository.createProject(project)).rejects.toBeInstanceOf(ProjectConflictError);

    const version = createSourceVersion(project.id, 'version_idempotent');
    await repository.saveVersion(version);
    await repository.saveVersion(version);

    expect(readFileSync(join(root, 'versions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('rejects conflicting writes without appending a new record', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const { project } = await createProjectWithSource(repository);
    const version = createSourceVersion(project.id, 'version_conflict');
    await repository.saveVersion(version);

    await expect(repository.saveVersion({
      ...version,
      content: { ...version.content, body: '不同正文' },
    })).rejects.toBeInstanceOf(VersionConflictError);

    expect(readFileSync(join(root, 'versions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('rejects invalid project and version references before writing', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);

    await expect(repository.saveVersion(createSourceVersion('missing_project', 'orphan')))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repository.createProject({
      id: 'invalid_current',
      title: '非法当前版本',
      currentVersionId: 'missing_version',
    })).rejects.toBeInstanceOf(CurrentVersionNotFoundError);

    const first = await createProjectWithSource(repository, 'project_first');
    const second = await createProjectWithSource(repository, 'project_second');

    await expect(repository.saveVersion(createContentVersion({
      id: 'missing_parent',
      projectId: first.project.id,
      kind: 'draft',
      parentVersionId: 'missing_version',
      content: { title: '缺失父版本', body: '不会被保存' },
      createdBy: 'llm',
    }))).rejects.toBeInstanceOf(ParentVersionNotFoundError);

    await expect(repository.saveVersion(createContentVersion({
      id: 'cross_project_child',
      projectId: second.project.id,
      kind: 'draft',
      parentVersionId: first.sourceVersion.id,
      content: { title: '跨项目父版本', body: '不会被保存' },
      createdBy: 'llm',
    }))).rejects.toBeInstanceOf(ProjectVersionMismatchError);

    await expect(repository.updateProject({
      ...first.project,
      currentVersionId: 'missing_version',
    })).rejects.toBeInstanceOf(CurrentVersionNotFoundError);
    await expect(repository.updateProject({
      ...first.project,
      currentVersionId: second.sourceVersion.id,
    })).rejects.toBeInstanceOf(ProjectVersionMismatchError);

    const restartedRepository = new FileContentRepository(root);
    expect(await restartedRepository.getVersion('orphan')).toBeNull();
    expect(await restartedRepository.getVersion('missing_parent')).toBeNull();
    expect(await restartedRepository.getVersion('cross_project_child')).toBeNull();
    expect(await restartedRepository.getProject('invalid_current')).toBeNull();
  });
});
