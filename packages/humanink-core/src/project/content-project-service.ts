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
import type { ContentRepository } from '../repository/content-repository.js';
import { ParentVersionNotFoundError, ProjectNotFoundError, ProjectVersionMismatchError } from '../repository/errors.js';

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
    const createdProject = await this.repository.createProject(projectWithoutVersion);
    await this.repository.saveVersion(sourceVersion);
    const project = updateContentProjectCurrentVersion(
      createdProject,
      sourceVersion.id,
      sourceVersion.createdAt,
    );
    const initializedProject = await this.repository.updateProject(project);
    return { project: initializedProject, sourceVersion };
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
    await this.repository.saveVersion(derived);
    await this.advanceCurrentVersion(project, derived);
    return derived;
  }

  async restoreVersion(input: {
    readonly projectId: string;
    readonly versionId: string;
    readonly createdBy?: RestoreContentVersionInput['createdBy'];
    readonly id?: string;
    readonly createdAt?: Date;
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
    await this.repository.saveVersion(restored);
    await this.advanceCurrentVersion(project, restored);
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

  private async advanceCurrentVersion(project: ContentProject, version: ContentVersion): Promise<void> {
    await this.repository.updateProject(updateContentProjectCurrentVersion(project, version.id, version.createdAt));
  }
}
