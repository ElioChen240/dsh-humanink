import type { ContentRepository } from '../repository/content-repository.js';
import { ParentVersionNotFoundError, ProjectVersionMismatchError } from '../repository/errors.js';
import type { ContentProjectService } from '../project/content-project-service.js';
import type { ContentVersion } from '../versioning/content-version.js';
import type { LlmProvider, LlmResponse, LlmRequest } from '../ports/llm-provider.js';
import type { JsonObject } from '../shared/types.js';

export interface WritingVersionMetadataInput {
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
}

export interface WritingExecutionOptions {
  readonly signal?: AbortSignal;
  readonly operationId?: string;
}

export interface WritingUseCaseDependencies {
  readonly repository: ContentRepository;
  readonly projectService: Pick<ContentProjectService, 'createDerivedVersion'>;
  readonly llmProvider: LlmProvider;
}

export interface WritingVersionResult<T> {
  readonly status: 'succeeded';
  readonly projectId: string;
  readonly parentVersionId: string;
  readonly version: ContentVersion;
  readonly output: T;
}

export function resolveSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal;
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Writing operation cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

export async function requireProjectVersion(
  repository: ContentRepository,
  projectId: string,
  versionId: string,
  label: string,
): Promise<ContentVersion> {
  const version = await repository.getVersion(versionId);
  if (version === null) {
    throw new ParentVersionNotFoundError(versionId, `${label} version does not exist`);
  }
  if (version.projectId !== projectId) {
    throw new ProjectVersionMismatchError(projectId, versionId);
  }
  return version;
}

export function parseStoredJson<T>(version: ContentVersion, label: string): T {
  try {
    return JSON.parse(version.content.body) as T;
  } catch {
    throw new TypeError(`${label} version contains invalid JSON`);
  }
}

export function requireVersionKind(version: ContentVersion, expectedKind: ContentVersion['kind'], label: string): void {
  if (version.kind !== expectedKind) {
    throw new TypeError(`${label} version must have kind ${expectedKind}`);
  }
}

export function buildModelInfo(response: Pick<LlmResponse<unknown>, 'model' | 'providerRequestId' | 'usage'>): JsonObject {
  return {
    ...(response.model === undefined ? {} : { model: response.model }),
    ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
    ...(response.usage === undefined ? {} : { usage: response.usage }),
  };
}

export function createRequest(
  base: Omit<LlmRequest, 'signal' | 'operationId'>,
  options: WritingExecutionOptions,
  signal: AbortSignal,
): LlmRequest {
  return {
    ...base,
    signal,
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
  };
}

export function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  return value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

export function objectWithExactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  const object = value as Record<string, unknown>;
  const actualKeys = Object.keys(object).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  return object;
}

export function modelRequestSchema(required: readonly string[], properties: JsonObject): string {
  return JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  });
}
