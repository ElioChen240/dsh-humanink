import {
  createContentProject,
  updateContentProjectCurrentVersion,
  type ContentProject,
  type CreateDerivedVersionRequest,
  type CreateProjectWithSourceRequest,
} from './content-project.js';
import {
  createContentVersion,
  deriveContentVersion,
  restoreContentVersion,
  type ContentVersion,
  type CreateContentVersionInput,
  type DeriveContentVersionInput,
  type RestoreContentVersionInput,
} from '../versioning/content-version.js';
import type { FactoryDependencies } from '../shared/factories.js';
import type {
  CommitVersionAndProjectInput,
  ContentRepository,
} from '../repository/content-repository.js';
import {
  ParentVersionNotFoundError,
  ProjectNotFoundError,
  ProjectVersionMismatchError,
} from '../repository/errors.js';

export interface CreatedProject {
  readonly project: ContentProject;
  readonly sourceVersion: ContentVersion;
}

export class ContentProjectService {
  constructor(
    private readonly repository: ContentRepository,
    private readonly dependencies?: FactoryDependencies,
  ) {}

  async createProject(input: CreateProjectWithSourceRequest): Promise<CreatedProject> {
    const projectWithoutVersion = createContentProject({
      title: input.title,
      ...(input.creatorProfileId === undefined ? {} : { creatorProfileId: input.creatorProfileId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    }, this.dependencies);
    const sourceInput: CreateContentVersionInput = {
      projectId: projectWithoutVersion.id,
      kind: 'source',
      content: input.source,
      createdBy: 'user',
      userConfirmed: true,
    };
    const sourceVersion = createContentVersion(sourceInput, this.dependencies);
    const initializedProject = updateContentProjectCurrentVersion(
      projectWithoutVersion,
      sourceVersion.id,
      sourceVersion.createdAt,
    );
    const project = await this.commitVersionAndProject({
      mode: 'create',
      version: sourceVersion,
      project: initializedProject,
      expectedCurrentVersionId: null,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    });
    return { project, sourceVersion };
  }

  async createDerivedVersion(input: CreateDerivedVersionRequest): Promise<ContentVersion> {
    const project = await this.requireProject(input.projectId);
    const parent = await this.repository.getVersion(input.parentVersionId);
    this.validateParent(project.id, parent, input.parentVersionId);
    const derivedInput: DeriveContentVersionInput = {
      kind: input.kind,
      content: input.content,
      createdBy: input.createdBy,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
      ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
      ...(input.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: input.promptTemplateVersion }),
      ...(input.modelInfo === undefined ? {} : { modelInfo: input.modelInfo }),
      ...(input.userConfirmed === undefined ? {} : { userConfirmed: input.userConfirmed }),
    };
    const derived = deriveContentVersion(parent, derivedInput, this.dependencies);
    await this.commitVersionAndProject({
      mode: 'update',
      version: derived,
      project: updateContentProjectCurrentVersion(project, derived.id, derived.createdAt),
      expectedCurrentVersionId: project.currentVersionId ?? null,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    });
    return derived;
  }

  async restoreVersion(input: {
    readonly projectId: string;
    readonly versionId: string;
    readonly createdBy?: RestoreContentVersionInput['createdBy'];
    readonly id?: string;
    readonly createdAt?: Date;
    readonly operationId?: string;
  }): Promise<ContentVersion> {
    const project = await this.requireProject(input.projectId);
    const parent = await this.repository.getVersion(input.versionId);
    this.validateParent(project.id, parent, input.versionId);
    const restoreInput: RestoreContentVersionInput = {
      ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    };
    const restored = restoreContentVersion(parent, restoreInput, this.dependencies);
    await this.commitVersionAndProject({
      mode: 'update',
      version: restored,
      project: updateContentProjectCurrentVersion(project, restored.id, restored.createdAt),
      expectedCurrentVersionId: project.currentVersionId ?? null,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    });
    return restored;
  }

  private async requireProject(projectId: string): Promise<ContentProject> {
    const project = await this.repository.getProject(projectId);
    if (project === null) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private validateParent(
    projectId: string,
    parent: ContentVersion | null,
    parentVersionId: string,
  ): asserts parent is ContentVersion {
    if (parent === null) {
      throw new ParentVersionNotFoundError(parentVersionId);
    }
    if (parent.projectId !== projectId) {
      throw new ProjectVersionMismatchError(projectId, parentVersionId);
    }
  }

  private async commitVersionAndProject(
    input: CommitVersionAndProjectInput,
  ): Promise<ContentProject> {
    const commit = this.repository.commitVersionAndProject;
    if (commit !== undefined) {
      return commit.call(this.repository, input);
    }

    // Backward-compatible fallback for repositories implemented before atomic commits existed.
    // It intentionally preserves the legacy create/save/update ordering and guarantees no
    // stronger atomicity than that older repository contract.
    if (input.mode === 'create') {
      const { currentVersionId: _currentVersionId, ...projectWithoutVersion } = input.project;
      await this.repository.createProject(projectWithoutVersion);
      await this.repository.saveVersion(input.version);
      return this.repository.updateProject(input.project);
    }

    await this.repository.saveVersion(input.version);
    return this.repository.updateProject(input.project);
  }
}
