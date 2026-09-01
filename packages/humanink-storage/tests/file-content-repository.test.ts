import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AtomicCommitValidationError,
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
  title: 'Local content repository test',
  body: 'This is a paragraph used to verify JSONL persistence.',
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
    title: 'JSONL content project',
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    metadata: { category: 'self-media' },
  });
  const sourceVersion = createSourceVersion(project.id, project.id + '_source');
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
    const root = join(tmpdir(), 'humanink-storage-missing', Date.now() + '-' + Math.random());
    roots.push(root);

    const repository = new FileContentRepository(root);

    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, 'projects.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'versions.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'transactions.jsonl'))).toBe(true);
    expect(readFileSync(join(root, 'projects.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(root, 'versions.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(root, 'transactions.jsonl'), 'utf8')).toBe('');
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
      title: 'Project title after restart',
      updatedAt: new Date('2026-08-31T00:02:00.000Z'),
    });
    const derivedVersion = createContentVersion({
      id: 'project_one_draft',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'Draft', body: 'This is a draft generated from the source version.' },
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
    expect(rereadProject?.metadata.category).toBe('self-media');
    expect(rereadVersion?.content.body).toBe(sourceContent.body);
  });

  it('treats identical project and version writes as idempotent', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const project = createContentProject({
      id: 'project_idempotent',
      title: 'Idempotent project',
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
      content: { ...version.content, body: 'Different body' },
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
      title: 'Invalid current version',
      currentVersionId: 'missing_version',
    })).rejects.toBeInstanceOf(CurrentVersionNotFoundError);

    const first = await createProjectWithSource(repository, 'project_first');
    const second = await createProjectWithSource(repository, 'project_second');

    await expect(repository.saveVersion(createContentVersion({
      id: 'missing_parent',
      projectId: first.project.id,
      kind: 'draft',
      parentVersionId: 'missing_version',
      content: { title: 'Missing parent', body: 'This must not be persisted.' },
      createdBy: 'llm',
    }))).rejects.toBeInstanceOf(ParentVersionNotFoundError);

    await expect(repository.saveVersion(createContentVersion({
      id: 'cross_project_child',
      projectId: second.project.id,
      kind: 'draft',
      parentVersionId: first.sourceVersion.id,
      content: { title: 'Cross project parent', body: 'This must not be persisted.' },
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

  it('completes and confirms a prepared commit before returning from a recoverable failure', async () => {
    const root = createRoot();
    const initialRepository = new FileContentRepository(root);
    const { project, sourceVersion } = await createProjectWithSource(initialRepository, 'project_atomic_recovery');
    const derivedVersion = createContentVersion({
      id: 'version_atomic_recovery',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'Recovered draft', body: 'This version must not remain orphaned.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:03:00.000Z'),
    });
    const nextProject = {
      ...project,
      currentVersionId: derivedVersion.id,
      updatedAt: new Date('2026-08-31T00:03:00.000Z'),
    };
    const failingRepository = new FileContentRepository(root, {
      onAtomicCommitStage(stage) {
        if (stage === 'before-project-write') {
          throw new Error('injected project write failure');
        }
      },
    });

    await expect(failingRepository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_atomic_recovery',
      expectedCurrentVersionId: sourceVersion.id,
      version: derivedVersion,
      project: nextProject,
    })).resolves.toEqual(nextProject);

    expect(await failingRepository.getVersion(derivedVersion.id)).toEqual(derivedVersion);
    expect(await failingRepository.getProject(project.id)).toEqual(nextProject);
    expect(failingRepository.findCommittedVersionByOperationId('operation_atomic_recovery')).toEqual(derivedVersion);
    expect(readFileSync(join(root, 'transactions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);

    const reopenedRepository = new FileContentRepository(root);
    expect(await reopenedRepository.getProject(project.id)).toEqual(nextProject);
    expect(reopenedRepository.findCommittedVersionByOperationId('operation_atomic_recovery')).toEqual(derivedVersion);
  });

  it('reloads state under the writer lock and rejects a stale multi-instance commit', async () => {
    const root = createRoot();
    const setupRepository = new FileContentRepository(root);
    const { project, sourceVersion } = await createProjectWithSource(setupRepository, 'project_multi_instance');
    const firstRepository = new FileContentRepository(root);
    const staleRepository = new FileContentRepository(root);
    const firstVersion = createContentVersion({
      id: 'version_multi_first',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'First writer', body: 'The first writer advances the project.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:02:00.000Z'),
    });
    await firstRepository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_multi_first',
      expectedCurrentVersionId: sourceVersion.id,
      version: firstVersion,
      project: { ...project, currentVersionId: firstVersion.id, updatedAt: firstVersion.createdAt },
    });

    const staleVersion = createContentVersion({
      id: 'version_multi_stale',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'Stale writer', body: 'This stale writer must not roll the project back.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:03:00.000Z'),
    });
    await expect(staleRepository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_multi_stale',
      expectedCurrentVersionId: sourceVersion.id,
      version: staleVersion,
      project: { ...project, currentVersionId: staleVersion.id, updatedAt: staleVersion.createdAt },
    })).rejects.toBeInstanceOf(AtomicCommitValidationError);

    const reopenedRepository = new FileContentRepository(root);
    expect((await reopenedRepository.getProject(project.id))?.currentVersionId).toBe(firstVersion.id);
    expect(await reopenedRepository.getVersion(staleVersion.id)).toBeNull();
    expect(reopenedRepository.findCommittedVersionByOperationId('operation_multi_first')).toEqual(firstVersion);
    expect(reopenedRepository.findCommittedVersionByOperationId('operation_multi_stale')).toBeNull();
  });

  it('does not let recovery of an older prepared transaction overwrite a newer project state', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const { project, sourceVersion } = await createProjectWithSource(repository, 'project_recovery_order');
    const newerVersion = createContentVersion({
      id: 'version_committed_later',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'Newer version', body: 'This state must remain current.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:04:00.000Z'),
    });
    await repository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_committed_later',
      expectedCurrentVersionId: sourceVersion.id,
      version: newerVersion,
      project: { ...project, currentVersionId: newerVersion.id, updatedAt: newerVersion.createdAt },
    });

    const pendingVersion = createContentVersion({
      id: 'version_pending_older',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: sourceVersion.id,
      content: { title: 'Older pending version', body: 'Recovery may preserve this version, but not make it current.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:02:00.000Z'),
    });
    const pendingProject = { ...project, currentVersionId: pendingVersion.id, updatedAt: pendingVersion.createdAt };
    const pendingPrepare = {
      id: 'transaction_pending_older',
      type: 'prepare',
      mode: 'update',
      operationId: 'operation_pending_older',
      expectedCurrentVersionId: sourceVersion.id,
      project: {
        ...pendingProject,
        createdAt: pendingProject.createdAt.toISOString(),
        updatedAt: pendingProject.updatedAt.toISOString(),
      },
      version: {
        ...pendingVersion,
        createdAt: pendingVersion.createdAt.toISOString(),
      },
    };
    const transactionPath = join(root, 'transactions.jsonl');
    const committedTransactions = readFileSync(transactionPath, 'utf8');
    writeFileSync(transactionPath, JSON.stringify(pendingPrepare) + '\n' + committedTransactions, 'utf8');

    const recoveredRepository = new FileContentRepository(root);
    expect((await recoveredRepository.getProject(project.id))?.currentVersionId).toBe(newerVersion.id);
    expect(await recoveredRepository.getVersion(pendingVersion.id)).toEqual(pendingVersion);
    expect(recoveredRepository.findCommittedVersionByOperationId('operation_pending_older')).toEqual(pendingVersion);
    expect(recoveredRepository.findCommittedVersionByOperationId('operation_committed_later')).toEqual(newerVersion);
  });

  it('removes a stale writer lock before loading and recovering storage', () => {
    const root = createRoot();
    new FileContentRepository(root);
    const lockPath = join(root, '.content-repository.lock');
    writeFileSync(lockPath, JSON.stringify({
      pid: 2147483647,
      token: 'abandoned-lock',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }), 'utf8');

    expect(() => new FileContentRepository(root, { staleLockMs: 1_000 })).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('writes no project, version, or transaction record when atomic validation fails', async () => {
    const root = createRoot();
    const repository = new FileContentRepository(root);
    const { project } = await createProjectWithSource(repository, 'project_atomic_validation');
    const invalidVersion = createContentVersion({
      id: 'version_invalid_atomic',
      projectId: project.id,
      kind: 'draft',
      parentVersionId: 'version_missing',
      content: { title: 'Invalid draft', body: 'This must never be persisted.' },
      createdBy: 'llm',
      createdAt: new Date('2026-08-31T00:03:00.000Z'),
    });
    const before = {
      projects: readFileSync(join(root, 'projects.jsonl'), 'utf8'),
      versions: readFileSync(join(root, 'versions.jsonl'), 'utf8'),
      transactions: readFileSync(join(root, 'transactions.jsonl'), 'utf8'),
    };

    await expect(repository.commitVersionAndProject({
      mode: 'update',
      version: invalidVersion,
      project: {
        ...project,
        currentVersionId: invalidVersion.id,
        updatedAt: invalidVersion.createdAt,
      },
    })).rejects.toBeInstanceOf(ParentVersionNotFoundError);

    expect(await repository.getVersion(invalidVersion.id)).toBeNull();
    expect(await repository.getProject(project.id)).toEqual(project);
    expect(readFileSync(join(root, 'projects.jsonl'), 'utf8')).toBe(before.projects);
    expect(readFileSync(join(root, 'versions.jsonl'), 'utf8')).toBe(before.versions);
    expect(readFileSync(join(root, 'transactions.jsonl'), 'utf8')).toBe(before.transactions);
  });
});
