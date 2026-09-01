import {
  BriefGenerationUseCase,
  ContentProjectService,
  DraftGenerationUseCase,
  HumanizeRewriteUseCase,
  OutlineGenerationUseCase,
  ReviewUseCase,
  TitleGenerationUseCase,
} from '@humanink/core';
import { FileContentRepository } from '@humanink/storage';
import { resolve } from 'node:path';
import { registerHumanInkCommands, type HarnessCommandRegistryLike } from './commands/index.js';
import { HumanInkApplication } from './runtime/humanink-application.js';
import { TaskRuntime } from './runtime/task-runtime.js';
import { FileTaskStore } from './services/file-task-store.js';
import { HarnessLlmProvider, type HarnessLlmServiceLike } from './services/llm-provider.js';
import { ResilientLlmProvider } from './services/resilient-llm-provider.js';

export const name = 'humanink';
export const inject = ['commands', 'llm'] as const;

export interface HumanInkHarnessContext {
  readonly commands: HarnessCommandRegistryLike;
  readonly llm: HarnessLlmServiceLike;
}

export interface HumanInkHarnessConfig {
  readonly dataDir?: string;
  readonly provider: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  return normalized;
}

export function createHumanInkApplication(
  ctx: Pick<HumanInkHarnessContext, 'llm'>,
  config: HumanInkHarnessConfig,
): HumanInkApplication {
  const harnessLlmProvider = new HarnessLlmProvider(ctx.llm, {
    provider: requireText(config.provider, 'provider'),
    model: requireText(config.model, 'model'),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
  });
  const llmProvider = new ResilientLlmProvider(harnessLlmProvider, {
    timeoutMs: config.timeoutMs ?? 60_000,
    maxAttempts: config.maxAttempts ?? 3,
    backoffMs: config.backoffMs ?? 500,
  });

  const dataDir = resolve(config.dataDir === undefined ? '.humanink' : requireText(config.dataDir, 'dataDir'));
  const repository = new FileContentRepository(dataDir);
  const projectService = new ContentProjectService(repository);
  const taskRuntime = new TaskRuntime({
    store: new FileTaskStore(dataDir),
    resolveCommittedVersionId: (operationId) => repository.findCommittedVersionByOperationId(operationId)?.id ?? null,
  });

  return new HumanInkApplication({
    repository,
    projectService,
    taskRuntime,
    titleUseCase: new TitleGenerationUseCase({ repository, projectService, llmProvider }),
    briefUseCase: new BriefGenerationUseCase({ repository, projectService, llmProvider }),
    outlineUseCase: new OutlineGenerationUseCase({ repository, projectService, llmProvider }),
    draftUseCase: new DraftGenerationUseCase({ repository, projectService, llmProvider }),
    humanizeUseCase: new HumanizeRewriteUseCase({ repository, projectService, llmProvider }),
    reviewUseCase: new ReviewUseCase({ repository, projectService, llmProvider }),
  });
}

export function apply(ctx: HumanInkHarnessContext, config: HumanInkHarnessConfig): () => void {
  const application = createHumanInkApplication(ctx, config);
  return registerHumanInkCommands(ctx.commands, application);
}
