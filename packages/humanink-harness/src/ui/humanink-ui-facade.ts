import type {
  ContentProject,
  ContentProjectService,
  ContentRepository,
  ContentVersion,
  ContentVersionKind,
  CreateProjectWithSourceRequest,
} from '@humanink/core';
import type {
  HumanInkApplication,
  ProjectCreationResult,
} from '../runtime/humanink-application.js';
import type { TaskRecord } from '../runtime/task-runtime.js';

export interface HumanInkUiProjectCatalog {
  listProjects(): Promise<readonly ContentProject[]>;
  listVersions: ContentRepository['listVersions'];
}

type HumanInkUiApplication = Pick<
  HumanInkApplication,
  | 'createProject'
  | 'getProject'
  | 'getVersion'
  | 'getTask'
  | 'listTasks'
  | 'cancelTask'
  | 'exportVersion'
  | 'generateTitles'
  | 'generateBrief'
  | 'generateOutline'
  | 'generateDraft'
  | 'humanizeContent'
  | 'reviewContent'
>;

export interface HumanInkUiFacadeDependencies {
  readonly application: HumanInkUiApplication;
  readonly catalog: HumanInkUiProjectCatalog;
  readonly projectService: Pick<ContentProjectService, 'createDerivedVersion' | 'restoreVersion'>;
}

export interface HumanInkUiProjectDetails {
  readonly project: ContentProject;
  readonly currentVersion: ContentVersion | null;
  readonly versions: readonly ContentVersion[];
}

export interface SaveManualEditInput {
  readonly projectId: string;
  readonly parentVersionId: string;
  readonly title: string;
  readonly body: string;
  readonly kind?: ContentVersionKind;
}

export type HumanInkWorkflow = 'titles' | 'brief' | 'outline' | 'draft' | 'humanize' | 'review';

export interface HumanInkWorkflowInput {
  readonly projectId: string;
  readonly workflow: HumanInkWorkflow;
  readonly versionId?: string;
  readonly sourceVersionId?: string;
  readonly briefVersionId?: string;
  readonly outlineVersionId?: string;
  readonly selectedTitle?: string;
}

export class HumanInkUiFacade {
  constructor(private readonly dependencies: HumanInkUiFacadeDependencies) {}

  listProjects(): Promise<readonly ContentProject[]> {
    return this.dependencies.catalog.listProjects();
  }

  async getProject(projectId: string): Promise<HumanInkUiProjectDetails | null> {
    const project = await this.dependencies.application.getProject(projectId);
    if (project === null) {
      return null;
    }

    const summaries = await this.dependencies.catalog.listVersions(projectId);
    const versions = await Promise.all(summaries.map(async ({ id }) => this.requireVersion(id)));
    let currentVersion = project.currentVersionId === undefined
      ? null
      : versions.find(({ id }) => id === project.currentVersionId) ?? null;

    if (currentVersion === null && project.currentVersionId !== undefined) {
      currentVersion = await this.requireVersion(project.currentVersionId);
    }

    return { project, currentVersion, versions };
  }

  createProject(input: CreateProjectWithSourceRequest): Promise<ProjectCreationResult> {
    return this.dependencies.application.createProject(input);
  }

  async saveManualEdit(input: SaveManualEditInput): Promise<ContentVersion> {
    const parent = await this.requireVersion(input.parentVersionId);
    if (parent.projectId !== input.projectId) {
      throw new Error(
        `Content version ${parent.id} does not belong to project ${input.projectId}`,
      );
    }

    return this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: parent.id,
      kind: input.kind ?? 'draft',
      content: {
        format: 'markdown',
        title: input.title,
        body: input.body,
      },
      createdBy: 'user',
      userConfirmed: true,
      protectedFields: parent.protectedFields,
      sourceRefs: parent.sourceRefs,
    });
  }

  restoreVersion(projectId: string, versionId: string): Promise<ContentVersion> {
    return this.dependencies.projectService.restoreVersion({ projectId, versionId });
  }

  runWorkflow(input: HumanInkWorkflowInput): TaskRecord {
    const versionId = input.versionId;
    switch (input.workflow) {
      case 'titles':
        return this.dependencies.application.generateTitles({
          projectId: input.projectId,
          sourceVersionId: input.sourceVersionId ?? this.requireInput(versionId, 'sourceVersionId'),
          count: 5,
        });
      case 'brief':
        return this.dependencies.application.generateBrief({
          projectId: input.projectId,
          sourceVersionId: input.sourceVersionId ?? this.requireInput(versionId, 'sourceVersionId'),
          ...(input.selectedTitle === undefined ? {} : { selectedTitle: input.selectedTitle }),
        });
      case 'outline':
        return this.dependencies.application.generateOutline({
          projectId: input.projectId,
          briefVersionId: input.briefVersionId ?? this.requireInput(versionId, 'briefVersionId'),
        });
      case 'draft':
        return this.dependencies.application.generateDraft({
          projectId: input.projectId,
          briefVersionId: this.requireInput(input.briefVersionId, 'briefVersionId'),
          outlineVersionId: input.outlineVersionId ?? this.requireInput(versionId, 'outlineVersionId'),
          length: 'medium',
        });
      case 'humanize':
        return this.dependencies.application.humanizeContent({
          projectId: input.projectId,
          versionId: this.requireInput(versionId, 'versionId'),
        });
      case 'review':
        return this.dependencies.application.reviewContent({
          projectId: input.projectId,
          versionId: this.requireInput(versionId, 'versionId'),
        });
    }
  }

  getTask(taskId: string): TaskRecord | null {
    return this.dependencies.application.getTask(taskId);
  }

  listTasks(projectId?: string): readonly TaskRecord[] {
    return this.dependencies.application.listTasks(projectId);
  }

  cancelTask(taskId: string): boolean {
    return this.dependencies.application.cancelTask(taskId);
  }

  exportMarkdown(versionId: string): Promise<string> {
    return this.dependencies.application.exportVersion(versionId);
  }

  private requireInput(value: string | undefined, field: string): string {
    if (value === undefined || value.trim().length === 0) {
      throw new TypeError(`${field} is required for this workflow`);
    }
    return value;
  }

  private async requireVersion(versionId: string): Promise<ContentVersion> {
    const version = await this.dependencies.application.getVersion(versionId);
    if (version === null) {
      throw new Error(`Content version not found: ${versionId}`);
    }
    return version;
  }
}
