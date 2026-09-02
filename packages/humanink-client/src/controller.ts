import type { ContentVersion, HumanInkClientApi, ProjectSummary, WorkflowAction, WorkflowTask } from './api.js';
import { describeFailure, formatFailure, sanitizeErrorText, type SafeFailureDetail } from './errors.js';

export type WorkbenchMode = 'edit' | 'preview';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface WorkbenchState {
  isOpen: boolean; loading: boolean; error: string | undefined;
  errorDetail: SafeFailureDetail | undefined;
  projects: ProjectSummary[]; versions: ContentVersion[]; tasks: WorkflowTask[];
  activeProjectId: string | undefined; activeVersionId: string | undefined;
  mode: WorkbenchMode; saveStatus: SaveStatus;
  editor: { title: string; body: string; dirty: boolean };
}
export type WorkbenchListener = (state: Readonly<WorkbenchState>) => void;
const INITIAL_STATE: WorkbenchState = {
  isOpen:false, loading:false, error:undefined, errorDetail:undefined, projects:[], versions:[], tasks:[],
  activeProjectId:undefined, activeVersionId:undefined, mode:'edit', saveStatus:'idle',
  editor:{ title:'', body:'', dirty:false },
};
const messageFrom = (error: unknown): string => error instanceof Error ? sanitizeErrorText(error.message) : '发生未知错误';
/** Clearing an error always clears its structured detail with it. */
const noError = { error: undefined, errorDetail: undefined } as const;

export class HumanInkWorkbenchController {
  private state: WorkbenchState = structuredClone(INITIAL_STATE);
  private readonly listeners = new Set<WorkbenchListener>();
  constructor(private readonly api: HumanInkClientApi) {}
  getState(): Readonly<WorkbenchState> { return this.state; }
  subscribe(listener: WorkbenchListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async initialize(): Promise<void> {
    this.patch({ loading:true, ...noError });
    try {
      const projects = await this.api.listProjects();
      this.patch({ projects, loading:false });
      if (projects[0]) await this.selectProject(projects[0].id);
    } catch (error) { this.patch({ loading:false, error:messageFrom(error) }); }
  }
  open(): void { this.patch({ isOpen:true }); }
  close(): void { this.patch({ isOpen:false }); }

  async createProject(title: string): Promise<void> {
    this.patch({ loading:true, ...noError });
    try {
      const project = await this.api.createProject(title);
      const projects = await this.api.listProjects();
      this.patch({ projects, loading:false, mode:'edit' });
      await this.selectProject(project.id);
    } catch (error) { this.patch({ loading:false, error:messageFrom(error) }); }
  }

  async selectProject(projectId: string): Promise<void> {
    this.patch({ loading:true, ...noError, activeProjectId:projectId });
    try {
      const [details, tasks] = await Promise.all([this.api.getProject(projectId), this.api.listTasks(projectId)]);
      const current = details.currentVersion ?? details.versions[0];
      this.patch({
        projects:this.state.projects.map((project) => project.id === details.project.id ? details.project : project),
        versions:details.versions, tasks, activeProjectId:details.project.id,
        activeVersionId:current?.id, loading:false, saveStatus:'idle',
        editor:{ title:current?.title ?? details.project.title, body:current?.body ?? '', dirty:false },
      });
    } catch (error) { this.patch({ loading:false, error:messageFrom(error) }); }
  }

  async selectVersion(versionId: string): Promise<void> {
    const version = this.state.versions.find((item) => item.id === versionId);
    if (!version) { this.patch({ error:`Version not found: ${versionId}` }); return; }
    this.patch({ activeVersionId:version.id, saveStatus:'idle', editor:{ title:version.title, body:version.body, dirty:false } });
  }

  updateEditor(patch: Partial<Pick<WorkbenchState['editor'], 'title' | 'body'>>): void {
    this.patch({ saveStatus:'idle', editor:{ ...this.state.editor, ...patch, dirty:true } });
  }
  setMode(mode: WorkbenchMode): void { this.patch({ mode }); }

  async save(_label = '人工编辑'): Promise<void> {
    const { activeProjectId, activeVersionId, editor } = this.state;
    if (!activeProjectId || !activeVersionId) return;
    this.patch({ saveStatus:'saving', ...noError });
    try {
      await this.api.saveVersion({ projectId:activeProjectId, parentVersionId:activeVersionId, title:editor.title, body:editor.body });
      const [projects, details] = await Promise.all([this.api.listProjects(), this.api.getProject(activeProjectId)]);
      const current = details.currentVersion ?? details.versions[0];
      this.patch({ projects, versions:details.versions, activeVersionId:current?.id, saveStatus:'saved', editor:{ title:current?.title ?? editor.title, body:current?.body ?? editor.body, dirty:false } });
    } catch (error) { this.patch({ saveStatus:'error', error:messageFrom(error) }); }
  }

  async triggerAction(workflow: WorkflowAction, selectedTitle?: string): Promise<WorkflowTask> {
    const projectId = this.state.activeProjectId;
    const activeVersionId = this.state.activeVersionId;
    if (!projectId || !activeVersionId) throw new Error('请先选择一个项目版本');
    this.patch({ ...noError });
    try {
      const task = await this.api.runWorkflow({ projectId, workflow, activeVersionId, versions:this.state.versions, ...(selectedTitle === undefined ? {} : { selectedTitle }) });
      this.patch({ tasks:[task, ...this.state.tasks.filter((item) => item.id !== task.id)] });
      return task;
    } catch (error) {
      const detail = describeFailure(error);
      this.patch({ error: formatFailure(detail, workflow), errorDetail: detail });
      throw error;
    }
  }
  async refreshTasks(): Promise<void> { this.patch({ tasks:await this.api.listTasks(this.state.activeProjectId) }); }
  async refreshTasksAndProject(): Promise<void> {
    const projectId = this.state.activeProjectId;
    if (!projectId) {
      await this.refreshTasks();
      return;
    }
    try {
      const [details, tasks] = await Promise.all([this.api.getProject(projectId), this.api.listTasks(projectId)]);
      const current = details.currentVersion ?? details.versions[0];
      const activeVersionStillExists = details.versions.some((version) => version.id === this.state.activeVersionId);
      const shouldFollowGeneratedVersion = tasks.some((task) => task.status === 'succeeded' && task.versionId === current?.id);
      const selected = shouldFollowGeneratedVersion || !activeVersionStillExists
        ? current
        : details.versions.find((version) => version.id === this.state.activeVersionId) ?? current;
      this.patch({
        projects: this.state.projects.map((project) => project.id === details.project.id ? details.project : project),
        versions: details.versions,
        tasks,
        activeVersionId: selected?.id,
        editor: this.state.editor.dirty
          ? this.state.editor
          : { title: selected?.title ?? details.project.title, body: selected?.body ?? '', dirty: false },
      });
    } catch (error) {
      this.patch({ error: messageFrom(error) });
    }
  }
  async cancelTask(taskId: string): Promise<void> { await this.api.cancelTask(taskId); await this.refreshTasks(); }
  async restoreVersion(versionId: string): Promise<void> {
    const projectId = this.state.activeProjectId;
    if (!projectId) return;
    await this.api.restoreVersion(projectId, versionId);
    await this.selectProject(projectId);
  }
  async exportMarkdown(): Promise<string | undefined> {
    return this.state.activeVersionId ? this.api.exportMarkdown(this.state.activeVersionId) : undefined;
  }
  private patch(patch: Partial<WorkbenchState>): void { this.state={ ...this.state, ...patch }; for (const listener of this.listeners) listener(this.state); }
}
