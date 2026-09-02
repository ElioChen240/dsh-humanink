import type {
  BriefGenerationInput,
  BriefGenerationUseCase,
  ContentProject,
  ContentProjectService,
  ContentRepository,
  ContentVersion,
  ContentVersionSummary,
  CreateDerivedVersionRequest,
  RestoreContentVersionInput,
  DraftGenerationInput,
  DraftGenerationUseCase,
  HumanizeRewriteInput,
  HumanizeRewriteUseCase,
  OutlineGenerationInput,
  OutlineGenerationUseCase,
  ReviewInput,
  ReviewUseCase,
  TitleGenerationInput,
  TitleGenerationUseCase,
  CreateProjectWithSourceRequest,
} from '@humanink/core';
import { TaskRuntime, type TaskRecord } from './task-runtime.js';

export interface HumanInkApplicationDependencies {
  readonly repository: ContentRepository;
  readonly projectService: Pick<ContentProjectService, 'createProject' | 'createDerivedVersion' | 'restoreVersion'>;
  readonly taskRuntime: TaskRuntime;
  readonly titleUseCase: Pick<TitleGenerationUseCase, 'execute'>;
  readonly briefUseCase: Pick<BriefGenerationUseCase, 'execute'>;
  readonly outlineUseCase: Pick<OutlineGenerationUseCase, 'execute'>;
  readonly draftUseCase: Pick<DraftGenerationUseCase, 'execute'>;
  readonly humanizeUseCase?: Pick<HumanizeRewriteUseCase, 'execute'>;
  readonly reviewUseCase?: Pick<ReviewUseCase, 'execute'>;
}

export type HumanInkCapability = 'humanize' | 'review';

export class HumanInkCapabilityUnavailableError extends Error {
  override readonly name = 'HumanInkCapabilityUnavailableError';
  readonly code = 'HUMANINK_CAPABILITY_UNAVAILABLE';

  constructor(readonly capability: HumanInkCapability) {
    super(`HumanInk capability is unavailable: ${capability}.`);
  }
}

export interface ProjectCreationResult {
  readonly project: ContentProject;
  readonly sourceVersion: ContentVersion;
}

export class HumanInkApplication {
  constructor(private readonly dependencies: HumanInkApplicationDependencies) {}

  createProject(input: CreateProjectWithSourceRequest): Promise<ProjectCreationResult> {
    return this.dependencies.projectService.createProject(input);
  }

  getProject(projectId: string): Promise<ContentProject | null> {
    return this.dependencies.repository.getProject(projectId);
  }

  listProjects(): Promise<readonly ContentProject[]> {
    return this.dependencies.repository.listProjects();
  }

  listVersions(projectId: string): Promise<readonly ContentVersionSummary[]> {
    return this.dependencies.repository.listVersions(projectId);
  }

  getVersion(versionId: string): Promise<ContentVersion | null> {
    return this.dependencies.repository.getVersion(versionId);
  }

  createDerivedVersion(input: CreateDerivedVersionRequest): Promise<ContentVersion> {
    return this.dependencies.projectService.createDerivedVersion(input);
  }

  restoreVersion(input: {
    readonly projectId: string;
    readonly versionId: string;
    readonly createdBy?: RestoreContentVersionInput['createdBy'];
  }): Promise<ContentVersion> {
    return this.dependencies.projectService.restoreVersion(input);
  }

  generateTitles(input: TitleGenerationInput, signal?: AbortSignal): TaskRecord {
    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'title', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await this.dependencies.titleUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.contentVersionId });
        return result;
      },
    );
  }

  generateBrief(input: BriefGenerationInput, signal?: AbortSignal): TaskRecord {
    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'brief', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await this.dependencies.briefUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.version.id });
        return result;
      },
    );
  }

  generateOutline(input: OutlineGenerationInput, signal?: AbortSignal): TaskRecord {
    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'outline', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await this.dependencies.outlineUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.version.id });
        return result;
      },
    );
  }

  generateDraft(input: DraftGenerationInput, signal?: AbortSignal): TaskRecord {
    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'draft', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await this.dependencies.draftUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.version.id });
        return result;
      },
    );
  }

  humanizeContent(input: HumanizeRewriteInput, signal?: AbortSignal): TaskRecord {
    const humanizeUseCase = this.dependencies.humanizeUseCase;
    if (humanizeUseCase === undefined) {
      throw new HumanInkCapabilityUnavailableError('humanize');
    }

    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'humanize', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await humanizeUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.version.id });
        return result;
      },
    );
  }

  reviewContent(input: ReviewInput, signal?: AbortSignal): TaskRecord {
    const reviewUseCase = this.dependencies.reviewUseCase;
    if (reviewUseCase === undefined) {
      throw new HumanInkCapabilityUnavailableError('review');
    }

    return this.dependencies.taskRuntime.start(
      { projectId: input.projectId, type: 'review', ...(signal === undefined ? {} : { signal }) },
      async ({ signal: taskSignal, operationId, update }) => {
        const result = await reviewUseCase.execute(input, {
          signal: taskSignal,
          operationId,
        });
        update({ contentVersionId: result.version.id });
        return result;
      },
    );
  }

  getTask(taskId: string): TaskRecord | null {
    return this.dependencies.taskRuntime.get(taskId);
  }

  listTasks(projectId?: string): readonly TaskRecord[] {
    return this.dependencies.taskRuntime.list(projectId);
  }

  waitForTask(taskId: string): Promise<TaskRecord> {
    return this.dependencies.taskRuntime.waitForTerminal(taskId);
  }

  cancelTask(taskId: string): boolean {
    return this.dependencies.taskRuntime.cancel(taskId);
  }

  async exportVersion(versionId: string): Promise<string> {
    const version = await this.dependencies.repository.getVersion(versionId);
    if (version === null) {
      throw new Error(`Content version not found: ${versionId}`);
    }
    const title = version.content.title.trim();
    return title.length === 0
      ? `${version.content.body.trim()}\n`
      : `# ${title}\n\n${version.content.body.trim()}\n`;
  }

}
