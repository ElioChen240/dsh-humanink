import type { LlmProvider, LlmRequest, LlmResponse } from '@humanink/core';

export interface HarnessContentBlockLike {
  readonly type: string;
  readonly text?: string;
}

export interface HarnessMessageLike {
  readonly id: string;
  readonly role: 'user';
  readonly content: readonly HarnessContentBlockLike[];
  readonly source: { readonly kind: 'user' };
}

export interface HarnessGenerateOptionsLike {
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly HarnessMessageLike[];
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export interface HarnessStreamChunk {
  readonly type?: string;
  readonly index?: number;
  readonly text?: string;
  readonly block?: HarnessContentBlockLike;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly reason?: {
    readonly kind?: string;
    readonly failure?: HarnessLlmFailure;
  };
}

export interface HarnessLlmFailure {
  readonly code?: string;
  readonly message?: string;
  readonly requestId?: string;
  readonly status?: number | string;
  readonly retryable?: boolean;
}

export interface HarnessLlmServiceLike {
  readonly stream: (options: HarnessGenerateOptionsLike) => AsyncIterable<HarnessStreamChunk>;
}

export interface HarnessLlmProviderOptions {
  readonly provider: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export class HarnessLlmFailureError extends Error {
  override readonly name = 'HarnessLlmFailureError';
  readonly code?: string;
  readonly requestId?: string;
  readonly status?: number | string;
  readonly retryable?: boolean;

  constructor(failure?: HarnessLlmFailure) {
    super('Harness LLM request failed.');
    const code = failure?.code?.trim();
    const requestId = failure?.requestId?.trim();
    if (code !== undefined && code.length > 0) {
      this.code = code;
    }
    if (requestId !== undefined && requestId.length > 0) {
      this.requestId = requestId;
    }
    if (failure?.status !== undefined) {
      this.status = failure.status;
    }
    if (failure?.retryable !== undefined) {
      this.retryable = failure.retryable;
    }
  }
}

function requireOptionText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  return normalized;
}

function validateProviderOptions(options: HarnessLlmProviderOptions): HarnessLlmProviderOptions {
  if (
    options.temperature !== undefined
    && (!Number.isFinite(options.temperature) || options.temperature < 0)
  ) {
    throw new TypeError('temperature must be a non-negative finite number');
  }
  if (
    options.maxTokens !== undefined
    && (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)
  ) {
    throw new TypeError('maxTokens must be a positive integer');
  }

  return {
    provider: requireOptionText(options.provider, 'provider'),
    ...(options.model === undefined ? {} : { model: requireOptionText(options.model, 'model') }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  };
}

function abortError(): DOMException {
  return new DOMException('The LLM request was aborted.', 'AbortError');
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function createRequestMessage(request: LlmRequest): HarnessMessageLike {
  const attemptId = `humanink_${crypto.randomUUID()}`;
  const operationId = request.operationId?.trim();
  return {
    id: attemptId,
    role: 'user',
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...(operationId === undefined || operationId.length === 0 ? {} : { operationId }),
        attemptId,
        task: request.task,
        promptTemplateVersion: request.promptTemplateVersion,
        input: request.input,
        outputSchema: request.outputSchema,
      }, null, 2),
    }],
    source: { kind: 'user' },
  };
}

function parseStructuredOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.length === 0) {
    throw new Error('Harness LLM returned an empty response');
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch (error) {
    throw new Error('Harness LLM returned invalid JSON', { cause: error });
  }
}

function errorForFinish(chunk: HarnessStreamChunk): Error | undefined {
  const kind = chunk.reason?.kind;
  if (kind === 'aborted') {
    return abortError();
  }
  if (kind !== 'error') {
    return undefined;
  }
  return new HarnessLlmFailureError(chunk.reason?.failure);
}

export class HarnessLlmProvider implements LlmProvider {
  private readonly options: HarnessLlmProviderOptions;

  constructor(
    private readonly service: HarnessLlmServiceLike,
    options: HarnessLlmProviderOptions,
  ) {
    this.options = validateProviderOptions(options);
  }

  async generate<T>(request: LlmRequest): Promise<LlmResponse<T>> {
    assertNotAborted(request.signal);
    const model = request.model ?? this.options.model;
    if (model === undefined || model.trim().length === 0) {
      throw new Error('Harness LLM model is not configured');
    }

    const streamOptions = {
      provider: this.options.provider,
      model,
      messages: [createRequestMessage(request)],
      system: request.system,
      ...(request.temperature ?? this.options.temperature) === undefined
        ? {}
        : { temperature: request.temperature ?? this.options.temperature },
      ...(this.options.maxTokens === undefined ? {} : { maxTokens: this.options.maxTokens }),
      signal: request.signal,
    };
    const chunks = this.service.stream(streamOptions);
    let text = '';
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let providerRequestId: string | undefined;
    const textDeltaIndexes = new Set<number>();

    for await (const chunk of chunks) {
      assertNotAborted(request.signal);
      const finishError = errorForFinish(chunk);
      if (finishError !== undefined) {
        throw finishError;
      }
      if (chunk.type === 'text-delta' && chunk.text !== undefined) {
        text += chunk.text;
        if (chunk.index !== undefined) {
          textDeltaIndexes.add(chunk.index);
        }
      }
      if (
        chunk.type === 'block-end'
        && chunk.block?.type === 'text'
        && chunk.block.text !== undefined
        && (chunk.index === undefined || !textDeltaIndexes.has(chunk.index))
      ) {
        text += chunk.block.text;
      }
      if (chunk.type === 'usage' && chunk.usage !== undefined) {
        usage = {
          ...(chunk.usage.inputTokens === undefined ? {} : { inputTokens: chunk.usage.inputTokens }),
          ...(chunk.usage.outputTokens === undefined ? {} : { outputTokens: chunk.usage.outputTokens }),
        };
      }
      const requestId = chunk.reason?.failure?.requestId;
      if (requestId !== undefined) {
        providerRequestId = requestId;
      }
    }

    assertNotAborted(request.signal);
    return {
      value: parseStructuredOutput(text) as T,
      ...(providerRequestId === undefined ? {} : { providerRequestId }),
      model,
      ...(usage === undefined ? {} : { usage }),
    };
  }
}
