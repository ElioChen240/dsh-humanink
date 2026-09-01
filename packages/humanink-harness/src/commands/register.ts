import type { TaskRecord } from '../runtime/task-runtime.js';
import type {
  HarnessCommandDefinition,
  HarnessCommandDisposer,
  HarnessCommandInvocation,
  HarnessCommandRegistryLike,
  HarnessCommandResult,
  HumanInkCommandApplication,
} from './contracts.js';
import {
  CommandInputError,
  parseBriefGenerationInput,
  parseCreateProjectInput,
  parseDraftGenerationInput,
  parseHumanizeRewriteInput,
  parseIdentifier,
  parseJsonObject,
  parseOutlineGenerationInput,
  parseReviewInput,
  parseTitleGenerationInput,
} from './input.js';

const commandNamePattern = /^[a-z][a-z0-9_-]*$/;

function successJson(value: unknown): HarnessCommandResult {
  return { kind: 'success', text: JSON.stringify(value) };
}

function errorJson(code: string, message: string): HarnessCommandResult {
  return { kind: 'error', text: JSON.stringify({ code, message }) };
}

function safeError(error: unknown): HarnessCommandResult {
  if (error instanceof CommandInputError) {
    return errorJson(error.code, error.safeMessage);
  }
  return errorJson('COMMAND_FAILED', '命令执行失败，请检查输入或资源状态后重试。');
}

function generationResult(task: Pick<TaskRecord, 'id' | 'status'>): HarnessCommandResult {
  return successJson({ taskId: task.id, status: task.status });
}

function jsonCommand(
  definition: Omit<HarnessCommandDefinition, 'handler'> & {
    readonly handler: (
      input: Record<string, unknown>,
      invocation: HarnessCommandInvocation,
    ) => HarnessCommandResult | Promise<HarnessCommandResult>;
  },
): HarnessCommandDefinition {
  return {
    name: definition.name,
    description: definition.description,
    ...(definition.input === undefined ? {} : { input: definition.input }),
    async handler(invocation) {
      try {
        return await definition.handler(parseJsonObject(invocation.rawInput), invocation);
      } catch (error) {
        return safeError(error);
      }
    },
  };
}

function guardedCommand(
  definition: Omit<HarnessCommandDefinition, 'handler'> & {
    readonly handler: (
      invocation: HarnessCommandInvocation,
    ) => HarnessCommandResult | Promise<HarnessCommandResult>;
  },
): HarnessCommandDefinition {
  return {
    name: definition.name,
    description: definition.description,
    ...(definition.input === undefined ? {} : { input: definition.input }),
    async handler(invocation) {
      try {
        return await definition.handler(invocation);
      } catch (error) {
        return safeError(error);
      }
    },
  };
}

function requireTask(application: HumanInkCommandApplication, taskId: string): TaskRecord {
  const task = application.getTask(taskId);
  if (task === null) {
    throw new CommandInputError('TASK_NOT_FOUND', '未找到指定任务。');
  }
  return task;
}

function commandDefinitions(application: HumanInkCommandApplication): readonly HarnessCommandDefinition[] {
  return [
    jsonCommand({
      name: 'humanink-create',
      description: '创建 HumanInk 内容项目并保存原始素材。',
      input: { hint: '{"title":"文章标题","source":{"title":"原始标题","body":"原始正文"}}' },
      async handler(input) {
        const created = await application.createProject(
          parseCreateProjectInput(input),
        );
        return successJson({
          projectId: created.project.id,
          sourceVersionId: created.sourceVersion.id,
        });
      },
    }),
    jsonCommand({
      name: 'humanink-title',
      description: '基于原始内容启动爆款标题生成任务。',
      input: { hint: '{"projectId":"...","sourceVersionId":"...","count":5}' },
      handler(input, invocation) {
        return generationResult(application.generateTitles(
          parseTitleGenerationInput(input),
          invocation.signal,
        ));
      },
    }),
    jsonCommand({
      name: 'humanink-brief',
      description: '基于原始内容启动写作简报生成任务。',
      input: { hint: '{"projectId":"...","sourceVersionId":"..."}' },
      handler(input, invocation) {
        return generationResult(application.generateBrief(
          parseBriefGenerationInput(input),
          invocation.signal,
        ));
      },
    }),
    jsonCommand({
      name: 'humanink-outline',
      description: '基于内容简报启动文章大纲生成任务。',
      input: { hint: '{"projectId":"...","briefVersionId":"..."}' },
      handler(input, invocation) {
        return generationResult(application.generateOutline(
          parseOutlineGenerationInput(input),
          invocation.signal,
        ));
      },
    }),
    jsonCommand({
      name: 'humanink-draft',
      description: '基于简报和大纲启动 Markdown 初稿生成任务。',
      input: { hint: '{"projectId":"...","briefVersionId":"...","outlineVersionId":"..."}' },
      handler(input, invocation) {
        return generationResult(application.generateDraft(
          parseDraftGenerationInput(input),
          invocation.signal,
        ));
      },
    }),
    jsonCommand({
      name: 'humanink-humanize',
      description: '对指定内容版本进行自然、具体且保留事实的人味化改写。',
      input: { hint: '{"projectId":"...","versionId":"...","direction":"更自然具体"}' },
      handler(input, invocation) {
        return generationResult(application.humanizeContent(
          parseHumanizeRewriteInput(input),
          invocation.signal,
        ));
      },
    }),
    jsonCommand({
      name: 'humanink-review',
      description: '对指定文章版本执行发布前复核并生成结构化问题清单。',
      input: { hint: '{"projectId":"...","versionId":"..."}' },
      handler(input, invocation) {
        return generationResult(application.reviewContent(
          parseReviewInput(input),
          invocation.signal,
        ));
      },
    }),
    guardedCommand({
      name: 'humanink-task',
      description: '查询 HumanInk 任务快照。',
      input: { hint: 'taskId，或 {"taskId":"..."}' },
      handler(invocation) {
        return successJson(requireTask(application, parseIdentifier(invocation.rawInput, 'taskId')));
      },
    }),
    guardedCommand({
      name: 'humanink-cancel',
      description: '取消尚未结束的 HumanInk 任务。',
      input: { hint: 'taskId，或 {"taskId":"..."}' },
      handler(invocation) {
        const taskId = parseIdentifier(invocation.rawInput, 'taskId');
        if (!application.cancelTask(taskId)) {
          throw new CommandInputError('TASK_NOT_CANCELLABLE', '任务不存在或已经结束，无法取消。');
        }
        return successJson({
          ...requireTask(application, taskId),
          cancelAccepted: true,
        });
      },
    }),
    guardedCommand({
      name: 'humanink-export',
      description: '导出指定内容版本的 Markdown。',
      input: { hint: 'versionId，或 {"versionId":"..."}' },
      async handler(invocation) {
        const versionId = parseIdentifier(invocation.rawInput, 'versionId');
        return {
          kind: 'success',
          text: await application.exportVersion(versionId),
        };
      },
    }),
  ];
}

export function registerHumanInkCommands(
  registry: HarnessCommandRegistryLike,
  application: HumanInkCommandApplication,
): HarnessCommandDisposer {
  const definitions = commandDefinitions(application);
  const disposers: HarnessCommandDisposer[] = [];
  for (const definition of definitions) {
    if (!commandNamePattern.test(definition.name)) {
      throw new Error(`Invalid Harness command name: ${definition.name}`);
    }
    const dispose = registry.register(definition);
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
