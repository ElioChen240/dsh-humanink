import type { ContentProject, CreateContentProjectInput } from '../project/content-project.js';
import type { ContentVersion } from '../versioning/content-version.js';

export interface ContentVersionSummary {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ContentVersion['kind'];
  readonly parentVersionId?: string;
  readonly createdBy: ContentVersion['createdBy'];
  readonly createdAt: Date;
  readonly contentHash: string;
}

export type ContentProjectCommitMode = 'create' | 'update';

export interface CommitVersionAndProjectInput {
  readonly mode: ContentProjectCommitMode;
  readonly version: ContentVersion;
  readonly project: ContentProject;
  /** Stable task/operation identifier used only for recovery reconciliation. */
  readonly operationId?: string;
  /** Compare-and-set precondition for the project pointer. Null means no current version. */
  readonly expectedCurrentVersionId?: string | null;
}

export interface ContentRepository {
  createProject(input: CreateContentProjectInput): Promise<ContentProject>;
  getProject(projectId: string): Promise<ContentProject | null>;
  listProjects(): Promise<readonly ContentProject[]>;
  updateProject(project: ContentProject): Promise<ContentProject>;
  saveVersion(version: ContentVersion): Promise<void>;
  /**
   * Atomically exposes a content version and the project record that points at it.
   * Implementations must validate the complete commit before making either record visible.
   */
  commitVersionAndProject?(input: CommitVersionAndProjectInput): Promise<ContentProject>;
  /** Synchronous in-memory lookup so startup recovery can reconcile a durable task. */
  findCommittedVersionByOperationId?(operationId: string): ContentVersion | null;
  getVersion(versionId: string): Promise<ContentVersion | null>;
  listVersions(projectId: string): Promise<readonly ContentVersionSummary[]>;
}
