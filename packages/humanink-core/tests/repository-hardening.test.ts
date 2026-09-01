import { describe, expect, it } from 'vitest';
import { createContentProject } from '../src/project/content-project.js';
import { createContentVersion, type ContentVersion } from '../src/versioning/content-version.js';
import {
  CurrentVersionNotFoundError,
  InMemoryContentRepository,
  ParentVersionNotFoundError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  VersionConflictError,
} from '../src/repository/index.js';

const secretBody = 'sensitive-body-that-must-not-appear-in-errors';
const content = {
  title: 'Repository boundary test',
  body: secretBody,
} as const;

function makeVersion(input: Partial<ContentVersion> & Pick<ContentVersion, 'id' | 'projectId'>): ContentVersion {
  return createContentVersion({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind ?? 'source',
    content: input.content ?? content,
    createdBy: input.createdBy ?? 'user',
    createdAt: input.createdAt ?? new Date('2026-08-31T00:00:00.000Z'),
    ...(input.parentVersionId === undefined ? {} : { parentVersionId: input.parentVersionId }),
    ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
    ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
    ...(input.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: input.promptTemplateVersion }),
    ...(input.modelInfo === undefined ? {} : { modelInfo: input.modelInfo }),
    ...(input.userConfirmed === undefined ? {} : { userConfirmed: input.userConfirmed }),
  });
}

describe('InMemoryContentRepository hardening', () => {
  it('requires the owning project to exist before saving a version', async () => {
    const repository = new InMemoryContentRepository();

    await expect(repository.saveVersion(makeVersion({ id: 'version_orphan', projectId: 'project_missing' })))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('rejects missing parents without including content in the error', async () => {
    const repository = new InMemoryContentRepository();
    await repository.createProject({ id: 'project_parent', title: 'Parent project' });

    const error = await repository
      .saveVersion(makeVersion({
        id: 'version_child',
        projectId: 'project_parent',
        parentVersionId: 'version_missing',
      }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ParentVersionNotFoundError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secretBody);
  });

  it('rejects a parent from another project', async () => {
    const repository = new InMemoryContentRepository();
    await repository.createProject({ id: 'project_one', title: 'Project one' });
    await repository.createProject({ id: 'project_two', title: 'Project two' });
    await repository.saveVersion(makeVersion({ id: 'version_one', projectId: 'project_one' }));

    await expect(repository.saveVersion(makeVersion({
      id: 'version_two_child',
      projectId: 'project_two',
      parentVersionId: 'version_one',
    }))).rejects.toBeInstanceOf(ProjectVersionMismatchError);
  });

  it('rejects project-id changes and invalid or cross-project current versions', async () => {
    const repository = new InMemoryContentRepository();
    const projectOne = await repository.createProject({ id: 'project_one', title: 'Project one' });
    const projectTwo = await repository.createProject({ id: 'project_two', title: 'Project two' });
    await repository.saveVersion(makeVersion({ id: 'version_one', projectId: projectOne.id }));
    await repository.saveVersion(makeVersion({ id: 'version_two', projectId: projectTwo.id }));

    await expect(repository.updateProject({ ...projectOne, id: 'project_missing' }))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repository.updateProject({ ...projectOne, currentVersionId: 'version_missing' }))
      .rejects.toBeInstanceOf(CurrentVersionNotFoundError);
    await expect(repository.updateProject({ ...projectOne, currentVersionId: 'version_two' }))
      .rejects.toBeInstanceOf(ProjectVersionMismatchError);
  });

  it('rejects an invalid current version during project creation', async () => {
    const repository = new InMemoryContentRepository();

    await expect(repository.createProject({
      id: 'project_invalid_current',
      title: 'Invalid current version',
      currentVersionId: 'version_missing',
    })).rejects.toBeInstanceOf(CurrentVersionNotFoundError);
  });

  it('rejects a cross-project current version during project creation', async () => {
    const repository = new InMemoryContentRepository();
    await repository.createProject({ id: 'project_owner', title: 'Owner project' });
    await repository.saveVersion(makeVersion({ id: 'version_owner', projectId: 'project_owner' }));

    await expect(repository.createProject({
      id: 'project_other',
      title: 'Other project',
      currentVersionId: 'version_owner',
    })).rejects.toBeInstanceOf(ProjectVersionMismatchError);
  });
  it('validates an atomic version and project commit before exposing either change', async () => {
    const repository = new InMemoryContentRepository();
    const project = await repository.createProject({ id: 'project_atomic', title: 'Atomic project' });
    const source = makeVersion({ id: 'version_atomic_source', projectId: project.id });
    await repository.saveVersion(source);
    const initializedProject = await repository.updateProject({
      ...project,
      currentVersionId: source.id,
      updatedAt: new Date('2026-08-31T00:01:00.000Z'),
    });
    const derived = makeVersion({
      id: 'version_atomic_derived',
      projectId: project.id,
      parentVersionId: 'version_missing',
      kind: 'draft',
    });

    await expect(repository.commitVersionAndProject({
      mode: 'update',
      version: derived,
      project: {
        ...initializedProject,
        currentVersionId: derived.id,
        updatedAt: new Date('2026-08-31T00:02:00.000Z'),
      },
    })).rejects.toBeInstanceOf(ParentVersionNotFoundError);

    expect(await repository.getVersion(derived.id)).toBeNull();
    expect(await repository.getProject(project.id)).toEqual(initializedProject);
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('indexes an atomic commit by operationId without changing the public version record', async () => {
    const repository = new InMemoryContentRepository();
    const project = await repository.createProject({ id: 'project_operation', title: 'Operation project' });
    const source = makeVersion({ id: 'version_operation_source', projectId: project.id });
    await repository.saveVersion(source);
    const initializedProject = await repository.updateProject({
      ...project,
      currentVersionId: source.id,
      updatedAt: new Date('2026-08-31T00:01:00.000Z'),
    });
    const derived = makeVersion({
      id: 'version_operation_derived',
      projectId: project.id,
      parentVersionId: source.id,
      kind: 'draft',
      createdAt: new Date('2026-08-31T00:02:00.000Z'),
    });

    expect(repository.findCommittedVersionByOperationId('operation_1')).toBeNull();
    await repository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_1',
      expectedCurrentVersionId: source.id,
      version: derived,
      project: {
        ...initializedProject,
        currentVersionId: derived.id,
        updatedAt: derived.createdAt,
      },
    });

    const committed = repository.findCommittedVersionByOperationId('operation_1');
    expect(committed).toEqual(derived);
    expect(committed).not.toBe(derived);
    expect(committed).not.toHaveProperty('operationId');
  });

  it('rejects stale atomic project advancement and operationId reuse', async () => {
    const repository = new InMemoryContentRepository();
    const project = await repository.createProject({ id: 'project_compare_and_set', title: 'CAS project' });
    const source = makeVersion({ id: 'version_compare_source', projectId: project.id });
    await repository.saveVersion(source);
    const initializedProject = await repository.updateProject({
      ...project,
      currentVersionId: source.id,
      updatedAt: new Date('2026-08-31T00:01:00.000Z'),
    });
    const first = makeVersion({
      id: 'version_compare_first',
      projectId: project.id,
      parentVersionId: source.id,
      kind: 'draft',
      createdAt: new Date('2026-08-31T00:02:00.000Z'),
    });
    await repository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_compare',
      expectedCurrentVersionId: source.id,
      version: first,
      project: { ...initializedProject, currentVersionId: first.id, updatedAt: first.createdAt },
    });

    const stale = makeVersion({
      id: 'version_compare_stale',
      projectId: project.id,
      parentVersionId: source.id,
      kind: 'draft',
      createdAt: new Date('2026-08-31T00:03:00.000Z'),
    });
    await expect(repository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_stale',
      expectedCurrentVersionId: source.id,
      version: stale,
      project: { ...initializedProject, currentVersionId: stale.id, updatedAt: stale.createdAt },
    })).rejects.toThrow('current version changed');
    await expect(repository.commitVersionAndProject({
      mode: 'update',
      operationId: 'operation_compare',
      expectedCurrentVersionId: first.id,
      version: stale,
      project: { ...initializedProject, currentVersionId: stale.id, updatedAt: stale.createdAt },
    })).rejects.toThrow('operationId');

    expect(await repository.getVersion(stale.id)).toBeNull();
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(first.id);
  });

  it('returns an isolated immutable version list snapshot', async () => {
    const repository = new InMemoryContentRepository();
    const project = await repository.createProject({ id: 'project_list', title: 'List project' });
    await repository.saveVersion(makeVersion({ id: 'version_list', projectId: project.id }));

    const listed = await repository.listVersions(project.id);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(Object.isFrozen(listed[0]?.createdAt)).toBe(true);

    expect(() => (listed as Array<unknown>).push({})).toThrow();
    expect(() => {
      (listed[0] as { projectId: string }).projectId = 'project_changed';
    }).toThrow();
    listed[0]?.createdAt.setTime(new Date('2030-01-01T00:00:00.000Z').getTime());

    const reread = await repository.listVersions(project.id);
    expect(reread[0]?.projectId).toBe(project.id);
    expect(reread[0]?.createdAt).toEqual(new Date('2026-08-31T00:00:00.000Z'));
  });

  it('keeps identical writes idempotent but recognizes any version-record conflict', async () => {
    const repository = new InMemoryContentRepository();
    await repository.createProject({ id: 'project_idempotent', title: 'Idempotency project' });
    const version = makeVersion({ id: 'version_idempotent', projectId: 'project_idempotent' });

    await repository.saveVersion(version);
    await repository.saveVersion({ ...version, content: { ...version.content }, contentHash: 'caller-hash-is-ignored' });

    await expect(repository.saveVersion({
      ...version,
      kind: 'draft',
      content: { ...version.content, body: 'different-body' },
    })).rejects.toBeInstanceOf(VersionConflictError);

    const error = await repository.saveVersion({
      ...version,
      kind: 'draft',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VersionConflictError);
    expect((error as Error).message).not.toContain(secretBody);
  });
});
