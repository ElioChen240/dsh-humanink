export class VersionConflictError extends Error {
  readonly versionId: string;

  constructor(versionId: string) {
    super(`版本 ${versionId} 已存在且内容不同`);
    this.name = 'VersionConflictError';
    this.versionId = versionId;
  }
}

export class ParentVersionNotFoundError extends Error {
  readonly parentVersionId: string;

  constructor(parentVersionId: string, message?: string) {
    super(message ?? `父版本不存在: ${parentVersionId}`);
    this.name = 'ParentVersionNotFoundError';
    this.parentVersionId = parentVersionId;
  }
}

export class ProjectVersionMismatchError extends Error {
  readonly projectId: string;
  readonly versionId: string;

  constructor(projectId: string, versionId: string) {
    super(`父版本不属于当前项目: ${versionId}`);
    this.name = 'ProjectVersionMismatchError';
    this.projectId = projectId;
    this.versionId = versionId;
  }
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`内容项目不存在: ${projectId}`);
    this.name = 'ProjectNotFoundError';
    this.projectId = projectId;
  }
}

export class ProjectConflictError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`内容项目已存在: ${projectId}`);
    this.name = 'ProjectConflictError';
    this.projectId = projectId;
  }
}

export class CurrentVersionNotFoundError extends Error {
  readonly versionId: string;

  constructor(versionId: string) {
    super(`当前版本不存在: ${versionId}`);
    this.name = 'CurrentVersionNotFoundError';
    this.versionId = versionId;
  }
}
