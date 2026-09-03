import Schema from '@deepseek-ai/schemastery';
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
import { HumanInkWorkbenchService } from './application/workbench-service.js';
import { CapabilityService } from './capabilities/capability-service.js';
import { registerHumanInkTools, type HumanInkToolsContext } from './tools/register.js';
import { registerHumanInkWorkbenchSkill, type HumanInkSkillsContext } from './skills/workbench-skill.js';
import { registerHumanInkLibraryPrompt, type HumanInkSystemPromptContext } from './prompts/library-prompt.js';
import { registerHumanInkCommands, type HarnessCommandRegistryLike } from './commands/index.js';
import { HumanInkApplication } from './runtime/humanink-application.js';
import { TaskRuntime } from './runtime/task-runtime.js';
import { FileTaskStore } from './services/file-task-store.js';
import { HarnessLlmProvider, type HarnessLlmServiceLike } from './services/llm-provider.js';
import { ResilientLlmProvider } from './services/resilient-llm-provider.js';
import { HumanInkUiFacade } from './ui/humanink-ui-facade.js';
import { registerHumanInkWorkbenchRemote } from './remote/host.js';
import { registerHumanInkUiRpc, type HumanInkConnectionLike } from './ui/humanink-ui-transport.js';

export const name = 'dsh-humanink';
// The browser Connection transport is optional. Requiring it here would keep
// command-only or partially degraded hosts pending before apply() can register.
export const inject = ['commands', 'llm'] as const;

export interface HumanInkHarnessContext {
  readonly commands: HarnessCommandRegistryLike;
  readonly llm: HarnessLlmServiceLike;
  readonly connection?: HumanInkConnectionLike;
  readonly inject?: (services: readonly string[], callback: (context: unknown) => (() => void) | void) => unknown;
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

/**
 * DeepSeek Harness uses this Standard Schema export to validate cordis.yml
 * configuration and to provide defaults when the bundle is installed.
 */
export const Config = Schema.object({
  dataDir: Schema.string().pattern(/\S/).default('.humanink'),
  provider: Schema.string().pattern(/\S/).default('deepseek'),
  model: Schema.string().pattern(/\S/).default('deepseek-chat'),
  temperature: Schema.number().min(0),
  maxTokens: Schema.natural().min(1),
  timeoutMs: Schema.number().min(1).default(60_000),
  maxAttempts: Schema.natural().min(1).default(3),
  backoffMs: Schema.number().min(0).default(500),
});

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
  const disposeCommands = registerHumanInkCommands(ctx.commands, application);
  const facade = new HumanInkUiFacade({
    application,
    catalog: application,
    projectService: application,
  });
  const dataDir = resolve(config.dataDir === undefined ? '.humanink' : requireText(config.dataDir, 'dataDir'));
  const workbench = new HumanInkWorkbenchService({
    application,
    initialLibraryRoot: dataDir,
    capabilityService: new CapabilityService({
      libraryRoot: dataDir,
      llm: () => true,
      remote: () => ctx.connection !== undefined,
    }),
  });
  ctx.inject?.(['tools'], (toolContext) => registerHumanInkTools(toolContext as HumanInkToolsContext, workbench));
  ctx.inject?.(['skills'], (skillContext) => registerHumanInkWorkbenchSkill(skillContext as HumanInkSkillsContext));
  ctx.inject?.(['systemPrompt'], (promptContext) => registerHumanInkLibraryPrompt(
    promptContext as HumanInkSystemPromptContext,
    () => ({ libraryRoot: dataDir, writingProfile: '' }),
  ));

  const disposeRpc = ctx.connection === undefined ? undefined : registerHumanInkUiRpc(ctx.connection, facade);
  const disposeWorkbenchRemote = ctx.connection === undefined ? undefined : registerHumanInkWorkbenchRemote(ctx.connection, workbench);

  return () => {
    disposeCommands();
    if (disposeWorkbenchRemote !== undefined) void disposeWorkbenchRemote();
    if (disposeRpc !== undefined) void disposeRpc();
  };
}
