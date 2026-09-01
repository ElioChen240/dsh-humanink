import type { ContentRepository } from '../repository/content-repository.js';
import { ProjectVersionMismatchError, ParentVersionNotFoundError } from '../repository/errors.js';
import type { ContentProjectService } from '../project/content-project-service.js';
import type { LlmProvider, LlmRequest } from '../ports/llm-provider.js';

export interface TitleCandidate {
  readonly title: string;
  readonly strategy: string;
  readonly reason: string;
  readonly riskFlags: readonly string[];
}

export interface TitleGenerationInput {
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly brief?: string;
  readonly audience?: string;
  readonly count?: number;
}

export interface TitleGenerationExecutionOptions {
  readonly signal?: AbortSignal;
  readonly operationId?: string;
}

export interface TitleGenerationResult {
  readonly status: 'succeeded';
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly versionId: string;
  readonly contentVersionId: string;
  readonly candidates: readonly TitleCandidate[];
}

export interface TitleGenerationUseCaseDependencies {
  readonly repository: ContentRepository;
  readonly projectService: Pick<ContentProjectService, 'createDerivedVersion'>;
  readonly llmProvider: LlmProvider;
}

const promptTemplateVersion = 'title.zh.v1';
function buildOutputSchema(count: number): string {
  return JSON.stringify({
    type: 'array',
    minItems: 1,
    maxItems: count,
    items: {
      type: 'object',
      required: ['title', 'strategy', 'reason', 'riskFlags'],
      properties: {
        title: { type: 'string' },
        strategy: { type: 'string' },
        reason: { type: 'string' },
        riskFlags: { type: 'array', items: { type: 'string' } },
      },
    },
  });
}

const systemPrompt = [
  '你是 HumanInk 的中文标题编辑。',
  '请基于用户提供的文章素材生成可被正文支撑的标题候选。',
  '不要虚构事实，不使用夸张承诺，不把检测分数当作标题目标。',
  '只返回符合输出结构的 JSON 数组，不要附加 Markdown 代码围栏。',
].join('\n');

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('标题生成已取消');
    error.name = 'AbortError';
    throw error;
  }
}

function normalizeCount(count: number | undefined): number {
  if (count === undefined) {
    return 5;
  }
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new RangeError('标题候选数量必须是 1 到 10 之间的整数');
  }
  return count;
}

function asCandidateList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value !== null
    && typeof value === 'object'
    && Array.isArray((value as { candidates?: unknown }).candidates)
  ) {
    return (value as { candidates: unknown[] }).candidates;
  }
  throw new TypeError('标题候选输出必须是数组');
}

function validateCandidates(value: unknown, maxCount: number): TitleCandidate[] {
  const rawCandidates = asCandidateList(value);
  if (rawCandidates.length < 1) {
    throw new RangeError('标题候选数量必须至少为 1');
  }
  if (rawCandidates.length > maxCount) {
    throw new RangeError(`标题候选数量不能超过请求数量 ${maxCount}`);
  }

  return rawCandidates.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object') {
      throw new TypeError(`第 ${index + 1} 个标题候选必须是对象`);
    }

    const item = candidate as Record<string, unknown>;
    if (typeof item.title !== 'string') {
      throw new TypeError(`第 ${index + 1} 个标题候选的 title 必须是字符串`);
    }
    if (typeof item.strategy !== 'string') {
      throw new TypeError(`第 ${index + 1} 个标题候选的 strategy 必须是字符串`);
    }
    if (typeof item.reason !== 'string') {
      throw new TypeError(`第 ${index + 1} 个标题候选的 reason 必须是字符串`);
    }
    if (!Array.isArray(item.riskFlags) || !item.riskFlags.every((flag) => typeof flag === 'string')) {
      throw new TypeError(`第 ${index + 1} 个标题候选的 riskFlags 必须是字符串数组`);
    }

    const title = item.title.trim();
    const strategy = item.strategy.trim();
    const reason = item.reason.trim();
    const riskFlags = item.riskFlags.map((flag) => flag.trim());
    if (title.length === 0) {
      throw new TypeError(`第 ${index + 1} 个标题候选不能为空`);
    }
    if (strategy.length === 0) {
      throw new TypeError(`第 ${index + 1} 个标题候选的 strategy 不能为空`);
    }
    if (reason.length === 0) {
      throw new TypeError(`第 ${index + 1} 个标题候选的 reason 不能为空`);
    }
    if (riskFlags.some((flag) => flag.length === 0)) {
      throw new TypeError(`第 ${index + 1} 个标题候选的 riskFlags 不能包含空字符串`);
    }

    return {
      title,
      strategy,
      reason,
      riskFlags,
    };
  });
}

function buildModelInfo(response: { readonly model?: string; readonly providerRequestId?: string; readonly usage?: unknown }) {
  return {
    ...(response.model === undefined ? {} : { model: response.model }),
    ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
    ...(response.usage === undefined ? {} : { usage: response.usage }),
  };
}

export class TitleGenerationUseCase {
  constructor(private readonly dependencies: TitleGenerationUseCaseDependencies) {}

  async execute(
    input: TitleGenerationInput,
    options: TitleGenerationExecutionOptions = {},
  ): Promise<TitleGenerationResult> {
    const signal = options.signal ?? new AbortController().signal;
    abortIfNeeded(signal);

    const sourceVersion = await this.dependencies.repository.getVersion(input.sourceVersionId);
    if (sourceVersion === null) {
      throw new ParentVersionNotFoundError(input.sourceVersionId, '源版本不存在');
    }
    if (sourceVersion.projectId !== input.projectId) {
      throw new ProjectVersionMismatchError(input.projectId, input.sourceVersionId);
    }

    const count = normalizeCount(input.count);
    const request: LlmRequest = {
      task: 'title',
      promptTemplateVersion,
      system: systemPrompt,
      input: {
        projectId: input.projectId,
        sourceVersionId: input.sourceVersionId,
        sourceTitle: sourceVersion.content.title,
        sourceText: sourceVersion.content.body,
        ...(input.brief === undefined ? {} : { brief: input.brief }),
        ...(input.audience === undefined ? {} : { audience: input.audience }),
        count,
      },
      outputSchema: buildOutputSchema(count),
      signal,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    };

    const response = await this.dependencies.llmProvider.generate<unknown>(request);
    abortIfNeeded(signal);
    const candidates = validateCandidates(response.value, count);
    abortIfNeeded(signal);
    const titleVersion = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.sourceVersionId,
      kind: 'title',
      content: {
        title: sourceVersion.content.title,
        body: JSON.stringify(candidates),
      },
      createdBy: 'llm',
      promptTemplateVersion,
      modelInfo: buildModelInfo(response),
      userConfirmed: false,
    });

    return {
      status: 'succeeded',
      projectId: input.projectId,
      sourceVersionId: input.sourceVersionId,
      versionId: titleVersion.id,
      contentVersionId: titleVersion.id,
      candidates,
    };
  }
}
