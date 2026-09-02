import { describe, expect, it } from 'vitest';
import { describeFailure, formatFailure, sanitizeErrorText, workflowTitle, HumanInkApiError } from '../src/errors.js';

describe('HumanInk client safe error normalization', () => {
  it('maps known Harness error codes onto safe structured reasons', () => {
    const detail = describeFailure(new HumanInkApiError('模型服务暂时不可用，请稍后重试', 'LLM_PROVIDER_FAILED'));
    expect(detail).toEqual({
      code: 'LLM_PROVIDER_FAILED',
      reason: 'Harness 当前 provider/model 调用失败',
      stage: 'ctx.llm.stream',
      advice: '检查当前 DSH profile 的模型配置',
    });
  });

  it('redacts secrets, stack frames, and oversized messages', () => {
    expect(sanitizeErrorText('sk-abcdef1234567890 failed')).toBe('[已隐藏] failed');
    expect(sanitizeErrorText('Bearer abc.def.ghi rejected')).toBe('Bearer [已隐藏] rejected');
    expect(sanitizeErrorText('Authorization: abc.def.ghi rejected')).toBe('Authorization: [已隐藏] rejected');
    expect(sanitizeErrorText('api_key=supersecret invalid')).toBe('api_key=[已隐藏] invalid');
    expect(sanitizeErrorText('Error: boom\n    at fetch (node:internal)\n    at Object.apply')).toBe('Error: boom');
    expect(sanitizeErrorText('x'.repeat(400))).toHaveLength(241);
  });

  it('falls back to a sanitized generic reason for unknown errors', () => {
    const detail = describeFailure(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
    expect(detail.code).toBe('UNKNOWN');
    expect(detail.reason).toBe('connect ECONNREFUSED 127.0.0.1:8080');
    expect(detail.advice).toContain('DSH profile');

    const codeOnly = describeFailure({ code: 'LLM_TIMEOUT', message: 'raw' });
    expect(codeOnly.reason).toBe('模型请求超时');
    expect(codeOnly.stage).toBe('ctx.llm.stream');
  });

  it('composes a one-line failure message per workflow action', () => {
    const detail = describeFailure(new HumanInkApiError('x', 'LLM_PROVIDER_FAILED'));
    expect(formatFailure(detail, 'draft')).toBe(
      '生成初稿失败：Harness 当前 provider/model 调用失败（请求阶段：ctx.llm.stream）。 建议：检查当前 DSH profile 的模型配置',
    );
    expect(workflowTitle('humanize')).toBe('人味化改写');
  });
});
