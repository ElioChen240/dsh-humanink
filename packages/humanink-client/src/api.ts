export type WorkflowAction = 'titles' | 'brief' | 'outline' | 'draft' | 'humanize' | 'review';
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ContentVersionKind = 'source' | 'topic' | 'title' | 'brief' | 'outline' | 'draft' | 'humanized' | 'review' | 'restored';
export type CreatedBy = 'user' | 'llm' | 'system';

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
  listProjects(): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectDetails>;
  createProject(title: string, sourceBody?: string): Promise<ProjectSummary>;
  saveVersion(input: SaveVersionInput): Promise<ContentVersion>;
  restoreVersion(projectId: string, versionId: string): Promise<ContentVersion>;
  runWorkflow(input: RunWorkflowInput): Promise<WorkflowTask>;
  listTasks(projectId?: string): Promise<WorkflowTask[]>;
  cancelTask(taskId: string): Promise<boolean>;
  exportMarkdown(versionId: string): Promise<string>;
}
