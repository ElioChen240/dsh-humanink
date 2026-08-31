import { describe, expect, it } from 'vitest';
import { HarnessLlmProvider } from '../src/services/llm-provider.js';

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
  });

  it('turns a Harness error finish into a provider failure', async () => {
    const service = {
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'upstream unavailable' } } };
        }());
      },
    };
    const provider = new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' });

    await expect(provider.generate({
      task: 'title',
      promptTemplateVersion: 'title.zh.v1',
      system: 'system',
      input: {},
      outputSchema: '[]',
      signal: new AbortController().signal,
    })).rejects.toThrow('upstream unavailable');
  });
  it('accepts an assembled Harness text block when no deltas were emitted', async () => {
    const service = {
      stream() {
        return (async function* () {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '{\"ok\":true}' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }());
      },
    };
    const provider = new HarnessLlmProvider(service, { provider: 'deepseek', model: 'deepseek-chat' });

    await expect(provider.generate({
      task: 'review',
      promptTemplateVersion: 'review.zh.v1',
      system: 'system',
      input: {},
      outputSchema: '{}',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ value: { ok: true } });
  });

});
