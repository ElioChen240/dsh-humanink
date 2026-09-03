import type { CapabilityReport, ContentVersion, ContentVersionKind, CreatedBy, HumanInkClientApi, ProjectDetails, ProjectSummary, RunWorkflowInput, SaveVersionInput, TaskStatus, WorkflowAction, WorkflowTask } from '../api.js';
import { HumanInkApiError, sanitizeErrorText } from '../errors.js';

export const HUMANINK_WORKBENCH_REMOTE_CHANNEL = '/humanink/workbench' as const;
export interface HumanInkWorkbenchRpcClient { call(channel: typeof HUMANINK_WORKBENCH_REMOTE_CHANNEL, invocation: string, payload: object, signal?: AbortSignal): Promise<unknown>; }

type RecordLike = Record<string, unknown>;
const ACTIONS: readonly WorkflowAction[] = ['titles', 'brief', 'outline', 'draft', 'humanize', 'review'];
const KINDS: readonly ContentVersionKind[] = ['source', 'topic', 'title', 'brief', 'outline', 'draft', 'humanized', 'review', 'restored'];
const CREATORS: readonly CreatedBy[] = ['user', 'llm', 'system'];
const STATUSES: readonly TaskStatus[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const KIND_LABELS: Record<ContentVersionKind, string> = { source: '原始内容', topic: '选题', title: '标题', brief: '内容简报', outline: '文章大纲', draft: '初稿', humanized: '人味化调整', review: '发布前复核', restored: '恢复版本' };

function recordOf(value: unknown): RecordLike { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid HumanInk remote response'); return value as RecordLike; }
function requiredString(record: RecordLike, key: string): string { const value = record[key]; if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid HumanInk remote response'); return value; }
function optionalString(record: RecordLike, key: string): string | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'string') throw new Error('Invalid HumanInk remote response'); return value; }
function unwrap<T>(response: unknown): T {
  const envelope = recordOf(response);
  if (envelope.ok === true && Object.hasOwn(envelope, 'value')) return envelope.value as T;
  if (envelope.ok === false) {
    const error = recordOf(envelope.error);
    const code = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string' ? sanitizeErrorText(error.message) : 'HumanInk remote request failed';
    throw new HumanInkApiError(message, code);
  }
  throw new Error('Invalid HumanInk remote response');
}
function mapProject(value: unknown, fallbackVersionId?: string): ProjectSummary {
  const raw = recordOf(value); const activeVersionId = optionalString(raw, 'currentVersionId') ?? fallbackVersionId;
  return { id: requiredString(raw, 'id'), title: requiredString(raw, 'title'), status: raw.status === 'archived' ? 'archived' : 'active', updatedAt: requiredString(raw, 'updatedAt'), activeVersionId };
}
function mapVersion(value: unknown): ContentVersion {
  const raw = recordOf(value); const content = recordOf(raw.content); const kind = requiredString(raw, 'kind') as ContentVersionKind; const createdBy = requiredString(raw, 'createdBy') as CreatedBy;
  if (!KINDS.includes(kind) || !CREATORS.includes(createdBy)) throw new Error('Invalid HumanInk remote response');
  return { id: requiredString(raw, 'id'), projectId: requiredString(raw, 'projectId'), kind, title: requiredString(content, 'title'), body: requiredString(content, 'body'), label: KIND_LABELS[kind], createdBy, createdAt: requiredString(raw, 'createdAt'), parentVersionId: optionalString(raw, 'parentVersionId') };
}
function actionFrom(type: string, fallback?: WorkflowAction): WorkflowAction { if (fallback) return fallback; const lower = type.toLowerCase(); if (lower.includes('human')) return 'humanize'; for (const action of ACTIONS) if (lower.includes(action === 'titles' ? 'title' : action)) return action; return 'draft'; }
function mapTask(value: unknown, fallback?: WorkflowAction): WorkflowTask {
  const raw = recordOf(value); const status = requiredString(raw, 'status') as TaskStatus; if (!STATUSES.includes(status)) throw new Error('Invalid HumanInk remote response');
  return { id: requiredString(raw, 'id'), projectId: requiredString(raw, 'projectId'), action: actionFrom(requiredString(raw, 'type'), fallback), status, createdAt: optionalString(raw, 'createdAt'), versionId: optionalString(raw, 'contentVersionId'), message: optionalString(raw, 'error') ?? optionalString(raw, 'message') };
}
function workflowPayload(input: RunWorkflowInput): RecordLike {
  const base = { contentId: input.projectId, action: input.workflow } as RecordLike;
  if (input.workflow === 'titles' || input.workflow === 'brief') {
    const source = input.versions.find((item) => item.id === input.activeVersionId && item.kind === 'source') ?? input.versions.find((item) => item.kind === 'source');
    if (!source) throw new Error('当前项目缺少 source 版本');
    return { ...base, sourceVersionId: source.id, ...(input.workflow === 'brief' && input.selectedTitle === undefined ? {} : { ...(input.selectedTitle === undefined ? {} : { selectedTitle: input.selectedTitle }) }) };
  }
  const brief = input.versions.find((item) => item.kind === 'brief'); if (!brief) throw new Error('当前项目缺少 brief 版本');
  if (input.workflow === 'outline') return { ...base, briefVersionId: brief.id };
  const outline = input.versions.find((item) => item.kind === 'outline'); if (!outline) throw new Error('当前项目缺少 outline 版本');
  if (input.workflow === 'draft') return { ...base, briefVersionId: brief.id, outlineVersionId: outline.id };
  const version = input.versions.find((item) => item.id === input.activeVersionId) ?? input.versions[0]; if (!version) throw new Error('当前项目缺少可用版本');
  return { ...base, versionId: version.id };
}

export function createHumanInkWorkbenchRemoteClient(rpc: HumanInkWorkbenchRpcClient): HumanInkClientApi {
  const taskCache = new Map<string, WorkflowTask>();
  const call = async <T>(invocation: string, payload: object, signal?: AbortSignal): Promise<T> => unwrap<T>(await rpc.call(HUMANINK_WORKBENCH_REMOTE_CHANNEL, invocation, payload, signal));
  return {
    async listProjects(signal?: AbortSignal) { const raw = await call<unknown[]>('listContents', {}, signal); return raw.map((item) => mapProject(item)); },
    async getProject(projectId: string, signal?: AbortSignal) { const raw = recordOf(await call<unknown>('getContent', { contentId: projectId }, signal)); const versions = Array.isArray(raw.versions) ? raw.versions.map(mapVersion) : []; const currentVersion = raw.currentVersion === null || raw.currentVersion === undefined ? undefined : mapVersion(raw.currentVersion); return { project: mapProject(raw.project, currentVersion?.id), currentVersion, versions } satisfies ProjectDetails; },
    async createProject(title: string, sourceBody = '', signal?: AbortSignal) { const result = recordOf(await call<unknown>('createContent', { title, ...(sourceBody.length === 0 ? {} : { sourceBody }) }, signal)); return mapProject(result.project, mapVersion(result.sourceVersion).id); },
    async saveVersion(input: SaveVersionInput, signal?: AbortSignal) { return mapVersion(await call<unknown>('saveVersion', input, signal)); },
    async restoreVersion(_projectId: string, versionId: string, signal?: AbortSignal) { throw new HumanInkApiError(`恢复版本暂未接入 Workbench Remote：${versionId}`, 'UNSUPPORTED'); },
    async runWorkflow(input: RunWorkflowInput, signal?: AbortSignal) { const task = mapTask(await call<unknown>('startAction', workflowPayload(input), signal), input.workflow); taskCache.set(task.id, task); return task; },
    async listTasks(projectId?: string, signal?: AbortSignal) { const tasks = await Promise.all([...taskCache.values()].filter((task) => projectId === undefined || task.projectId === projectId).map(async (task) => { const current = await call<unknown>('getTask', { taskId: task.id }, signal); return current === null ? task : mapTask(current, task.action); })); tasks.forEach((task) => taskCache.set(task.id, task)); return tasks; },
    async cancelTask(taskId: string, signal?: AbortSignal) { const result = await call<boolean>('cancelTask', { taskId }, signal); const cached = taskCache.get(taskId); if (result && cached) taskCache.set(taskId, { ...cached, status: 'cancelled' }); return result; },
    async getCapabilities(signal?: AbortSignal) { return call<CapabilityReport>('getCapabilities', {}, signal); },
    async exportMarkdown(_versionId: string, _signal?: AbortSignal) { throw new HumanInkApiError('Markdown 导出暂未接入 Workbench Remote', 'UNSUPPORTED'); },
  };
}
