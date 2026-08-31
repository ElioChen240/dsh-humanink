import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  cloneAndFreeze,
  createContentHash,
  createContentProject,
  type ContentProject,
  type ContentRepository,
  type ContentVersion,
  type ContentVersionSummary,
  type CreateContentProjectInput,
  CurrentVersionNotFoundError,
  ParentVersionNotFoundError,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  VersionConflictError,
} from '@humanink/core';

interface StoredProjectRecord {
  readonly id: string;
  readonly title: string;
  readonly status: ContentProject['status'];
  readonly creatorProfileId?: string;
  readonly currentVersionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: ContentProject['metadata'];
}

interface StoredVersionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ContentVersion['kind'];
  readonly parentVersionId?: string;
  readonly content: ContentVersion['content'];
  readonly protectedFields: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly promptTemplateVersion?: string;
  readonly modelInfo?: ContentVersion['modelInfo'];
  readonly createdBy: ContentVersion['createdBy'];
  readonly userConfirmed: boolean;
  readonly createdAt: string;
  readonly contentHash: string;
}

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

function serializeProject(project: ContentProject): StoredProjectRecord {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    ...(project.creatorProfileId === undefined ? {} : { creatorProfileId: project.creatorProfileId }),
    ...(project.currentVersionId === undefined ? {} : { currentVersionId: project.currentVersionId }),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    metadata: project.metadata,
  };
}

function deserializeProject(record: StoredProjectRecord): ContentProject {
  return cloneAndFreeze({
    id: record.id,
    title: record.title,
    status: record.status,
    ...(record.creatorProfileId === undefined ? {} : { creatorProfileId: record.creatorProfileId }),
    ...(record.currentVersionId === undefined ? {} : { currentVersionId: record.currentVersionId }),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    metadata: record.metadata,
  });
}

function serializeVersion(version: ContentVersion): StoredVersionRecord {
  return {
    id: version.id,
    projectId: version.projectId,
    kind: version.kind,
    ...(version.parentVersionId === undefined ? {} : { parentVersionId: version.parentVersionId }),
    content: version.content,
    protectedFields: version.protectedFields,
    sourceRefs: version.sourceRefs,
    ...(version.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: version.promptTemplateVersion }),
    ...(version.modelInfo === undefined ? {} : { modelInfo: version.modelInfo }),
    createdBy: version.createdBy,
    userConfirmed: version.userConfirmed,
    createdAt: version.createdAt.toISOString(),
    contentHash: version.contentHash,
  };
}

function deserializeVersion(record: StoredVersionRecord): ContentVersion {
  return cloneAndFreeze({
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    ...(record.parentVersionId === undefined ? {} : { parentVersionId: record.parentVersionId }),
    content: record.content,
    protectedFields: [...record.protectedFields],
    sourceRefs: [...record.sourceRefs],
    ...(record.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: record.promptTemplateVersion }),
    ...(record.modelInfo === undefined ? {} : { modelInfo: record.modelInfo }),
    createdBy: record.createdBy,
    userConfirmed: record.userConfirmed,
    createdAt: new Date(record.createdAt),
    contentHash: record.contentHash,
  });
}

function readJsonl<T>(filePath: string, fileLabel: string, revive: (record: T) => T): Map<string, T> {
  const records = new Map<string, T>();
  if (!existsSync(filePath)) {
    return records;
  }

  const raw = readFileSync(filePath, 'utf8');
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim() === '') {
      continue;
    }
    let record: T;
    try {
      record = JSON.parse(line) as T;
    } catch {
      throw new Error(`无法读取 ${fileLabel} 第 ${index + 1} 行 JSONL 记录`);
    }
    const id = (record as { readonly id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`无法读取 ${fileLabel} 第 ${index + 1} 行记录: 缺少 id`);
    }
    records.set(id, revive(record));
  }
  return records;
}

export class FileContentRepository implements ContentRepository {
  private readonly projects = new Map<string, ContentProject>();
  private readonly versions = new Map<string, ContentVersion>();
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private readonly projectsPath: string;
  private readonly versionsPath: string;

  constructor(rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
    this.projectsPath = join(rootDir, 'projects.jsonl');
    this.versionsPath = join(rootDir, 'versions.jsonl');
    this.ensureFile(this.projectsPath);
    this.ensureFile(this.versionsPath);

    const storedProjects = readJsonl<StoredProjectRecord>(this.projectsPath, 'projects.jsonl', (record) => record);
    for (const [id, record] of storedProjects) {
      this.projects.set(id, deserializeProject(record));
    }

    const storedVersions = readJsonl<StoredVersionRecord>(this.versionsPath, 'versions.jsonl', (record) => record);
    for (const [id, record] of storedVersions) {
      this.versions.set(id, deserializeVersion(record));
    }
  }

  async createProject(input: CreateContentProjectInput): Promise<ContentProject> {
    return this.enqueueMutation(() => {
      const project = createContentProject(input);
      if (this.projects.has(project.id)) {
        throw new ProjectConflictError(project.id);
      }
      this.assertCurrentVersion(project);
      const stored = cloneAndFreeze(project);
      this.appendRecord(this.projectsPath, serializeProject(stored));
      this.projects.set(stored.id, stored);
      return cloneAndFreeze(stored);
    });
  }

  async getProject(projectId: string): Promise<ContentProject | null> {
    const project = this.projects.get(projectId);
    return project === undefined ? null : cloneAndFreeze(project);
  }

  async updateProject(project: ContentProject): Promise<ContentProject> {
    return this.enqueueMutation(() => {
      if (!this.projects.has(project.id)) {
        throw new ProjectNotFoundError(project.id);
      }
      this.assertCurrentVersion(project);
      const stored = cloneAndFreeze(project);
      this.appendRecord(this.projectsPath, serializeProject(stored));
      this.projects.set(stored.id, stored);
      return cloneAndFreeze(stored);
    });
  }

  async saveVersion(version: ContentVersion): Promise<void> {
    return this.enqueueMutation(() => {
      if (!this.projects.has(version.projectId)) {
        throw new ProjectNotFoundError(version.projectId);
      }

      const existing = this.versions.get(version.id);
      if (existing !== undefined) {
        if (createContentHash(versionRecordForComparison(existing)) !== createContentHash(versionRecordForComparison(version))) {
          throw new VersionConflictError(version.id);
        }
        return;
      }

      this.assertParentVersion(version);
      const stored = cloneAndFreeze({
        ...version,
        content: cloneAndFreeze(version.content),
        protectedFields: [...version.protectedFields],
        sourceRefs: [...version.sourceRefs],
        contentHash: createContentHash(version.content),
        ...(version.modelInfo === undefined ? {} : { modelInfo: cloneAndFreeze(version.modelInfo) }),
      });
      this.appendRecord(this.versionsPath, serializeVersion(stored));
      this.versions.set(stored.id, stored);
    });
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

  private ensureFile(filePath: string): void {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, '', 'utf8');
    }
  }

  private appendRecord(filePath: string, record: unknown): void {
    const previous = readFileSync(filePath, 'utf8');
    const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      writeFileSync(tempPath, `${previous}${JSON.stringify(record)}\n`, 'utf8');
      renameSync(tempPath, filePath);
    } finally {
      if (existsSync(tempPath)) {
        rmSync(tempPath, { force: true });
      }
    }
  }

  private enqueueMutation<T>(operation: () => T): Promise<T> {
    const run = this.mutationQueue.then(operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export type { ContentRepository } from '@humanink/core';
