import { createContentProject, type ContentProject, type CreateContentProjectInput } from '../project/content-project.js';
import { cloneAndFreeze } from '../shared/immutability.js';
import { createContentHash } from '../shared/hash.js';
import type { FactoryDependencies } from '../shared/factories.js';
import type { ContentVersion } from '../versioning/content-version.js';
import type { ContentRepository, ContentVersionSummary } from './content-repository.js';
import {
  ParentVersionNotFoundError,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  VersionConflictError,
} from './errors.js';

export class InMemoryContentRepository implements ContentRepository {
  private readonly projects = new Map<string, ContentProject>();
  private readonly versions = new Map<string, ContentVersion>();

  constructor(private readonly dependencies?: FactoryDependencies) {}

  async createProject(input: CreateContentProjectInput): Promise<ContentProject> {
    const project = createContentProject(input, this.dependencies);
    if (this.projects.has(project.id)) {
      throw new ProjectConflictError(project.id);
    }
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
    const stored = cloneAndFreeze(project);
    this.projects.set(stored.id, stored);
    return cloneAndFreeze(stored);
  }

  async saveVersion(version: ContentVersion): Promise<void> {
    const existing = this.versions.get(version.id);
    if (existing !== undefined) {
      if (createContentHash(existing.content) !== createContentHash(version.content)) {
        throw new VersionConflictError(version.id);
      }
      return;
    }

    if (version.parentVersionId !== undefined) {
      const parent = this.versions.get(version.parentVersionId);
      if (parent === undefined) {
        throw new ParentVersionNotFoundError(version.parentVersionId);
      }
      if (parent.projectId !== version.projectId) {
        throw new ProjectVersionMismatchError(version.projectId, version.parentVersionId);
      }
    }

    const stored = cloneAndFreeze({
      ...version,
      content: cloneAndFreeze(version.content),
      protectedFields: [...version.protectedFields],
      sourceRefs: [...version.sourceRefs],
      contentHash: createContentHash(version.content),
      ...(version.modelInfo === undefined ? {} : { modelInfo: cloneAndFreeze(version.modelInfo) }),
    });
    this.versions.set(stored.id, stored);
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
}

export { VersionConflictError } from './errors.js';
export type { ContentRepository, ContentVersionSummary } from './content-repository.js';
