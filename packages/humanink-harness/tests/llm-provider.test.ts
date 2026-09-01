import { describe, expect, it } from 'vitest';
import {
  HarnessLlmFailureError,
  HarnessLlmProvider,
  type HarnessGenerateOptionsLike,
  type HarnessLlmServiceLike,
} from '../src/services/llm-provider.js';
import { ResilientLlmProvider } from '../src/services/resilient-llm-provider.js';

function request(task: 'title' | 'review' = 'title') {
  return {
    task,
    promptTemplateVersion: `${task}.zh.v1`,
    system: 'system',
    input: {},
    outputSchema: '{}',
    signal: new AbortController().signal,
  } as const;
}

function idleService(): HarnessLlmServiceLike {
  return {
    stream() {
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } };
      }());
    },
  };
}

describe('HarnessLlmProvider', () => {
  it('maps a Core request to a Harness stream and parses structured JSON output', async () => {
    const calls: unknown[] = [];
    const service = {
      stream(options: unknown) {
        calls.push(options);
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '```json\n{"title":"标题","body":"正文"}\n```' };
          yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }());
      },
    };
    const provider = new HarnessLlmProvider(service, {
      provider: 'deepseek',
      model: 'deepseek-chat',
    });
    const signal = new AbortController().signal;

    const response = await provider.generate({
      task: 'draft',
      promptTemplateVersion: 'draft.zh.v1',
      system: 'system prompt',
      input: { projectId: 'project_1', outline: ['一'] },
      outputSchema: '{"type":"object"}',
      signal,
      operationId: 'op_1',
    });

    expect(response.value).toEqual({ title: '标题', body: '正文' });
    expect(response.model).toBe('deepseek-chat');
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
    expect(calls[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      system: 'system prompt',
      signal,
    });
    expect(calls[0]).toHaveProperty('messages.0.role', 'user');
    expect(calls[0]).toHaveProperty('messages.0.content.0.type', 'text');
    expect(calls[0]).toHaveProperty('messages.0.content.0.text', expect.stringContaining('draft.zh.v1'));
    expect(calls[0]).toHaveProperty('messages.0.content.0.text', expect.stringContaining('project_1'));

    const streamOptions = calls[0] as HarnessGenerateOptionsLike;
    const message = streamOptions.messages[0];
    const payload = JSON.parse(message?.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({
      operationId: 'op_1',
      attemptId: message?.id,
    });
  });

  it('turns a Harness error finish into a structured safe provider failure', async () => {
    const secret = 'Authorization: Bearer secret-token';
    const service = {
      stream() {
        return (async function* () {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                code: 'ETIMEDOUT',
                message: secret,
                requestId: 'req_123',
                status: 504,
                retryable: true,
              },
            },
          };
        }());
      },
    };
    const provider = new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' });

    const error = await provider.generate(request()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HarnessLlmFailureError);
    expect(error).toMatchObject({
      name: 'HarnessLlmFailureError',
      code: 'ETIMEDOUT',
      requestId: 'req_123',
      status: 504,
      retryable: true,
      message: 'Harness LLM request failed.',
    });
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty('cause');
  });

  it('preserves operation correlation across unique retry attempts', async () => {
    let attempts = 0;
    const calls: HarnessGenerateOptionsLike[] = [];
    const service = {
      stream(options: HarnessGenerateOptionsLike) {
        calls.push(options);
        attempts += 1;
        const currentAttempt = attempts;
        return (async function* () {
          if (currentAttempt === 1) {
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  code: 'ETIMEDOUT',
                  message: 'OPENAI_API_KEY=secret',
                  requestId: 'req_retry_1',
                },
              },
            };
            return;
          }
          yield { type: 'text-delta', index: 0, text: '{"ok":true}' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }());
      },
    };
    const provider = new ResilientLlmProvider(
      new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' }),
      { timeoutMs: 1_000, maxAttempts: 2, backoffMs: 0 },
    );

    await expect(provider.generate({ ...request(), operationId: 'operation_retry_1' })).resolves.toMatchObject({
      value: { ok: true },
    });
    expect(attempts).toBe(2);

    const messages = calls.map((call) => call.messages[0]);
    const payloads = messages.map((message) => (
      JSON.parse(message?.content[0]?.text ?? '{}') as Record<string, unknown>
    ));
    expect(payloads.map((payload) => payload.operationId)).toEqual([
      'operation_retry_1',
      'operation_retry_1',
    ]);
    expect(payloads.map((payload) => payload.attemptId)).toEqual(messages.map((message) => message?.id));
    expect(new Set(messages.map((message) => message?.id)).size).toBe(2);
  });

  it('does not retry Harness INVALID_RESPONSE failures', async () => {
    let attempts = 0;
    const service = {
      stream() {
        attempts += 1;
        return (async function* () {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                code: 'INVALID_RESPONSE',
                message: 'access_token=secret',
                requestId: 'req_invalid_1',
                retryable: true,
              },
            },
          };
        }());
      },
    };
    const provider = new ResilientLlmProvider(
      new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' }),
      { timeoutMs: 1_000, maxAttempts: 3, backoffMs: 0 },
    );

    await expect(provider.generate(request())).rejects.toMatchObject({
      name: 'ResilientLlmProviderError',
      code: 'LLM_INVALID_RESPONSE',
      attempts: 1,
      message: 'LLM provider returned an invalid response.',
    });
    expect(attempts).toBe(1);
  });

  it('validates provider options at construction time', () => {
    const service = idleService();

    expect(() => new HarnessLlmProvider(service, {
      provider: '   ',
      model: 'deepseek-chat',
    })).toThrow('provider must not be empty');
    expect(() => new HarnessLlmProvider(service, {
      provider: 'deepseek',
      model: '   ',
    })).toThrow('model must not be empty');
    expect(() => new HarnessLlmProvider(service, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: Number.NaN,
    })).toThrow('temperature must be a non-negative finite number');
    expect(() => new HarnessLlmProvider(service, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      maxTokens: 0,
    })).toThrow('maxTokens must be a positive integer');
  });

  it('accepts an assembled Harness text block when no deltas were emitted', async () => {
    const service = {
      stream() {
        return (async function* () {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"ok":true}' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }());
      },
    };
    const provider = new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' });

    await expect(provider.generate(request('review'))).resolves.toMatchObject({ value: { ok: true } });
  });
});
