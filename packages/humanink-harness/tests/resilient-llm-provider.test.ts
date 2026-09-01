import type { LlmProvider, LlmRequest, LlmResponse } from '@humanink/core';
import { describe, expect, it } from 'vitest';
import {
  ResilientLlmProvider,
  ResilientLlmProviderError,
  type ResilientLlmProviderOptions,
} from '../src/services/resilient-llm-provider.js';

const neverTimeout = {
  scheduleTimeout: () => Symbol('timeout'),
  clearTimeout: () => undefined,
};

function request(signal = new AbortController().signal): LlmRequest {
  return {
    task: 'humanize',
    promptTemplateVersion: 'humanize.zh.v1',
    system: 'system',
    input: { body: '原稿' },
    outputSchema: '{"type":"object"}',
    signal,
    operationId: 'op_1',
  };
}

function response<T>(value: T): LlmResponse<T> {
  return { value, model: 'deepseek-chat' };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

function options(overrides: Partial<ResilientLlmProviderOptions> = {}): ResilientLlmProviderOptions {
  return {
    timeoutMs: 1_000,
    maxAttempts: 3,
    backoffMs: 25,
    ...neverTimeout,
    ...overrides,
  };
}

describe('ResilientLlmProvider', () => {
  it('returns the delegate response and gives the attempt a linked cancellation signal', async () => {
    const external = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const delegate: LlmProvider = {
      async generate<T>(input: LlmRequest) {
        receivedSignal = input.signal;
        return response({ ok: true }) as LlmResponse<T>;
      },
    };
    const provider = new ResilientLlmProvider(delegate, options());

    await expect(provider.generate<{ ok: boolean }>(request(external.signal))).resolves.toEqual(
      response({ ok: true }),
    );

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).not.toBe(external.signal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('retries explicitly retryable errors using fixed injectable backoff', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('opaque provider failure'), { retryable: true });
        }
        return response({ ok: true }) as LlmResponse<T>;
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      backoffMs: 40,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }));

    await expect(provider.generate<{ ok: boolean }>(request())).resolves.toEqual(response({ ok: true }));
    expect(attempts).toBe(3);
    expect(delays).toEqual([40, 40]);
  });

  it('retries common transient HTTP and network failures', async () => {
    const failures = [
      Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
      Object.assign(new Error('Service unavailable'), { status: 503 }),
      Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    ];
    const delays: number[] = [];
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        const failure = failures[attempts];
        attempts += 1;
        if (failure !== undefined) {
          throw failure;
        }
        return response('done') as LlmResponse<T>;
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      maxAttempts: 4,
      backoffMs: 7,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }));

    await expect(provider.generate<string>(request())).resolves.toEqual(response('done'));
    expect(attempts).toBe(4);
    expect(delays).toEqual([7, 7, 7]);
  });

  it('does not retry explicit non-retryable or validation and invalid JSON failures', async () => {
    const failures = [
      Object.assign(new Error('HTTP 503'), { status: 503, retryable: false }),
      new TypeError('schema validation failed'),
      new Error('Harness LLM returned invalid JSON'),
    ];

    for (const failure of failures) {
      let attempts = 0;
      const delegate: LlmProvider = {
        async generate<T>() {
          attempts += 1;
          throw failure;
        },
      };
      const provider = new ResilientLlmProvider(delegate, options({
        sleep: async () => {
          throw new Error('backoff must not run');
        },
      }));

      await expect(provider.generate(request())).rejects.toBeInstanceOf(ResilientLlmProviderError);
      expect(attempts).toBe(1);
    }
  });

  it('waits for a timed-out attempt to settle before retrying, so attempts never overlap', async () => {
    interface TimerHandle {
      active: boolean;
      readonly callback: () => void;
      readonly delayMs: number;
    }
    const timers: TimerHandle[] = [];
    const signals: AbortSignal[] = [];
    const delays: number[] = [];
    let attempts = 0;
    let active = 0;
    let maxActive = 0;
    let settleFirstAttempt: (() => void) | undefined;
    const delegate: LlmProvider = {
      generate<T>(input: LlmRequest): Promise<LlmResponse<T>> {
        attempts += 1;
        signals.push(input.signal);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (attempts === 1) {
          return new Promise<LlmResponse<T>>((resolve) => {
            settleFirstAttempt = () => {
              active -= 1;
              resolve(response('late') as LlmResponse<T>);
            };
          });
        }
        active -= 1;
        return Promise.resolve(response('done') as LlmResponse<T>);
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      timeoutMs: 10,
      maxElapsedMs: 100,
      maxAttempts: 2,
      backoffMs: 3,
      scheduleTimeout: (callback, delayMs) => {
        const handle = { active: true, callback, delayMs };
        timers.push(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        (handle as TimerHandle).active = false;
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }));

    const result = provider.generate<string>(request());
    await flushMicrotasks();
    expect(attempts).toBe(1);

    const attemptTimer = timers.find((timer) => timer.delayMs === 10);
    attemptTimer?.callback();
    await flushMicrotasks();
    expect(signals[0]?.aborted).toBe(true);
    expect(attempts).toBe(1);
    expect(active).toBe(1);

    settleFirstAttempt?.();
    await expect(result).resolves.toEqual(response('done'));
    expect(attempts).toBe(2);
    expect(delays).toEqual([3]);
    expect(maxActive).toBe(1);
  });

  it('fails at the overall deadline without retrying when a timed-out delegate ignores AbortSignal', async () => {
    interface TimerHandle {
      active: boolean;
      readonly callback: () => void;
      readonly delayMs: number;
    }
    const timers: TimerHandle[] = [];
    const signals: AbortSignal[] = [];
    let attempts = 0;
    let active = 0;
    let maxActive = 0;
    const delegate: LlmProvider = {
      generate<T>(input: LlmRequest): Promise<LlmResponse<T>> {
        attempts += 1;
        signals.push(input.signal);
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise<LlmResponse<T>>(() => undefined);
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      timeoutMs: 10,
      maxElapsedMs: 30,
      maxAttempts: 3,
      backoffMs: 0,
      scheduleTimeout: (callback, delayMs) => {
        const handle = { active: true, callback, delayMs };
        timers.push(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        (handle as TimerHandle).active = false;
      },
    }));

    const result = provider.generate(request());
    await flushMicrotasks();

    const attemptTimer = timers.find((timer) => timer.delayMs === 10);
    const deadlineTimer = timers.find((timer) => timer.delayMs === 30);
    expect(attemptTimer).toBeDefined();
    expect(deadlineTimer).toBeDefined();

    attemptTimer?.callback();
    await flushMicrotasks();
    expect(signals[0]?.aborted).toBe(true);
    expect(attempts).toBe(1);
    expect(maxActive).toBe(1);

    deadlineTimer?.callback();
    await expect(result).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_TIMEOUT',
      attempts: 1,
      message: 'LLM request exceeded its overall deadline.',
    });
    expect(attempts).toBe(1);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
  });

  it('stops immediately when cancelled during an attempt and does not retry', async () => {
    const external = new AbortController();
    let attempts = 0;
    let attemptSignal: AbortSignal | undefined;
    const delegate: LlmProvider = {
      generate<T>(input: LlmRequest): Promise<LlmResponse<T>> {
        attempts += 1;
        attemptSignal = input.signal;
        return new Promise<LlmResponse<T>>(() => undefined);
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      sleep: async () => {
        throw new Error('backoff must not run');
      },
    }));

    const result = provider.generate(request(external.signal));
    await flushMicrotasks();
    external.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
    expect(attemptSignal?.aborted).toBe(true);
  });

  it('stops immediately when cancelled during an injected backoff', async () => {
    const external = new AbortController();
    let attempts = 0;
    let sleepSignal: AbortSignal | undefined;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        throw Object.assign(new Error('temporary'), { retryable: true });
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      sleep: (_delayMs, signal) => {
        sleepSignal = signal;
        return new Promise<void>(() => undefined);
      },
    }));

    const result = provider.generate(request(external.signal));
    await flushMicrotasks();
    expect(attempts).toBe(1);
    expect(sleepSignal).toBe(external.signal);

    external.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('wraps injected backoff failures without exposing their error details', async () => {
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        throw Object.assign(new Error('temporary'), { retryable: true });
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      sleep: async () => {
        throw new SyntaxError(
          'Authorization: Basic dXNlcjpwYXNz OPENAI_API_KEY=backoff-secret https://user:password@example.com',
        );
      },
    }));

    await expect(provider.generate(request())).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_PROVIDER_FAILED',
      attempts: 1,
      message: 'LLM provider request failed.',
    });
    expect(attempts).toBe(1);
  });

  it('preserves abort semantics when an injected backoff rejects with AbortError', async () => {
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        throw Object.assign(new Error('temporary'), { retryable: true });
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({
      sleep: async () => {
        throw new DOMException('backoff cancelled with token=secret', 'AbortError');
      },
    }));

    await expect(provider.generate(request())).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])(
    'retries the explicitly supported transient HTTP status %i',
    async (status) => {
      let attempts = 0;
      const delegate: LlmProvider = {
        async generate<T>() {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error('structured HTTP failure'), { status });
          }
          return response('done') as LlmResponse<T>;
        },
      };
      const provider = new ResilientLlmProvider(delegate, options({
        maxAttempts: 2,
        backoffMs: 0,
      }));

      await expect(provider.generate<string>(request())).resolves.toEqual(response('done'));
      expect(attempts).toBe(2);
    },
  );

  it.each([501, 505])('does not retry unsupported HTTP status %i', async (status) => {
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        throw Object.assign(new Error(`HTTP ${status}`), { status });
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({ backoffMs: 0 }));

    await expect(provider.generate(request())).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_PROVIDER_FAILED',
      attempts: 1,
    });
    expect(attempts).toBe(1);
  });

  it('does not retry an unstructured message containing a bare 500 number', async () => {
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        throw new Error('Maximum token setting 500 is unsupported');
      },
    };
    const provider = new ResilientLlmProvider(delegate, options({ backoffMs: 0 }));

    await expect(provider.generate(request())).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_PROVIDER_FAILED',
      attempts: 1,
    });
    expect(attempts).toBe(1);
  });

  it('does not call the delegate when the request is already cancelled', async () => {
    const external = new AbortController();
    external.abort();
    let attempts = 0;
    const delegate: LlmProvider = {
      async generate<T>() {
        attempts += 1;
        return response('unexpected') as LlmResponse<T>;
      },
    };
    const provider = new ResilientLlmProvider(delegate, options());

    await expect(provider.generate(request(external.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(0);
  });

  it('returns stable safe messages without exposing provider error details', async () => {
    const sensitiveMessages = [
      'Authorization: Basic dXNlcjpwYXNz',
      'OPENAI_API_KEY=openai-secret DEEPSEEK_API_KEY=deepseek-secret',
      '{"api_key":"json-secret","access_token":"json-token"}',
      'request failed for https://user:password@example.com/v1/chat',
    ];

    for (const message of sensitiveMessages) {
      const delegate: LlmProvider = {
        async generate<T>() {
          throw new Error(message);
        },
      };
      const provider = new ResilientLlmProvider(delegate, options({ maxAttempts: 1 }));

      await expect(provider.generate(request())).rejects.toMatchObject({
        name: 'ResilientLlmProviderError',
        code: 'LLM_PROVIDER_FAILED',
        attempts: 1,
        message: 'LLM provider request failed.',
      });
    }

    const invalidDelegate: LlmProvider = {
      async generate<T>() {
        throw new SyntaxError('{"access_token":"invalid-response-secret"}');
      },
    };
    const invalidProvider = new ResilientLlmProvider(
      invalidDelegate,
      options({ maxAttempts: 1 }),
    );

    await expect(invalidProvider.generate(request())).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_INVALID_RESPONSE',
      attempts: 1,
      message: 'LLM provider returned an invalid response.',
    });
  });

  it('rejects invalid resilience configuration', () => {
    const delegate: LlmProvider = {
      async generate<T>() {
        return response(undefined) as LlmResponse<T>;
      },
    };

    expect(() => new ResilientLlmProvider(delegate, options({ timeoutMs: 0 }))).toThrow(TypeError);
    expect(() => new ResilientLlmProvider(delegate, options({ maxElapsedMs: 0 }))).toThrow(TypeError);
    expect(() => new ResilientLlmProvider(delegate, options({ maxAttempts: 0 }))).toThrow(TypeError);
    expect(() => new ResilientLlmProvider(delegate, options({ backoffMs: -1 }))).toThrow(TypeError);
  });
});
