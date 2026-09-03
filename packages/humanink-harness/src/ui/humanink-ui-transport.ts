import type { ContentProject, ContentVersion } from '@humanink/core';
import type { ProjectCreationResult } from '../runtime/humanink-application.js';
import type { TaskRecord } from '../runtime/task-runtime.js';
import type { HumanInkUiFacade, HumanInkUiProjectDetails, HumanInkWorkflowInput, SaveManualEditInput } from './humanink-ui-facade.js';

export type HumanInkRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } };

export interface HumanInkUiRouteFacade {
  listProjects(): Promise<readonly ContentProject[]>;
  getProject(projectId: string): Promise<HumanInkUiProjectDetails | null>;
  createProject(input: { readonly title: string; readonly source: { readonly title: string; readonly body: string } }): Promise<ProjectCreationResult>;
  saveManualEdit(input: SaveManualEditInput): Promise<ContentVersion>;
  restoreVersion(projectId: string, versionId: string): Promise<ContentVersion>;
  runWorkflow(input: HumanInkWorkflowInput): TaskRecord;
  listTasks(projectId?: string): readonly TaskRecord[];
  cancelTask(taskId: string): boolean;
  exportMarkdown(versionId: string): Promise<string>;
}

export interface HumanInkConnectionLike {
  readonly rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
    ): () => Promise<void>;
  };
}

type JsonRecord = Record<string, unknown>;

function objectOf(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('payload must be a JSON object');
  }
  return value as JsonRecord;
}

function stringOf(record: JsonRecord, key: string, optional = false): string | undefined {
  const value = record[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value.trim();
}

async function dispatch(facade: HumanInkUiRouteFacade, endpoint: string, payload: JsonRecord): Promise<unknown> {
  switch (endpoint) {
    case 'projects/list': return facade.listProjects();
    case 'projects/get': return facade.getProject(stringOf(payload, 'projectId')!);
    case 'projects/create': {
      const title = stringOf(payload, 'title')!;
      return facade.createProject({
        title,
        source: {
          title: stringOf(payload, 'sourceTitle', true) ?? title,
          body: typeof payload.sourceBody === 'string' ? payload.sourceBody : '',
        },
      });
    }
    case 'versions/save': return facade.saveManualEdit({
      projectId: stringOf(payload, 'projectId')!,
      parentVersionId: stringOf(payload, 'parentVersionId')!,
      title: stringOf(payload, 'title')!,
      body: typeof payload.body === 'string' ? payload.body : '',
    });
    case 'versions/restore': return facade.restoreVersion(
      stringOf(payload, 'projectId')!,
      stringOf(payload, 'versionId')!,
    );
    case 'workflow/run': {
      const workflow = stringOf(payload, 'workflow')!;
      if (!['titles', 'brief', 'outline', 'draft', 'humanize', 'review'].includes(workflow)) {
        throw new TypeError('workflow is invalid');
      }
      const optional = (key: string) => stringOf(payload, key, true);
      const versionId = optional('versionId');
      const sourceVersionId = optional('sourceVersionId');
      const briefVersionId = optional('briefVersionId');
      const outlineVersionId = optional('outlineVersionId');
      const selectedTitle = optional('selectedTitle');
      return facade.runWorkflow({
        projectId: stringOf(payload, 'projectId')!,
        workflow: workflow as HumanInkWorkflowInput['workflow'],
        ...(versionId === undefined ? {} : { versionId }),
        ...(sourceVersionId === undefined ? {} : { sourceVersionId }),
        ...(briefVersionId === undefined ? {} : { briefVersionId }),
        ...(outlineVersionId === undefined ? {} : { outlineVersionId }),
        ...(selectedTitle === undefined ? {} : { selectedTitle }),
      });
    }
    case 'tasks/list': {
      const projectId = stringOf(payload, 'projectId', true);
      return projectId === undefined ? facade.listTasks() : facade.listTasks(projectId);
    }
    case 'tasks/cancel': return facade.cancelTask(stringOf(payload, 'taskId')!);
    case 'export/markdown': return facade.exportMarkdown(stringOf(payload, 'versionId')!);
    default: return Promise.reject(new TypeError('endpoint is invalid'));
  }
}

export function createHumanInkRpcHandler(facade: HumanInkUiRouteFacade) {
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<HumanInkRpcResult<unknown>> => {
    if (signal.aborted) {
      return { ok: false, error: { code: 'gateway/cancelled', message: 'HumanInk request cancelled', details: {} } };
    }
    try {
      return { ok: true, value: await dispatch(facade, endpoint, objectOf(payload)) };
    } catch (error) {
      if (error instanceof TypeError) {
        return { ok: false, error: { code: 'humanink/bad-request', message: error.message, details: {} } };
      }
      return { ok: false, error: { code: 'humanink/internal', message: 'HumanInk 请求执行失败', details: {} } };
    }
  };
}

export function registerHumanInkUiRpc(connection: HumanInkConnectionLike, facade: HumanInkUiFacade): () => Promise<void> {
  return connection.rpc.handle('/humanink', createHumanInkRpcHandler(facade));
}
