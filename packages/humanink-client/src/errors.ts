import type { WorkflowAction } from './api.js';

/**
 * Client-side safe failure presentation. The Harness already sanitizes task
 * failures into stable error codes plus Chinese safe messages; this module
 * turns those codes (and any raw client-side error) into a structured,
 * user-facing detail card. It never surfaces API keys, authorization headers,
 * stack frames, or raw provider payloads.
 */
export interface SafeFailureDetail {
  readonly code: string;
  readonly reason: string;
  readonly stage?: string | undefined;
  readonly advice?: string | undefined;
}

/** Error thrown by the Connection RPC adapter; carries the stable Harness code. */
export class HumanInkApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HumanInkApiError';
  }
}

const FAILURE_HINTS: Readonly<Record<string, Omit<SafeFailureDetail, 'code'>>> = Object.freeze({
  LLM_TIMEOUT: { reason: '模型请求超时', stage: 'ctx.llm.stream', advice: '请稍后重试，或在 DSH profile 中调整模型超时配置' },
  LLM_PROVIDER_FAILED: { reason: 'Harness 当前 provider/model 调用失败', stage: 'ctx.llm.stream', advice: '检查当前 DSH profile 的模型配置' },
  LLM_INVALID_RESPONSE: { reason: '模型返回格式无效', stage: 'ctx.llm.stream', advice: '请重试，或调整输入后重新生成' },
  HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED: { reason: '改写结果未通过保护字段校验', advice: '核对原文中的保护字段（数据、引用等）后重试' },
  HUMANINK_CAPABILITY_UNAVAILABLE: { reason: 'HumanInk 能力不可用', advice: '检查 HumanInk 插件配置是否完整' },
  INVALID_INPUT: { reason: '输入不完整或格式无效', advice: '补全标题或正文后重试' },
  TASK_NOT_FOUND: { reason: '任务不存在或已被清理', advice: '刷新任务列表后重试' },
  TASK_NOT_CANCELLABLE: { reason: '当前任务状态不支持取消', advice: '等待任务结束或稍后刷新' },
  TASK_RECOVERY_REQUIRED: { reason: '上次任务结果未完整落盘，需要人工核对', advice: '在版本历史中核对最新版本后继续' },
} as const);

const WORKFLOW_TITLES: Readonly<Record<WorkflowAction, string>> = Object.freeze({
  titles: '生成标题',
  brief: '生成简报',
  outline: '生成大纲',
  draft: '生成初稿',
  humanize: '人味化改写',
  review: '发布前复核',
});

export function workflowTitle(action: WorkflowAction): string {
  return WORKFLOW_TITLES[action] ?? '内容任务';
}

const MAX_SAFE_LENGTH = 240;

/** Removes secrets, stack frames, and oversized payloads from an error string. */
export function sanitizeErrorText(value: string): string {
  const withoutStack = value
    .split('\n')
    .filter((line) => !/^\s*at\s/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, '[已隐藏]')
    .replace(/(bearer\s+)\S+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|token|authorization|password)(?:\s*[=:]\s*))\S+/gi, '$1[已隐藏]');
  return withoutStack.length > MAX_SAFE_LENGTH ? `${withoutStack.slice(0, MAX_SAFE_LENGTH)}…` : withoutStack;
}

/** Maps any thrown value onto a structured, safe failure detail. */
export function describeFailure(error: unknown): SafeFailureDetail {
  const code = error instanceof HumanInkApiError && error.code
    ? error.code
    : error !== null && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  const hint = code !== undefined ? FAILURE_HINTS[code] : undefined;
  if (code !== undefined && hint) {
    // Known Harness codes map onto curated, deterministic copy; the raw
    // message is intentionally dropped so provider details never leak.
    return { code, reason: hint.reason, stage: hint.stage, advice: hint.advice };
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeErrorText(rawMessage) || '发生未知错误';
  return {
    code: code ?? 'UNKNOWN',
    reason: message,
    advice: '请重试；若持续失败，请检查当前 DSH profile 的模型配置与网络状态',
  };
}

/** One-line composed message used for controller state and fallback rendering. */
export function formatFailure(detail: SafeFailureDetail, action?: WorkflowAction): string {
  const title = action ? workflowTitle(action) : '操作';
  const stage = detail.stage ? `（请求阶段：${detail.stage}）` : '';
  const advice = detail.advice ? ` 建议：${detail.advice}` : '';
  return `${title}失败：${detail.reason}${stage}。${advice}`;
}
