export type LlmTask =
  | 'topic'
  | 'title'
  | 'brief'
  | 'outline'
  | 'draft'
  | 'humanize'
  | 'review';

export interface LlmRequest {
  readonly task: LlmTask;
  readonly promptTemplateVersion: string;
  readonly system: string;
  readonly input: unknown;
  readonly outputSchema: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly signal: AbortSignal;
  readonly operationId?: string;
}

export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface LlmResponse<T> {
  readonly value: T;
  readonly providerRequestId?: string;
  readonly model?: string;
  readonly usage?: LlmUsage;
}

export interface LlmProvider {
  generate<T>(request: LlmRequest): Promise<LlmResponse<T>>;
}
