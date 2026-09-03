import type { CapabilityReport, ContentDetail, ContentSummary, CreateContentInput, ListContentsInput, SaveVersionInput, StartActionInput, WorkbenchSettings } from '../application/contracts.js';
import type { ProjectCreationResult } from '../runtime/humanink-application.js';
import type { TaskRecord } from '../runtime/task-runtime.js';
import type { HumanInkRemoteError, HumanInkRemoteResult, HumanInkWorkbenchInvocation } from './contract.js';

export const WORKBENCH_REMOTE_CHANNEL = '/humanink/workbench' as const;

export interface HumanInkWorkbenchRemoteService {
  listContents(input: ListContentsInput, signal?: AbortSignal): Promise<readonly ContentSummary[]>;
  getContent(contentId: string, signal?: AbortSignal): Promise<ContentDetail | null>;
  createContent(input: CreateContentInput, signal?: AbortSignal): Promise<ProjectCreationResult>;
  saveVersion(input: SaveVersionInput, signal?: AbortSignal): Promise<unknown>;
  startAction(input: StartActionInput, signal?: AbortSignal): Promise<TaskRecord>;
  getTask(taskId: string, signal?: AbortSignal): Promise<TaskRecord | null>;
  cancelTask(taskId: string, signal?: AbortSignal): Promise<boolean>;
  getSettings(signal?: AbortSignal): Promise<WorkbenchSettings>;
  setLibraryRoot(libraryRoot: string, signal?: AbortSignal): Promise<WorkbenchSettings>;
  setWritingProfile(writingProfile: string, signal?: AbortSignal): Promise<WorkbenchSettings>;
  getCapabilities(signal?: AbortSignal): Promise<CapabilityReport>;
  getRevision(signal?: AbortSignal): Promise<number>;
}

export interface HumanInkRemoteConnectionLike {
  readonly rpc: {
    handle(channel: string, handler: (invocation: string, payload: unknown, signal: AbortSignal) => Promise<HumanInkRemoteResult<unknown>>): () => Promise<void>;
  };
}

type JsonRecord = Record<string, unknown>;
function objectOf(value: unknown): JsonRecord { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('payload must be a JSON object'); return value as JsonRecord; }
function requiredString(record: JsonRecord, key: string): string { const value = record[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${key} must be a non-empty string`); return value.trim(); }
function optionalString(record: JsonRecord, key: string): string | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'string') throw new TypeError(`${key} must be a string`); return value.trim(); }
function errorOf(error: unknown): HumanInkRemoteError {
  if (error instanceof TypeError) return { code: 'INVALID_INPUT', message: error.message, retryable: false };
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'CAPABILITY_MISSING') return { code: 'CAPABILITY_MISSING', message: error instanceof Error ? error.message : 'HumanInk capability is unavailable.', retryable: false };
  return { code: 'INTERNAL', message: 'HumanInk request failed.', retryable: false };
}
class RemoteNotFoundError extends Error {}

async function dispatch(service: HumanInkWorkbenchRemoteService, invocation: HumanInkWorkbenchInvocation, payload: JsonRecord, signal: AbortSignal): Promise<unknown> {
  switch (invocation) {
    case 'listContents': { const query = optionalString(payload, 'query'); return service.listContents(query === undefined ? {} : { query }, signal); }
    case 'getContent': { const contentId = requiredString(payload, 'contentId'); const value = await service.getContent(contentId, signal); if (value === null) throw new RemoteNotFoundError(`Content not found: ${contentId}`); return value; }
    case 'createContent': return service.createContent({ title: requiredString(payload, 'title'), ...(typeof payload.sourceBody === 'string' ? { sourceBody: payload.sourceBody } : {}) }, signal);
    case 'saveVersion': return service.saveVersion({ contentId: requiredString(payload, 'contentId'), parentVersionId: requiredString(payload, 'parentVersionId'), title: requiredString(payload, 'title'), body: typeof payload.body === 'string' ? payload.body : '' }, signal);
    case 'startAction': {
      const action = requiredString(payload, 'action');
      if (!['titles', 'brief', 'outline', 'draft', 'humanize', 'review'].includes(action)) throw new TypeError('action is invalid');
      const values = Object.fromEntries(['versionId', 'sourceVersionId', 'briefVersionId', 'outlineVersionId', 'selectedTitle'].flatMap((key) => { const value = optionalString(payload, key); return value === undefined ? [] : [[key, value]]; }));
      return service.startAction({ contentId: requiredString(payload, 'contentId'), action: action as StartActionInput['action'], ...values }, signal);
    }
    case 'getTask': return service.getTask(requiredString(payload, 'taskId'), signal);
    case 'cancelTask': return service.cancelTask(requiredString(payload, 'taskId'), signal);
    case 'getSettings': return service.getSettings(signal);
    case 'setLibraryRoot': return service.setLibraryRoot(requiredString(payload, 'libraryRoot'), signal);
    case 'setWritingProfile': return service.setWritingProfile(typeof payload.writingProfile === 'string' ? payload.writingProfile : '', signal);
    case 'getCapabilities': return service.getCapabilities(signal);
    case 'getRevision': return service.getRevision(signal);
  }
}

export function createHumanInkWorkbenchRemoteHandler(service: HumanInkWorkbenchRemoteService) {
  return async (invocation: string, payload: unknown, signal: AbortSignal): Promise<HumanInkRemoteResult<unknown>> => {
    if (signal.aborted) return { ok: false, error: { code: 'REQUEST_CANCELLED', message: 'HumanInk request cancelled.', retryable: false } };
    try {
      if (!['listContents', 'getContent', 'createContent', 'saveVersion', 'startAction', 'getTask', 'cancelTask', 'getCapabilities', 'getRevision', 'getSettings', 'setLibraryRoot', 'setWritingProfile'].includes(invocation)) throw new TypeError('invocation is invalid');
      return { ok: true, value: await dispatch(service, invocation as HumanInkWorkbenchInvocation, objectOf(payload), signal) };
    } catch (error) {
      if (error instanceof RemoteNotFoundError) return { ok: false, error: { code: 'NOT_FOUND', message: error.message, retryable: false } };
      return { ok: false, error: errorOf(error) };
    }
  };
}

export function registerHumanInkWorkbenchRemote(connection: HumanInkRemoteConnectionLike, service: HumanInkWorkbenchRemoteService): () => Promise<void> {
  return connection.rpc.handle(WORKBENCH_REMOTE_CHANNEL, createHumanInkWorkbenchRemoteHandler(service));
}