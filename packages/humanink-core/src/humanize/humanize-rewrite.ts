import {
  diffMarkdownContent,
  validateProtectedFields,
  type ContentDiffResult,
  type ProtectedFieldValidationResult,
} from '../diff/index.js';
import type { LlmRequest } from '../ports/llm-provider.js';
import type { ContentVersion, TextContentInput } from '../versioning/content-version.js';
import {
  abortIfNeeded,
  buildModelInfo,
  createRequest,
  modelRequestSchema,
  nonEmptyString,
  objectWithExactKeys,
  requireProjectVersion,
  resolveSignal,
  stringList,
  type WritingExecutionOptions,
  type WritingUseCaseDependencies,
  type WritingVersionResult,
} from '../writing/contracts.js';

export interface HumanizeRewriteChange {
  readonly before: string;
  readonly after: string;
  readonly reason: string;
}

export interface HumanizeRewriteOutput {
  readonly title: string;
  readonly body: string;
  readonly changes: readonly HumanizeRewriteChange[];
  readonly questions: readonly string[];
}

export interface HumanizeRewriteInput {
  readonly projectId: string;
  readonly versionId: string;
  readonly direction?: string;
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
}

export interface HumanizeRewriteResult extends WritingVersionResult<HumanizeRewriteOutput> {
  readonly diff: ContentDiffResult;
  readonly protectedFieldValidation: ProtectedFieldValidationResult;
}

export class HumanizeProtectedFieldValidationError extends Error {
  readonly code = 'HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED';

  constructor(readonly validation: ProtectedFieldValidationResult) {
    super('Humanize rewrite violates protected fields');
    this.name = 'HumanizeProtectedFieldValidationError';
  }
}

export type HumanizeRewriteExecutionOptions = WritingExecutionOptions;
export type HumanizeRewriteUseCaseDependencies = WritingUseCaseDependencies;

const promptTemplateVersion = 'humanize.zh.v1';
const supportedInputKinds = new Set<ContentVersion['kind']>(['draft', 'source', 'humanized']);
const outputSchema = modelRequestSchema(
  ['title', 'body', 'changes', 'questions'],
  {
    title: { type: 'string' },
    body: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['before', 'after', 'reason'],
        properties: {
          before: { type: 'string' },
          after: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    questions: { type: 'array', items: { type: 'string' } },
  },
);

const systemPrompt = [
  '你是 HumanInk 的中文内容编辑，负责在不改变事实和用户意图的前提下提升文章的自然度、具体性和中文语感。',
  '不要以绕过 AI 检测为目标，不得编造个人经历、数据、引用、案例或其他事实。',
  '必须保留 protectedFields 和 sourceRefs 所代表的信息；素材不足时写入 questions，而不是自行补全。',
  '返回严格符合输出结构的 JSON，不要附加 Markdown 代码围栏或结构外字段。',
].join('\n');

function requireSupportedInputKind(version: ContentVersion): void {
  if (!supportedInputKinds.has(version.kind)) {
    throw new TypeError('Humanize input version must have kind draft, source, or humanized');
  }
}

function mergeMetadata(
  inherited: readonly string[],
  additional: readonly string[] | undefined,
  field: 'protectedFields' | 'sourceRefs',
): string[] {
  if (!Array.isArray(inherited)) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  if (additional !== undefined && !Array.isArray(additional)) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  const normalized = [...inherited, ...(additional ?? [])]
    .map((value, index) => nonEmptyString(value, `${field}[${index}]`));
  return [...new Set(normalized)];
}

function validateHumanizeOutput(value: unknown): HumanizeRewriteOutput {
  const object = objectWithExactKeys(
    value,
    ['title', 'body', 'changes', 'questions'],
    'humanize output',
  );
  if (!Array.isArray(object.changes)) {
    throw new TypeError('humanize.changes must be an array');
  }

  const changes = object.changes.map((change, index) => {
    const item = objectWithExactKeys(
      change,
      ['before', 'after', 'reason'],
      `humanize.changes[${index}]`,
    );
    return {
      before: nonEmptyString(item.before, `humanize.changes[${index}].before`),
      after: nonEmptyString(item.after, `humanize.changes[${index}].after`),
      reason: nonEmptyString(item.reason, `humanize.changes[${index}].reason`),
    };
  });

  return {
    title: nonEmptyString(object.title, 'humanize.title'),
    body: nonEmptyString(object.body, 'humanize.body'),
    changes,
    questions: stringList(object.questions, 'humanize.questions'),
  };
}

function articleMarkdown(title: string, body: string): string {
  return `# ${title}\n\n${body}`;
}

function createHumanizeRequest(
  input: HumanizeRewriteInput,
  version: ContentVersion,
  protectedFields: readonly string[],
  sourceRefs: readonly string[],
  signal: AbortSignal,
  options: WritingExecutionOptions,
): LlmRequest {
  const direction = input.direction === undefined
    ? undefined
    : nonEmptyString(input.direction, 'direction');
  return createRequest({
    task: 'humanize',
    promptTemplateVersion,
    system: systemPrompt,
    input: {
      projectId: input.projectId,
      versionId: input.versionId,
      versionKind: version.kind,
      ...(direction === undefined ? {} : { direction }),
      title: version.content.title,
      body: version.content.body,
      protectedFields,
      sourceRefs,
    },
    outputSchema,
  }, options, signal);
}

export class HumanizeRewriteUseCase {
  constructor(private readonly dependencies: HumanizeRewriteUseCaseDependencies) {}

  async execute(
    input: HumanizeRewriteInput,
    options: HumanizeRewriteExecutionOptions = {},
  ): Promise<HumanizeRewriteResult> {
    const signal = resolveSignal(options.signal);
    abortIfNeeded(signal);
    const inputVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.versionId,
      'Humanize input',
    );
    requireSupportedInputKind(inputVersion);
    const protectedFields = mergeMetadata(
      inputVersion.protectedFields,
      input.protectedFields,
      'protectedFields',
    );
    const sourceRefs = mergeMetadata(
      inputVersion.sourceRefs,
      input.sourceRefs,
      'sourceRefs',
    );
    const beforeMarkdown = articleMarkdown(inputVersion.content.title, inputVersion.content.body);
    const sourceProtectedFieldValidation = validateProtectedFields(
      beforeMarkdown,
      beforeMarkdown,
      protectedFields,
    );
    if (!sourceProtectedFieldValidation.valid) {
      throw new HumanizeProtectedFieldValidationError(sourceProtectedFieldValidation);
    }
    abortIfNeeded(signal);
    const response = await this.dependencies.llmProvider.generate<unknown>(
      createHumanizeRequest(input, inputVersion, protectedFields, sourceRefs, signal, options),
    );
    abortIfNeeded(signal);
    const output = validateHumanizeOutput(response.value);
    abortIfNeeded(signal);
    const afterMarkdown = articleMarkdown(output.title, output.body);
    const diff = diffMarkdownContent(beforeMarkdown, afterMarkdown, { granularity: 'sentence' });
    const protectedFieldValidation = validateProtectedFields(
      beforeMarkdown,
      afterMarkdown,
      protectedFields,
    );
    if (!protectedFieldValidation.valid) {
      throw new HumanizeProtectedFieldValidationError(protectedFieldValidation);
    }
    abortIfNeeded(signal);
    const content: TextContentInput = {
      format: 'markdown',
      title: output.title,
      body: output.body,
    };
    const version = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.versionId,
      kind: 'humanized',
      content,
      protectedFields,
      sourceRefs,
      createdBy: 'llm',
      promptTemplateVersion,
      modelInfo: buildModelInfo(response),
      userConfirmed: false,
    });
    return {
      status: 'succeeded',
      projectId: input.projectId,
      parentVersionId: input.versionId,
      version,
      output,
      diff,
      protectedFieldValidation,
    };
  }
}
