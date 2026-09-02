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
  AtomicCommitValidationError,
  cloneAndFreeze,
  createContentHash,
  createContentProject,
  type CommitVersionAndProjectInput,
  type ContentProject,
  type ContentProjectCommitMode,
  type ContentRepository,
  type ContentVersion,
  type ContentVersionSummary,
  type CreateContentProjectInput,
  CurrentVersionNotFoundError,
  ParentVersionNotFoundError,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
  RepositoryRecoveryRequiredError,
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

interface StoredTransactionPrepareRecord {
  readonly id: string;
  readonly type: 'prepare';
  readonly mode: ContentProjectCommitMode;
  readonly project: StoredProjectRecord;
  readonly version: StoredVersionRecord;
  readonly operationId?: string;
  readonly expectedCurrentVersionId?: string | null;
}

interface StoredTransactionCommitRecord {
  readonly id: string;
  readonly type: 'commit';
}

type StoredTransactionRecord = StoredTransactionPrepareRecord | StoredTransactionCommitRecord;

interface TransactionState {
  prepare?: StoredTransactionPrepareRecord;
  committed: boolean;
}

interface TransactionJournal {
  readonly pending: readonly StoredTransactionPrepareRecord[];
  readonly committedOperations: Map<string, string>;
}

export type FileContentRepositoryAtomicCommitStage =
  | 'after-prepare'
  | 'after-version-write'
  | 'before-project-write'
  | 'after-project-write'
  | 'before-commit';

export interface FileContentRepositoryOptions {
  readonly onAtomicCommitStage?: (stage: FileContentRepositoryAtomicCommitStage) => void;
  readonly staleLockMs?: number;
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
      throw new Error(`Cannot read ${fileLabel} record at line ${index + 1}`);
    }

    const id = (record as { readonly id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`Cannot read ${fileLabel} record at line ${index + 1}: missing id`);
    }

    records.set(id, revive(record));
  }

  return records;
}

function readTransactionJournal(filePath: string): TransactionJournal {
  const states = new Map<string, TransactionState>();
  const order: string[] = [];
  const raw = readFileSync(filePath, 'utf8');
  const operationIndex = new Map<string, string>();

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim() === '') {
      continue;
    }

    let record: StoredTransactionRecord;
    try {
      record = JSON.parse(line) as StoredTransactionRecord;
    } catch {
      throw new Error(`Cannot read transactions.jsonl record at line ${index + 1}`);
    }

    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error(`Cannot read transactions.jsonl record at line ${index + 1}: missing id`);
    }

    let state = states.get(record.id);
    if (state === undefined) {
      state = { committed: false };
      states.set(record.id, state);
    }

    if (record.type === 'prepare') {
      if (record.mode !== 'create' && record.mode !== 'update') {
        throw new Error(`Cannot read transactions.jsonl record at line ${index + 1}: invalid mode`);
      }
      if (state.prepare === undefined) {
        state.prepare = record;
        order.push(record.id);
      } else if (createContentHash(state.prepare) !== createContentHash(record)) {
        throw new Error(`Conflicting transaction prepare record: ${record.id}`);
      }

      if (record.operationId !== undefined) {
        const committedVersionId = operationIndex.get(record.operationId);
        if (committedVersionId !== undefined && committedVersionId !== record.version.id) {
          throw new Error(`Conflicting committed operation id: ${record.operationId}`);
        }
        operationIndex.set(record.operationId, record.version.id);
      }
    } else if (record.type === 'commit') {
      state.committed = true;
    } else {
      throw new Error(`Cannot read transactions.jsonl record at line ${index + 1}: invalid type`);
    }
  }

  const pending: StoredTransactionPrepareRecord[] = [];
  const committedOperations = new Map<string, string>();

  for (const id of order) {
    const state = states.get(id);
    if (state?.prepare === undefined) {
      continue;
    }
    if (state.committed) {
      const operationId = state.prepare.operationId;
      if (operationId !== undefined) {
        const committedVersionId = committedOperations.get(operationId);
        if (committedVersionId !== undefined && committedVersionId !== state.prepare.version.id) {
          throw new Error(`Conflicting committed operation id: ${operationId}`);
        }
        committedOperations.set(operationId, state.prepare.version.id);
      }
    } else {
      pending.push(state.prepare);
    }
  }

  for (const [id, state] of states) {
    if (state.committed && state.prepare === undefined) {
      throw new Error(`Transaction commit is missing its prepare record: ${id}`);
    }
  }

  return { pending, committedOperations };
}

function readPendingTransactions(filePath: string): readonly StoredTransactionPrepareRecord[] {
  return readTransactionJournal(filePath).pending;
}

export class FileContentRepository implements ContentRepository {
  private readonly projects = new Map<string, ContentProject>();
  private readonly versions = new Map<string, ContentVersion>();
  private readonly committedOperations = new Map<string, string>();
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private readonly projectsPath: string;
  private readonly versionsPath: string;
  private readonly transactionsPath: string;
  private readonly lockPath: string;
  private readonly staleLockMs: number;

  constructor(
    rootDir: string,
    private readonly options: FileContentRepositoryOptions = {},
  ) {
    mkdirSync(rootDir, { recursive: true });
    this.projectsPath = join(rootDir, 'projects.jsonl');
    this.versionsPath = join(rootDir, 'versions.jsonl');
    this.transactionsPath = join(rootDir, 'transactions.jsonl');
    this.lockPath = join(rootDir, '.content-repository.lock');
    this.staleLockMs = this.resolveStaleLockMs();
    this.ensureFile(this.projectsPath);
    this.ensureFile(this.versionsPath);
    this.ensureFile(this.transactionsPath);
    const release = this.acquireWriterLock();
    try {
      this.reloadStateFromDisk();
      this.recoverPendingTransactions();
    } finally {
      release();
    }
  }

  async createProject(input: CreateContentProjectInput): Promise<ContentProject> {
    return this.enqueueMutation(() => this.withWriterLock(() => this.createProjectLocked(input)));
  }

  async getProject(projectId: string): Promise<ContentProject | null> {
    const project = this.projects.get(projectId);
    return project === undefined ? null : cloneAndFreeze(project);
  }

  async listProjects(): Promise<readonly ContentProject[]> {
    return cloneAndFreeze(
      [...this.projects.values()]
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map((project) => cloneAndFreeze(project)),
    );
  }

  async updateProject(project: ContentProject): Promise<ContentProject> {
    return this.enqueueMutation(() => this.withWriterLock(() => this.updateProjectLocked(project)));
  }

  async saveVersion(version: ContentVersion): Promise<void> {
    return this.enqueueMutation(() => this.withWriterLock(() => this.saveVersionLocked(version)));
  }

  async commitVersionAndProject(input: CommitVersionAndProjectInput): Promise<ContentProject> {
    return this.enqueueMutation(() => this.withWriterLock(() => this.commitVersionAndProjectLocked(input)));
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

  private async withWriterLock<T>(operation: () => T | Promise<T>): Promise<T> {
    const release = this.acquireWriterLock();
    try {
      this.reloadStateFromDisk();
      this.recoverPendingTransactions();
      return await operation();
    } finally {
      release();
    }
  }

  private enqueueMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(() => operation());
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private createProjectLocked(input: CreateContentProjectInput): ContentProject {
    const project = createContentProject(input);
    if (this.projects.has(project.id)) {
      throw new ProjectConflictError(project.id);
    }
    this.assertCurrentVersion(project);
    const stored = cloneAndFreeze(project);
    this.appendRecord(this.projectsPath, serializeProject(stored));
    this.projects.set(stored.id, stored);
    return cloneAndFreeze(stored);
  }

  private updateProjectLocked(project: ContentProject): ContentProject {
    if (!this.projects.has(project.id)) {
      throw new ProjectNotFoundError(project.id);
    }
    this.assertCurrentVersion(project);
    const stored = cloneAndFreeze(project);
    this.appendRecord(this.projectsPath, serializeProject(stored));
    this.projects.set(stored.id, stored);
    return cloneAndFreeze(stored);
  }

  private saveVersionLocked(version: ContentVersion): void {
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
    this.appendRecord(this.versionsPath, serializeVersion(stored));
    this.versions.set(stored.id, stored);
  }

  private commitVersionAndProjectLocked(input: CommitVersionAndProjectInput): ContentProject {
    this.validateOperationId(input.operationId);

    const prepared = this.prepareAtomicCommit(input);
    const existingProject = this.projects.get(prepared.project.id);
    const existingVersion = this.versions.get(prepared.version.id);

    this.ensureOperationIdAvailable(input.operationId, prepared.version.id);

    if (
      existingProject !== undefined
      && existingVersion !== undefined
      && sameProject(existingProject, prepared.project)
      && sameVersion(existingVersion, prepared.version)
    ) {
      this.registerCommittedOperation(input.operationId, prepared.version.id);
      return cloneAndFreeze(existingProject);
    }


    if (input.mode === 'create') {
      if (existingProject !== undefined && !sameProject(existingProject, prepared.project)) {
        throw new ProjectConflictError(prepared.project.id);
      }
    } else {
      if (existingProject === undefined) {
        throw new ProjectNotFoundError(prepared.project.id);
      }
      const expectedCurrentVersionId = input.expectedCurrentVersionId ?? (prepared.version.parentVersionId ?? null);
      if ((existingProject.currentVersionId ?? null) !== expectedCurrentVersionId) {
        throw new AtomicCommitValidationError('Atomic commit project current version changed');
      }
    }

    if (existingVersion !== undefined && !sameVersion(existingVersion, prepared.version)) {
      throw new VersionConflictError(prepared.version.id);
    }

    const transaction = this.createTransaction(
      input.mode,
      prepared.project,
      prepared.version,
      input.operationId,
      input.expectedCurrentVersionId ?? (prepared.version.parentVersionId ?? null),
    );

    let preparePersisted = false;
    try {
      this.appendRecord(this.transactionsPath, transaction);
      preparePersisted = true;
      this.invokeAtomicCommitStage('after-prepare');

      if (existingVersion === undefined) {
        this.appendRecord(this.versionsPath, serializeVersion(prepared.version));
        this.versions.set(prepared.version.id, prepared.version);
        this.invokeAtomicCommitStage('after-version-write');
      }

      if (existingProject === undefined || !sameProject(existingProject, prepared.project)) {
        this.invokeAtomicCommitStage('before-project-write');
        this.appendRecord(this.projectsPath, serializeProject(prepared.project));
        this.projects.set(prepared.project.id, prepared.project);
        this.invokeAtomicCommitStage('after-project-write');
      }

      this.invokeAtomicCommitStage('before-commit');
      this.appendRecord(this.transactionsPath, {
        id: transaction.id,
        type: 'commit',
      } satisfies StoredTransactionCommitRecord);
      this.registerCommittedOperation(input.operationId, prepared.version.id);
      return cloneAndFreeze(prepared.project);
    } catch (error) {
      if (preparePersisted) {
        try {
          this.reloadStateFromDisk();
          this.recoverPendingTransactions();
          const committedProject = this.projects.get(prepared.project.id);
          if (committedProject !== undefined) {
            return cloneAndFreeze(committedProject);
          }
        } catch {
          // Leave the prepared transaction in the journal so it can be audited or retried on restart.
        }
      }
      throw error;
    }
  }

  private reloadStateFromDisk(): void {
    this.projects.clear();
    const storedProjects = readJsonl<StoredProjectRecord>(this.projectsPath, 'projects.jsonl', (record) => record);
    for (const [id, record] of storedProjects) {
      this.projects.set(id, deserializeProject(record));
    }

    this.versions.clear();
    const storedVersions = readJsonl<StoredVersionRecord>(this.versionsPath, 'versions.jsonl', (record) => record);
    for (const [id, record] of storedVersions) {
      this.versions.set(id, deserializeVersion(record));
    }

    this.committedOperations.clear();
    const journal = readTransactionJournal(this.transactionsPath);
    for (const [operationId, versionId] of journal.committedOperations) {
      this.committedOperations.set(operationId, versionId);
    }
  }

  private recoverPendingTransactions(): void {
    for (const transaction of readPendingTransactions(this.transactionsPath)) {
      const prepared = this.prepareRecoveredCommit(transaction);
      const existingVersion = this.versions.get(prepared.version.id);
      if (existingVersion === undefined) {
        this.appendRecord(this.versionsPath, serializeVersion(prepared.version));
        this.versions.set(prepared.version.id, prepared.version);
      } else if (!sameVersion(existingVersion, prepared.version)) {
        throw new VersionConflictError(prepared.version.id);
      }

      const existingProject = this.projects.get(prepared.project.id);
      if (this.canRecoverProject(transaction, prepared.project, existingProject, prepared.expectedCurrentVersionId)) {
        if (existingProject === undefined || !sameProject(existingProject, prepared.project)) {
          this.appendRecord(this.projectsPath, serializeProject(prepared.project));
          this.projects.set(prepared.project.id, prepared.project);
        }
      }

      this.appendRecord(this.transactionsPath, {
        id: transaction.id,
        type: 'commit',
      } satisfies StoredTransactionCommitRecord);
      this.registerCommittedOperation(transaction.operationId, prepared.version.id);
    }
  }

  private canRecoverProject(
    transaction: StoredTransactionPrepareRecord,
    preparedProject: ContentProject,
    existingProject: ContentProject | undefined,
    expectedCurrentVersionId: string | null,
  ): boolean {
    if (existingProject === undefined) {
      return true;
    }
    if (sameProject(existingProject, preparedProject)) {
      return false;
    }
    if (transaction.mode === 'create') {
      return false;
    }
    return (existingProject.currentVersionId ?? null) === expectedCurrentVersionId;
  }

  private prepareAtomicCommit(input: CommitVersionAndProjectInput): {
    readonly project: ContentProject;
    readonly version: ContentVersion;
  } {
    const project = cloneAndFreeze(input.project);
    const version = this.prepareVersion(input.version);

    if (project.id !== version.projectId) {
      throw new ProjectVersionMismatchError(project.id, version.id);
    }

    this.assertParentVersion(version);

    if (project.currentVersionId !== version.id) {
      throw new AtomicCommitValidationError('Atomic commit project must point at the committed version');
    }

    return { project, version };
  }

  private prepareRecoveredCommit(transaction: StoredTransactionPrepareRecord): {
    readonly project: ContentProject;
    readonly version: ContentVersion;
    readonly expectedCurrentVersionId: string | null;
  } {
    const project = deserializeProject(transaction.project);
    const version = this.prepareVersion(deserializeVersion(transaction.version));

    if (project.id !== version.projectId) {
      throw new ProjectVersionMismatchError(project.id, version.id);
    }

    this.assertParentVersion(version);

    if (project.currentVersionId !== version.id) {
      throw new AtomicCommitValidationError('Atomic commit project must point at the committed version');
    }

    return {
      project,
      version,
      expectedCurrentVersionId: transaction.expectedCurrentVersionId ?? (version.parentVersionId ?? null),
    };
  }

  private createTransaction(
    mode: ContentProjectCommitMode,
    project: ContentProject,
    version: ContentVersion,
    operationId?: string,
    expectedCurrentVersionId?: string | null,
  ): StoredTransactionPrepareRecord {
    const serializedProject = serializeProject(project);
    const serializedVersion = serializeVersion(version);
    return {
      id: `transaction_${createContentHash({
        mode,
        project: serializedProject,
        version: serializedVersion,
        operationId: operationId ?? null,
        expectedCurrentVersionId: expectedCurrentVersionId ?? null,
      })}`,
      type: 'prepare',
      mode,
      project: serializedProject,
      version: serializedVersion,
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedCurrentVersionId === undefined ? {} : { expectedCurrentVersionId }),
    };
  }

  private validateOperationId(operationId?: string): void {
    if (operationId !== undefined && operationId.trim().length === 0) {
      throw new AtomicCommitValidationError('Atomic commit operationId must be a non-empty string');
    }
  }

  private ensureOperationIdAvailable(operationId: string | undefined, versionId: string): void {
    if (operationId === undefined) {
      return;
    }
    const committedVersionId = this.committedOperations.get(operationId);
    if (committedVersionId !== undefined && committedVersionId !== versionId) {
      throw new AtomicCommitValidationError('Atomic commit operationId is already assigned to another version');
    }
  }

  private registerCommittedOperation(operationId: string | undefined, versionId: string): void {
    if (operationId === undefined) {
      return;
    }
    const committedVersionId = this.committedOperations.get(operationId);
    if (committedVersionId !== undefined && committedVersionId !== versionId) {
      throw new AtomicCommitValidationError('Atomic commit operationId is already assigned to another version');
    }
    this.committedOperations.set(operationId, versionId);
  }

  private resolveStaleLockMs(): number {
    const candidate = this.options.staleLockMs;
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : 60_000;
  }

  private cleanupStaleLock(): boolean {
    if (!existsSync(this.lockPath)) {
      return false;
    }
    if (!this.isLockStale()) {
      return false;
    }
    rmSync(this.lockPath, { force: true });
    return true;
  }

  private isLockStale(): boolean {
    try {
      const raw = readFileSync(this.lockPath, 'utf8').trim();
      if (raw.length === 0) {
        return true;
      }
      const record = JSON.parse(raw) as { readonly createdAt?: unknown };
      if (typeof record.createdAt !== 'string') {
        return true;
      }
      const createdAt = Date.parse(record.createdAt);
      if (!Number.isFinite(createdAt)) {
        return true;
      }
      return Date.now() - createdAt >= this.staleLockMs;
    } catch {
      return true;
    }
  }

  private acquireWriterLock(): () => void {
    while (true) {
      this.cleanupStaleLock();
      const token = [Date.now(), Math.random().toString(16).slice(2)].join('-');
      const lockRecord = {
        token,
        createdAt: new Date().toISOString(),
      };

      try {
        writeFileSync(this.lockPath, JSON.stringify(lockRecord) + '\n', { flag: 'wx', encoding: 'utf8' } as any);
        let released = false;
        return () => {
          if (released) {
            return;
          }
          released = true;
          this.releaseLock(token);
        };
      } catch (error) {
        if (this.isLockExistsError(error)) {
          if (this.cleanupStaleLock()) {
            continue;
          }
          throw new RepositoryRecoveryRequiredError();
        }
        throw error;
      }
    }
  }

  private releaseLock(token: string): void {
    if (!existsSync(this.lockPath)) {
      return;
    }
    try {
      const raw = readFileSync(this.lockPath, 'utf8');
      const record = JSON.parse(raw) as { readonly token?: unknown };
      if (record.token === token) {
        rmSync(this.lockPath, { force: true });
      }
    } catch {
      rmSync(this.lockPath, { force: true });
    }
  }

  private isLockExistsError(error: unknown): boolean {
    return error instanceof Error && (error as { readonly code?: string }).code === 'EEXIST';
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

  private invokeAtomicCommitStage(stage: FileContentRepositoryAtomicCommitStage): void {
    this.options.onAtomicCommitStage?.(stage);
  }
}

export type { ContentRepository } from '@humanink/core';
