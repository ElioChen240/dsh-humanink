import type { LlmProvider, LlmRequest, LlmResponse } from '@humanink/core';

export type ResilientLlmProviderErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_INVALID_RESPONSE'
  | 'LLM_PROVIDER_FAILED';

export class ResilientLlmProviderError extends Error {
  override readonly name = 'ResilientLlmProviderError';

  constructor(
    readonly code: ResilientLlmProviderErrorCode,
    readonly attempts: number,
    message: string,
  ) {
    super(message);
  }
}

export type ResilientLlmSleep = (delayMs: number, signal: AbortSignal) => Promise<void>;
export type ResilientLlmScheduleTimeout = (callback: () => void, delayMs: number) => unknown;
export type ResilientLlmClearTimeout = (handle: unknown) => void;

export interface ResilientLlmProviderOptions {
  readonly timeoutMs: number;
  readonly maxElapsedMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly sleep?: ResilientLlmSleep;
  readonly scheduleTimeout?: ResilientLlmScheduleTimeout;
  readonly clearTimeout?: ResilientLlmClearTimeout;
}

class AttemptTimeoutError extends Error {
  override readonly name = 'AttemptTimeoutError';

  constructor(readonly timeoutMs: number) {
    super(`LLM attempt timed out after ${timeoutMs} ms`);
  }
}

class OverallDeadlineError extends Error {
  override readonly name = 'OverallDeadlineError';

  constructor(readonly maxElapsedMs: number) {
    super(`LLM request exceeded its overall deadline after ${maxElapsedMs} ms`);
  }
}

interface ErrorRecord {
  readonly retryable?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly code?: unknown;
  readonly cause?: unknown;
}

const transientStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientErrorCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function abortError(): DOMException {
  return new DOMException('The LLM request was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function toRecord(value: unknown): ErrorRecord | undefined {
  return typeof value === 'object' && value !== null ? value as ErrorRecord : undefined;
}

function errorChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && chain.length < 4 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = toRecord(current)?.cause;
  }

  return chain;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return 'Unknown LLM provider failure';
}

function isInvalidResponseError(error: unknown): boolean {
  return errorChain(error).some((candidate) => {
    if (candidate instanceof SyntaxError) {
      return true;
    }
    const record = toRecord(candidate);
    const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
    if (
      code.includes('VALIDATION')
      || code.includes('INVALID_JSON')
      || code.includes('INVALID_RESPONSE')
      || code.includes('SCHEMA')
    ) {
      return true;
    }
    const message = errorMessage(candidate);
    return /invalid\s+(?:json|input|output|response)|malformed\s+json|schema\s+(?:error|validation)|validation\s+(?:error|failed)|empty\s+response|failed\s+to\s+(?:parse|validate)/i.test(message);
  });
}

function explicitRetryable(error: unknown): boolean | undefined {
  for (const candidate of errorChain(error)) {
    const retryable = toRecord(candidate)?.retryable;
    if (typeof retryable === 'boolean') {
      return retryable;
    }
  }
  return undefined;
}

function isTransientStatus(value: unknown): boolean {
  const status = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value)
      ? Number(value)
      : Number.NaN;
  return transientStatusCodes.has(status);
}

function hasTransientSignal(error: unknown): boolean {
  return errorChain(error).some((candidate) => {
    const record = toRecord(candidate);
    if (isTransientStatus(record?.status) || isTransientStatus(record?.statusCode)) {
      return true;
    }
    const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
    if (transientErrorCodes.has(code)) {
      return true;
    }
    return /\b429\b|rate[ -]?limit|too many requests|temporar(?:y|ily)|service unavailable|overload(?:ed)?|gateway (?:timeout|error)|network (?:error|failure)|fetch failed|socket (?:closed|hang up|reset)|connection (?:closed|reset|refused)|timed? out|timeout/i.test(
      errorMessage(candidate),
    );
  });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AttemptTimeoutError) {
    return true;
  }
  if (error instanceof OverallDeadlineError) {
    return false;
  }
  if (isAbortError(error) || isInvalidResponseError(error)) {
    return false;
  }

  const explicit = explicitRetryable(error);
  if (explicit !== undefined) {
    return explicit;
  }
  if (hasTransientSignal(error)) {
    return true;
  }
  return false;
}

function safeProviderError(error: unknown, attempts: number): ResilientLlmProviderError {
  if (error instanceof OverallDeadlineError) {
    return new ResilientLlmProviderError(
      'LLM_TIMEOUT',
      attempts,
      'LLM request exceeded its overall deadline.',
    );
  }
  if (error instanceof AttemptTimeoutError) {
    return new ResilientLlmProviderError(
      'LLM_TIMEOUT',
      attempts,
      `LLM request timed out after ${error.timeoutMs} ms.`,
    );
  }

  const invalidResponse = isInvalidResponseError(error);
  return new ResilientLlmProviderError(
    invalidResponse ? 'LLM_INVALID_RESPONSE' : 'LLM_PROVIDER_FAILED',
    attempts,
    invalidResponse
      ? 'LLM provider returned an invalid response.'
      : 'LLM provider request failed.',
  );
}

function defaultScheduleTimeout(callback: () => void, delayMs: number): unknown {
  return globalThis.setTimeout(callback, delayMs);
}

function defaultClearTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const handle = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(handle);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

function waitWithRequestGuards<T>(
  promise: Promise<T>,
  requestSignal: AbortSignal,
  deadlineSignal: AbortSignal,
  deadlineError: OverallDeadlineError,
): Promise<T> {
  assertNotAborted(requestSignal);
  if (deadlineSignal.aborted) {
    throw deadlineError;
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      requestSignal.removeEventListener('abort', onRequestAbort);
      deadlineSignal.removeEventListener('abort', onDeadline);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onRequestAbort = () => {
      finish(() => reject(abortError()));
    };
    const onDeadline = () => {
      finish(() => reject(deadlineError));
    };

    requestSignal.addEventListener('abort', onRequestAbort, { once: true });
    deadlineSignal.addEventListener('abort', onDeadline, { once: true });
    if (requestSignal.aborted) {
      onRequestAbort();
      return;
    }
    if (deadlineSignal.aborted) {
      onDeadline();
      return;
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function validateOptions(options: ResilientLlmProviderOptions): void {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive finite number');
  }
  if (
    options.maxElapsedMs !== undefined
    && (!Number.isFinite(options.maxElapsedMs) || options.maxElapsedMs <= 0)
  ) {
    throw new TypeError('maxElapsedMs must be a positive finite number');
  }
  if (
    options.maxAttempts !== undefined
    && (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0)
  ) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  if (
    options.backoffMs !== undefined
    && (!Number.isFinite(options.backoffMs) || options.backoffMs < 0)
  ) {
    throw new TypeError('backoffMs must be a non-negative finite number');
  }
}

export class ResilientLlmProvider implements LlmProvider {
  private readonly timeoutMs: number;
  private readonly maxElapsedMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: ResilientLlmSleep;
  private readonly scheduleTimeout: ResilientLlmScheduleTimeout;
  private readonly clearTimeout: ResilientLlmClearTimeout;

  constructor(
    private readonly delegate: LlmProvider,
    options: ResilientLlmProviderOptions,
  ) {
    validateOptions(options);
    this.timeoutMs = options.timeoutMs;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 250;
    const defaultMaxElapsedMs = (
      this.timeoutMs * this.maxAttempts
      + this.backoffMs * Math.max(0, this.maxAttempts - 1)
    );
    if (!Number.isFinite(defaultMaxElapsedMs) || defaultMaxElapsedMs <= 0) {
      throw new TypeError('computed maxElapsedMs must be a positive finite number');
    }
    this.maxElapsedMs = options.maxElapsedMs ?? defaultMaxElapsedMs;
    this.sleep = options.sleep ?? defaultSleep;
    this.scheduleTimeout = options.scheduleTimeout ?? defaultScheduleTimeout;
    this.clearTimeout = options.clearTimeout ?? defaultClearTimeout;
  }

  async generate<T>(request: LlmRequest): Promise<LlmResponse<T>> {
    assertNotAborted(request.signal);
    let attempt = 0;
    const deadlineController = new AbortController();
    const deadlineError = new OverallDeadlineError(this.maxElapsedMs);
    const deadlineHandle = this.scheduleTimeout(() => {
      deadlineController.abort(deadlineError);
    }, this.maxElapsedMs);

    try {
      while (attempt < this.maxAttempts) {
        attempt += 1;
        try {
          return await this.runAttempt<T>(request, deadlineController.signal, deadlineError);
        } catch (error) {
          if (request.signal.aborted || isAbortError(error)) {
            throw abortError();
          }
          if (!isRetryable(error) || attempt >= this.maxAttempts) {
            throw safeProviderError(error, attempt);
          }
          if (this.backoffMs > 0) {
            const pendingSleep = Promise.resolve().then(() => this.sleep(this.backoffMs, request.signal));
            try {
              await waitWithRequestGuards(
                pendingSleep,
                request.signal,
                deadlineController.signal,
                deadlineError,
              );
            } catch (backoffError) {
              if (request.signal.aborted || isAbortError(backoffError)) {
                throw abortError();
              }
              if (backoffError instanceof OverallDeadlineError) {
                throw safeProviderError(backoffError, attempt);
              }
              throw new ResilientLlmProviderError(
                'LLM_PROVIDER_FAILED',
                attempt,
                'LLM provider request failed.',
              );
            }
          }
          assertNotAborted(request.signal);
          if (deadlineController.signal.aborted) {
            throw safeProviderError(deadlineError, attempt);
          }
        }
      }

      throw new ResilientLlmProviderError(
        'LLM_PROVIDER_FAILED',
        attempt,
        'LLM provider request failed.',
      );
    } finally {
      this.clearTimeout(deadlineHandle);
    }
  }

  private async runAttempt<T>(
    request: LlmRequest,
    deadlineSignal: AbortSignal,
    deadlineError: OverallDeadlineError,
  ): Promise<LlmResponse<T>> {
    assertNotAborted(request.signal);
    if (deadlineSignal.aborted) {
      throw deadlineError;
    }

    const controller = new AbortController();
    let timeoutHandle: unknown;
    let timedOut = false;
    let delegateSettled = false;

    type DelegateOutcome =
      | { readonly kind: 'fulfilled'; readonly value: LlmResponse<T> }
      | { readonly kind: 'rejected'; readonly error: unknown };
    const delegateOutcome: Promise<DelegateOutcome> = Promise.resolve()
      .then(() => this.delegate.generate<T>({ ...request, signal: controller.signal }))
      .then(
        (value) => {
          delegateSettled = true;
          return { kind: 'fulfilled', value } as const;
        },
        (error: unknown) => {
          delegateSettled = true;
          return { kind: 'rejected', error } as const;
        },
      );
    const timeoutOutcome = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
      timeoutHandle = this.scheduleTimeout(() => {
        if (delegateSettled) {
          return;
        }
        timedOut = true;
        controller.abort();
        resolve({ kind: 'timeout' });
      }, this.timeoutMs);
    });

    try {
      const outcome = await waitWithRequestGuards(
        Promise.race([delegateOutcome, timeoutOutcome]),
        request.signal,
        deadlineSignal,
        deadlineError,
      );

      if (outcome.kind === 'timeout') {
        await waitWithRequestGuards(
          delegateOutcome,
          request.signal,
          deadlineSignal,
          deadlineError,
        );
        throw new AttemptTimeoutError(this.timeoutMs);
      }
      if (timedOut) {
        throw new AttemptTimeoutError(this.timeoutMs);
      }
      if (outcome.kind === 'rejected') {
        throw outcome.error;
      }
      return outcome.value;
    } finally {
      if (!delegateSettled) {
        controller.abort();
      }
      this.clearTimeout(timeoutHandle);
    }
  }
}
