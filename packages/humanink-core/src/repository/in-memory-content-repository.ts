import { createContentProject, type ContentProject, type CreateContentProjectInput } from '../project/content-project.js';
import { cloneAndFreeze } from '../shared/immutability.js';
import { createContentHash } from '../shared/hash.js';
import type { FactoryDependencies } from '../shared/factories.js';
import type { ContentVersion } from '../versioning/content-version.js';
import type {
  CommitVersionAndProjectInput,
  ContentRepository,
  ContentVersionSummary,
} from './content-repository.js';
import {
  AtomicCommitValidationError,
  CurrentVersionNotFoundError,
  ParentVersionNotFoundError,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  VersionConflictError,
} from './errors.js';

function versionRecordForComparison(version: ContentVersion): unknown {
  return {
    id: version.id,
    projectId: version.projectId,
    kind: version.kind,
    parentVersionId: version.parentVersionId ?? null,
    content: version.content,
    protectedFields: version.protectedFields,
    sourceRefs: version.sourceRefs,
    promptTemplateVersion: version.promptTemplateVersion ?? null,
    modelInfo: version.modelInfo ?? null,
    createdBy: version.createdBy,
    userConfirmed: version.userConfirmed,
    createdAt: version.createdAt.toISOString(),
  };
}

function projectRecordForComparison(project: ContentProject): unknown {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    creatorProfileId: project.creatorProfileId ?? null,
    currentVersionId: project.currentVersionId ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    metadata: project.metadata,
  };
}

function sameVersion(left: ContentVersion, right: ContentVersion): boolean {
  return createContentHash(versionRecordForComparison(left)) === createContentHash(versionRecordForComparison(right));
}

function sameProject(left: ContentProject, right: ContentProject): boolean {
  return createContentHash(projectRecordForComparison(left)) === createContentHash(projectRecordForComparison(right));
}

export class InMemoryContentRepository implements ContentRepository {
  private readonly projects = new Map<string, ContentProject>();
  private readonly versions = new Map<string, ContentVersion>();
  private readonly committedOperations = new Map<string, string>();

  constructor(private readonly dependencies?: FactoryDependencies) {}

  async createProject(input: CreateContentProjectInput): Promise<ContentProject> {
    const project = createContentProject(input, this.dependencies);
    if (this.projects.has(project.id)) {
      throw new ProjectConflictError(project.id);
    }
    this.assertCurrentVersion(project);
    const stored = cloneAndFreeze(project);
    this.projects.set(stored.id, stored);
    return cloneAndFreeze(stored);
  }

  async getProject(projectId: string): Promise<ContentProject | null> {
    const project = this.projects.get(projectId);
    return project === undefined ? null : cloneAndFreeze(project);
  }

  async updateProject(project: ContentProject): Promise<ContentProject> {
    if (!this.projects.has(project.id)) {
      throw new ProjectNotFoundError(project.id);
    }
    this.assertCurrentVersion(project);
    const stored = cloneAndFreeze(project);
    this.projects.set(stored.id, stored);
    return cloneAndFreeze(stored);
  }

  async saveVersion(version: ContentVersion): Promise<void> {
    if (!this.projects.has(version.projectId)) {
      throw new ProjectNotFoundError(version.projectId);
    }

    const stored = this.prepareVersion(version);
    const existing = this.versions.get(stored.id);
    if (existing !== undefined) {
      if (!sameVersion(existing, stored)) {
        throw new VersionConflictError(stored.id);
      }
      return;
    }

    this.assertParentVersion(stored);
    this.versions.set(stored.id, stored);
  }

  async commitVersionAndProject(input: CommitVersionAndProjectInput): Promise<ContentProject> {
    const storedVersion = this.prepareVersion(input.version);
    const storedProject = cloneAndFreeze(input.project);
    const existingProject = this.projects.get(storedProject.id);
    const existingVersion = this.versions.get(storedVersion.id);

    this.validateAtomicCommit(input, storedProject, storedVersion, existingProject, existingVersion);

    // Everything that can fail is completed above. Map writes are the single visible commit boundary.
    this.versions.set(storedVersion.id, storedVersion);
    this.projects.set(storedProject.id, storedProject);
    if (input.operationId !== undefined) {
      this.committedOperations.set(input.operationId, storedVersion.id);
    }
    return cloneAndFreeze(storedProject);
  }

  findCommittedVersionByOperationId(operationId: string): ContentVersion | null {
    const versionId = this.committedOperations.get(operationId);
    if (versionId === undefined) {
      return null;
    }
    const version = this.versions.get(versionId);
    return version === undefined ? null : cloneAndFreeze(version);
  }
  async getVersion(versionId: string): Promise<ContentVersion | null> {
    const version = this.versions.get(versionId);
    return version === undefined ? null : cloneAndFreeze(version);
  }

  async listVersions(projectId: string): Promise<readonly ContentVersionSummary[]> {
    const summaries = [...this.versions.values()]
      .filter((version) => version.projectId === projectId)
      .map((version) => cloneAndFreeze({
        id: version.id,
        projectId: version.projectId,
        kind: version.kind,
        createdBy: version.createdBy,
        createdAt: new Date(version.createdAt.getTime()),
        contentHash: version.contentHash,
        ...(version.parentVersionId === undefined ? {} : { parentVersionId: version.parentVersionId }),
      }));
    return cloneAndFreeze(summaries);
  }

  private validateAtomicCommit(
    input: CommitVersionAndProjectInput,
    project: ContentProject,
    version: ContentVersion,
    existingProject: ContentProject | undefined,
    existingVersion: ContentVersion | undefined,
  ): void {
    if (input.operationId !== undefined) {
      if (input.operationId.trim().length === 0) {
        throw new AtomicCommitValidationError('Atomic commit operationId must be a non-empty string');
      }
      const committedVersionId = this.committedOperations.get(input.operationId);
      if (committedVersionId !== undefined && committedVersionId !== version.id) {
        throw new AtomicCommitValidationError('Atomic commit operationId is already assigned to another version');
      }
    }

    if (project.id !== version.projectId) {
      throw new ProjectVersionMismatchError(project.id, version.id);
    }

    this.assertParentVersion(version);

    if (project.currentVersionId !== version.id) {
      throw new AtomicCommitValidationError('Atomic commit project must point at the committed version');
    }

    if (existingProject !== undefined && existingVersion !== undefined) {
      const projectMatches = sameProject(existingProject, project);
      const versionMatches = sameVersion(existingVersion, version);
      if (projectMatches && versionMatches) {
        return;
      }
    }

    if (input.mode === 'create') {
      if (existingProject !== undefined && !sameProject(existingProject, project)) {
        throw new ProjectConflictError(project.id);
      }
    } else {
      if (existingProject === undefined) {
        throw new ProjectNotFoundError(project.id);
      }
      const expectedCurrentVersionId = input.expectedCurrentVersionId === undefined
        ? (version.parentVersionId ?? null)
        : input.expectedCurrentVersionId;
      const actualCurrentVersionId = existingProject.currentVersionId ?? null;
      if (actualCurrentVersionId !== expectedCurrentVersionId) {
        throw new AtomicCommitValidationError('Atomic commit project current version changed');
      }
    }

    if (existingVersion !== undefined && !sameVersion(existingVersion, version)) {
      throw new VersionConflictError(version.id);
    }
  }

  private assertCurrentVersion(project: ContentProject): void {
    if (project.currentVersionId === undefined) {
      return;
    }
    const currentVersion = this.versions.get(project.currentVersionId);
    if (currentVersion === undefined) {
      throw new CurrentVersionNotFoundError(project.currentVersionId);
    }
    if (currentVersion.projectId !== project.id) {
      throw new ProjectVersionMismatchError(project.id, project.currentVersionId);
    }
  }

  private assertParentVersion(version: ContentVersion): void {
    if (version.parentVersionId === undefined) {
      return;
    }
    const parent = this.versions.get(version.parentVersionId);
    if (parent === undefined) {
      throw new ParentVersionNotFoundError(version.parentVersionId);
    }
    if (parent.projectId !== version.projectId) {
      throw new ProjectVersionMismatchError(version.projectId, version.parentVersionId);
    }
  }

  private prepareVersion(version: ContentVersion): ContentVersion {
    return cloneAndFreeze({
      ...version,
      content: cloneAndFreeze(version.content),
      protectedFields: [...version.protectedFields],
      sourceRefs: [...version.sourceRefs],
      contentHash: createContentHash(version.content),
      ...(version.modelInfo === undefined ? {} : { modelInfo: cloneAndFreeze(version.modelInfo) }),
    });
  }
}

export { VersionConflictError } from './errors.js';
export type {
  CommitVersionAndProjectInput,
  ContentRepository,
  ContentVersionSummary,
} from './content-repository.js';
