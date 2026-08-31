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

export interface ContentRepository {
  createProject(input: CreateContentProjectInput): Promise<ContentProject>;
  getProject(projectId: string): Promise<ContentProject | null>;
  updateProject(project: ContentProject): Promise<ContentProject>;
  saveVersion(version: ContentVersion): Promise<void>;
  getVersion(versionId: string): Promise<ContentVersion | null>;
  listVersions(projectId: string): Promise<readonly ContentVersionSummary[]>;
}
