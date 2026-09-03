import type { ContentProject, ContentVersion, ContentVersionSummary } from '@humanink/core';
import type { HumanInkApplication, ProjectCreationResult } from '../runtime/humanink-application.js';
import type { TaskRecord } from '../runtime/task-runtime.js';
import type { CapabilityReport, ContentDetail, ContentSummary, CreateContentInput, ListContentsInput, SaveVersionInput, StartActionInput } from './contracts.js';

type WorkbenchApplication = Pick<HumanInkApplication,
  'listProjects' | 'getProject' | 'listVersions' | 'getVersion' | 'createProject' |
  'createDerivedVersion' | 'generateTitles' | 'generateBrief' | 'generateOutline' |
  'generateDraft' | 'humanizeContent' | 'reviewContent' | 'getTask'>;

export interface HumanInkWorkbenchServiceDependencies { readonly application: WorkbenchApplication; }

function requireId(value: string | undefined, field: string): string {
  if (value === undefined || value.trim().length === 0) throw new TypeError(`${field} is required for this action`);
  return value;
}

function throwIfAborted(signal?: AbortSignal): void { signal?.throwIfAborted(); }

export class HumanInkWorkbenchService {
  private revision = 0;
  constructor(private readonly dependencies: HumanInkWorkbenchServiceDependencies) {}

  async listContents(input: ListContentsInput, signal?: AbortSignal): Promise<readonly ContentSummary[]> {
    throwIfAborted(signal);
    const query = input.query?.trim().toLocaleLowerCase();
    const projects = await this.dependencies.application.listProjects();
    throwIfAborted(signal);
    return projects
      .filter((project) => query === undefined || query.length === 0 || project.title.toLocaleLowerCase().includes(query))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((project) => ({ id: project.id, title: project.title, status: project.status, updatedAt: project.updatedAt, ...(project.currentVersionId === undefined ? {} : { currentVersionId: project.currentVersionId }) }));
  }

  async getContent(contentId: string, signal?: AbortSignal): Promise<ContentDetail | null> {
    throwIfAborted(signal);
    const project = await this.dependencies.application.getProject(contentId);
    if (project === null) return null;
    const summaries = await this.dependencies.application.listVersions(contentId) as readonly ContentVersionSummary[];
    const versions = await Promise.all(summaries.map(({ id }) => this.dependencies.application.getVersion(id)));
    throwIfAborted(signal);
    const existing = versions.filter((item): item is ContentVersion => item !== null);
    const currentVersion = project.currentVersionId === undefined ? null : existing.find(({ id }) => id === project.currentVersionId) ?? await this.dependencies.application.getVersion(project.currentVersionId);
    return { project, currentVersion, versions: existing };
  }

  async createContent(input: CreateContentInput, signal?: AbortSignal): Promise<ProjectCreationResult> {
    throwIfAborted(signal);
    const title = input.title.trim();
    if (title.length === 0) throw new TypeError('title must not be empty');
    const result = await this.dependencies.application.createProject({ title, source: { title, body: input.sourceBody?.trim() ?? '' } });
    this.revision += 1;
    return result;
  }

  async saveVersion(input: SaveVersionInput, signal?: AbortSignal): Promise<ContentVersion> {
    throwIfAborted(signal);
    const parent = await this.dependencies.application.getVersion(input.parentVersionId);
    if (parent === null) throw new Error(`Content version not found: ${input.parentVersionId}`);
    if (parent.projectId !== input.contentId) throw new Error(`Content version ${parent.id} does not belong to project ${input.contentId}`);
    const saved = await this.dependencies.application.createDerivedVersion({ projectId: input.contentId, parentVersionId: parent.id, kind: 'draft', content: { format: 'markdown', title: input.title, body: input.body }, createdBy: 'user', userConfirmed: true, protectedFields: parent.protectedFields, sourceRefs: parent.sourceRefs });
    this.revision += 1;
    return saved;
  }

  async startAction(input: StartActionInput, signal?: AbortSignal): Promise<TaskRecord> {
    throwIfAborted(signal);
    const projectId = input.contentId;
    let task: TaskRecord;
    switch (input.action) {
      case 'titles': task = this.dependencies.application.generateTitles({ projectId, sourceVersionId: requireId(input.sourceVersionId ?? input.versionId, 'sourceVersionId'), count: 5 }, signal); break;
      case 'brief': task = this.dependencies.application.generateBrief({ projectId, sourceVersionId: requireId(input.sourceVersionId ?? input.versionId, 'sourceVersionId'), ...(input.selectedTitle === undefined ? {} : { selectedTitle: input.selectedTitle }) }, signal); break;
      case 'outline': task = this.dependencies.application.generateOutline({ projectId, briefVersionId: requireId(input.briefVersionId ?? input.versionId, 'briefVersionId') }, signal); break;
      case 'draft': task = this.dependencies.application.generateDraft({ projectId, briefVersionId: requireId(input.briefVersionId, 'briefVersionId'), outlineVersionId: requireId(input.outlineVersionId ?? input.versionId, 'outlineVersionId'), length: 'medium' }, signal); break;
      case 'humanize': task = this.dependencies.application.humanizeContent({ projectId, versionId: requireId(input.versionId, 'versionId') }, signal); break;
      case 'review': task = this.dependencies.application.reviewContent({ projectId, versionId: requireId(input.versionId, 'versionId') }, signal); break;
    }
    this.revision += 1;
    return task;
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<TaskRecord | null> { throwIfAborted(signal); return this.dependencies.application.getTask(taskId); }
  async getCapabilities(signal?: AbortSignal): Promise<CapabilityReport> { throwIfAborted(signal); return { core: { state: 'ready' }, storage: { state: 'ready' } }; }
  async getRevision(signal?: AbortSignal): Promise<number> { throwIfAborted(signal); return this.revision; }
}