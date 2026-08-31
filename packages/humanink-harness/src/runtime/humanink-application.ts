import type {
  BriefGenerationInput,
  BriefGenerationUseCase,
  ContentProject,
  ContentProjectService,
  ContentRepository,
  ContentVersion,
  DraftGenerationInput,
  DraftGenerationUseCase,
  OutlineGenerationInput,
  OutlineGenerationUseCase,
  TitleGenerationInput,
  TitleGenerationUseCase,
  CreateProjectWithSourceRequest,
} from '@humanink/core';
import { TaskRuntime, type TaskRecord } from './task-runtime.js';

export interface HumanInkApplicationDependencies {
  readonly repository: ContentRepository;
  readonly projectService: Pick<ContentProjectService, 'createProject'>;
  readonly taskRuntime: TaskRuntime;
  readonly titleUseCase: Pick<TitleGenerationUseCase, 'execute'>;
  readonly briefUseCase: Pick<BriefGenerationUseCase, 'execute'>;
  readonly outlineUseCase: Pick<OutlineGenerationUseCase, 'execute'>;
  readonly draftUseCase: Pick<DraftGenerationUseCase, 'execute'>;
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

  getVersion(versionId: string): Promise<ContentVersion | null> {
    return this.dependencies.repository.getVersion(versionId);
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
