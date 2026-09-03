import type { ContentProject, ContentVersion } from '@humanink/core';
import type { TaskRecord } from '../runtime/task-runtime.js';

export interface ListContentsInput { readonly query?: string; }
export interface ContentSummary { readonly id: string; readonly title: string; readonly status: ContentProject['status']; readonly currentVersionId?: string; readonly updatedAt: Date; }
export interface ContentDetail { readonly project: ContentProject; readonly currentVersion: ContentVersion | null; readonly versions: readonly ContentVersion[]; }
export interface CreateContentInput { readonly title: string; readonly sourceBody?: string; }
export interface SaveVersionInput { readonly contentId: string; readonly parentVersionId: string; readonly title: string; readonly body: string; }
export type WorkbenchAction = 'titles' | 'brief' | 'outline' | 'draft' | 'humanize' | 'review';
export interface StartActionInput { readonly contentId: string; readonly action: WorkbenchAction; readonly versionId?: string; readonly sourceVersionId?: string; readonly briefVersionId?: string; readonly outlineVersionId?: string; readonly selectedTitle?: string; }
export type CapabilityStatus = 'ready' | 'missing' | 'unsupported' | 'error';
export interface CapabilityState { readonly state: CapabilityStatus; readonly reason?: string; readonly action?: string; }
export interface CapabilityReport { readonly core: CapabilityState; readonly storage: CapabilityState; readonly contentLibrary: CapabilityState; readonly llm: CapabilityState; readonly remote: CapabilityState; readonly credentials: CapabilityState; }
export type WorkbenchTask = TaskRecord;
export interface WorkbenchSettings { readonly libraryRoot?: string; readonly writingProfile: string; }
