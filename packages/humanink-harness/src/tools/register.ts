import type { CapabilityReport, ContentDetail, ContentSummary, WorkbenchSettings } from '../application/contracts.js';
import type { ProjectCreationResult } from '../runtime/humanink-application.js';
import type { TaskRecord } from '../runtime/task-runtime.js';
import type { HumanInkWorkbenchRemoteService } from '../remote/host.js';

export const HUMANINK_TOOL_NAMES = [
  'humanink_guide', 'humanink_setup', 'humanink_list_contents', 'humanink_get_content',
  'humanink_create_content', 'humanink_generate_titles', 'humanink_write_draft',
  'humanink_rewrite_content', 'humanink_humanize_content', 'humanink_review_content',
  'humanink_get_task_status',
] as const;

export interface HumanInkToolExecution { readonly signal: AbortSignal; }
export interface HumanInkToolDefinition {
  readonly name: typeof HUMANINK_TOOL_NAMES[number];
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: { readonly schema: Readonly<Record<string, unknown>>; readonly render: (args: Record<string, unknown>, value: any) => readonly { type: 'text'; text: string }[] };
  readonly presentCall: (args: Record<string, unknown>) => { card: 'generic'; title: string; kind: 'other'; rawInput: Record<string, unknown> };
  readonly execute: (args: Record<string, unknown>, execution: HumanInkToolExecution) => Promise<unknown>;
}
export interface HumanInkToolsContext { readonly tools: { register(definition: HumanInkToolDefinition): (() => void) | void }; }

type Args = Record<string, unknown>;
const objectSchema = (properties: Record<string, unknown>, required: readonly string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length === 0 ? {} : { required }) });
const text = (title: string, detail: string) => [{ type: 'text' as const, text: `${title}: ${detail}` }];
const present = (title: string) => (rawInput: Args) => ({ card: 'generic' as const, title, kind: 'other' as const, rawInput });
function requiredString(args: Args, key: string): string { const value = args[key]; if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${key} must be a non-empty string`); return value.trim(); }
function optionalString(args: Args, key: string): string | undefined { const value = args[key]; if (value === undefined) return undefined; if (typeof value !== 'string') throw new TypeError(`${key} must be a string`); return value.trim(); }
function tool(name: HumanInkToolDefinition['name'], description: string, title: string, properties: Record<string, unknown>, required: readonly string[], execute: HumanInkToolDefinition['execute'], render: HumanInkToolDefinition['output']['render']): HumanInkToolDefinition {
  return { name, description, parameters: objectSchema(properties, required), output: { schema: {}, render }, presentCall: present(title), execute };
}
function started(task: TaskRecord) { return { status: 'started', taskId: task.id, contentId: task.projectId, taskStatus: task.status, next: 'humanink_get_task_status' }; }

export function registerHumanInkTools(ctx: HumanInkToolsContext, service: HumanInkWorkbenchRemoteService): () => void {
  const definitions: HumanInkToolDefinition[] = [
    tool('humanink_guide', '查看 HumanInk 能力、当前配置和推荐工作流。不确定下一步或用户询问用法时先调用。', 'HumanInk 使用指引', {}, [], async (_args, exec) => ({ capabilities: await service.getCapabilities(exec.signal), settings: await service.getSettings(exec.signal), workflow: ['创建内容', '生成标题', '写作', '原创改写或人味化', '复核', '查询任务状态'] }), (_args, value) => text('HumanInk', `${Object.values(value.capabilities as CapabilityReport).filter((item) => item.state === 'ready').length} 项能力可用`)),
    tool('humanink_setup', '只读检查或配置内容目录与写作风格。默认仅预览；只有用户确认精确变更后才传 apply=true。不要接收任何 API Key。', 'HumanInk 配置', { apply: { type: 'boolean' }, libraryRoot: { type: 'string' }, writingProfile: { type: 'string' } }, [], async (args, exec) => {
      const current = await service.getSettings(exec.signal); const capabilities = await service.getCapabilities(exec.signal);
      const libraryRoot = optionalString(args, 'libraryRoot'); const writingProfile = optionalString(args, 'writingProfile');
      const proposed: WorkbenchSettings = { ...(libraryRoot === undefined ? (current.libraryRoot === undefined ? {} : { libraryRoot: current.libraryRoot }) : { libraryRoot }), writingProfile: writingProfile ?? current.writingProfile };
      if (args.apply !== true) return { applied: false, current, proposed, capabilities };
      if (libraryRoot !== undefined) await service.setLibraryRoot(libraryRoot, exec.signal);
      if (writingProfile !== undefined) await service.setWritingProfile(writingProfile, exec.signal);
      return { applied: true, settings: proposed, capabilities: await service.getCapabilities(exec.signal) };
    }, (_args, value) => text(value.applied ? '配置已应用' : '配置预览', value.applied ? '已保存用户确认的变更' : '等待用户确认')),
    tool('humanink_list_contents', '列出或搜索 HumanInk 内容项目。', '内容列表', { query: { type: 'string' } }, [], async (args, exec) => { const query = optionalString(args, 'query'); return service.listContents(query === undefined ? {} : { query }, exec.signal); }, (_args, value: readonly ContentSummary[]) => text('内容列表', `${value.length} 项`)),
    tool('humanink_get_content', '读取指定内容及版本链；仅在任务需要或用户明确引用时加载正文。', '读取内容', { contentId: { type: 'string' } }, ['contentId'], async (args, exec) => service.getContent(requiredString(args, 'contentId'), exec.signal), (_args, value: ContentDetail | null) => text('内容', value?.project.title ?? '未找到')),
    tool('humanink_create_content', '创建新的内容项目和源版本。', '新建内容', { title: { type: 'string' }, sourceBody: { type: 'string' } }, ['title'], async (args, exec) => service.createContent({ title: requiredString(args, 'title'), ...(typeof args.sourceBody === 'string' ? { sourceBody: args.sourceBody } : {}) }, exec.signal), (_args, value: ProjectCreationResult) => text('内容已创建', value.project.id)),
    tool('humanink_generate_titles', '基于源版本启动爆款标题生成。返回任务已启动，随后必须查询状态。', '生成标题', { contentId: { type: 'string' }, sourceVersionId: { type: 'string' } }, ['contentId', 'sourceVersionId'], async (args, exec) => started(await service.startAction({ contentId: requiredString(args, 'contentId'), action: 'titles', sourceVersionId: requiredString(args, 'sourceVersionId') }, exec.signal)), (_args, value) => text('任务已启动', value.taskId)),
    tool('humanink_write_draft', '根据简报版本和大纲版本启动初稿写作；生成结果保存为新版本。', '写初稿', { contentId: { type: 'string' }, briefVersionId: { type: 'string' }, outlineVersionId: { type: 'string' } }, ['contentId', 'briefVersionId', 'outlineVersionId'], async (args, exec) => started(await service.startAction({ contentId: requiredString(args, 'contentId'), action: 'draft', briefVersionId: requiredString(args, 'briefVersionId'), outlineVersionId: requiredString(args, 'outlineVersionId') }, exec.signal)), (_args, value) => text('任务已启动', value.taskId)),
    tool('humanink_rewrite_content', '基于指定版本启动原创改写，不覆盖原版本。', '原创改写', { contentId: { type: 'string' }, versionId: { type: 'string' } }, ['contentId', 'versionId'], async (args, exec) => started(await service.startAction({ contentId: requiredString(args, 'contentId'), action: 'humanize', versionId: requiredString(args, 'versionId') }, exec.signal)), (_args, value) => text('任务已启动', value.taskId)),
    tool('humanink_humanize_content', '对指定版本启动中文人味化改写，结果保存为新版本。', '人味化', { contentId: { type: 'string' }, versionId: { type: 'string' } }, ['contentId', 'versionId'], async (args, exec) => started(await service.startAction({ contentId: requiredString(args, 'contentId'), action: 'humanize', versionId: requiredString(args, 'versionId') }, exec.signal)), (_args, value) => text('任务已启动', value.taskId)),
    tool('humanink_review_content', '启动发布前复核，输出独立复核版本。', '复核内容', { contentId: { type: 'string' }, versionId: { type: 'string' } }, ['contentId', 'versionId'], async (args, exec) => started(await service.startAction({ contentId: requiredString(args, 'contentId'), action: 'review', versionId: requiredString(args, 'versionId') }, exec.signal)), (_args, value) => text('任务已启动', value.taskId)),
    tool('humanink_get_task_status', '查询异步写作任务状态。只有状态 succeeded 且产物版本存在时才能称为完成。', '任务状态', { taskId: { type: 'string' } }, ['taskId'], async (args, exec) => { const task = await service.getTask(requiredString(args, 'taskId'), exec.signal); return task === null ? { status: 'not_found' } : { status: task.status, taskId: task.id, contentId: task.projectId, contentVersionId: task.contentVersionId, completed: task.status === 'succeeded' && task.contentVersionId !== undefined }; }, (_args, value) => text('任务状态', value.status)),
  ];
  const disposers: Array<() => void> = [];
  for (const definition of definitions) { const dispose = ctx.tools.register(definition); if (dispose !== undefined) disposers.push(dispose); }
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}