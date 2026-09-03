export type WorkflowAction = 'titles' | 'brief' | 'outline' | 'draft' | 'humanize' | 'review';
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ContentVersionKind = 'source' | 'topic' | 'title' | 'brief' | 'outline' | 'draft' | 'humanized' | 'review' | 'restored';
export type CreatedBy = 'user' | 'llm' | 'system';
export type CapabilityStatus = 'ready' | 'missing' | 'unsupported' | 'error';
export interface CapabilityState { readonly state: CapabilityStatus; readonly reason?: string; readonly action?: string; }
export interface CapabilityReport { readonly core: CapabilityState; readonly storage: CapabilityState; readonly contentLibrary: CapabilityState; readonly llm: CapabilityState; readonly remote: CapabilityState; readonly credentials: CapabilityState; }

export interface ProjectSummary {
  id: string;
  title: string;
  status: 'active' | 'archived';
  updatedAt: string;
  activeVersionId: string | undefined;
}
export interface ContentVersion {
  id: string;
  projectId: string;
  kind: ContentVersionKind;
  title: string;
  body: string;
  label: string;
  createdBy: CreatedBy;
  createdAt: string;
  parentVersionId: string | undefined;
}
export interface ProjectDetails {
  project: ProjectSummary;
  currentVersion: ContentVersion | undefined;
  versions: ContentVersion[];
}
export interface WorkflowTask {
  id: string;
  projectId: string;
  action: WorkflowAction;
  status: TaskStatus;
  createdAt: string | undefined;
  versionId: string | undefined;
  message: string | undefined;
}
export interface SaveVersionInput {
  projectId: string;
  parentVersionId: string;
  title: string;
  body: string;
}
export interface RunWorkflowInput {
  projectId: string;
  workflow: WorkflowAction;
  activeVersionId: string;
  versions: readonly ContentVersion[];
  selectedTitle?: string;
}

/** Browser-side boundary; only an adapter or test fake may implement it. */
export interface HumanInkClientApi {
  listProjects(signal?: AbortSignal): Promise<ProjectSummary[]>;
  getProject(projectId: string, signal?: AbortSignal): Promise<ProjectDetails>;
  createProject(title: string, sourceBody?: string, signal?: AbortSignal): Promise<ProjectSummary>;
  saveVersion(input: SaveVersionInput, signal?: AbortSignal): Promise<ContentVersion>;
  restoreVersion(projectId: string, versionId: string, signal?: AbortSignal): Promise<ContentVersion>;
  runWorkflow(input: RunWorkflowInput, signal?: AbortSignal): Promise<WorkflowTask>;
  listTasks(projectId?: string, signal?: AbortSignal): Promise<WorkflowTask[]>;
  cancelTask(taskId: string, signal?: AbortSignal): Promise<boolean>;
  exportMarkdown(versionId: string, signal?: AbortSignal): Promise<string>;
  getCapabilities?(signal?: AbortSignal): Promise<CapabilityReport>;
}
