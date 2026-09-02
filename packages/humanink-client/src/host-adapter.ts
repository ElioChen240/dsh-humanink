import '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from '@deepseek-ai/cordis';
import type { ComponentType } from 'react';
import type { ContentVersion, ContentVersionKind, CreatedBy, HumanInkClientApi, ProjectDetails, ProjectSummary, RunWorkflowInput, SaveVersionInput, TaskStatus, WorkflowAction, WorkflowTask } from './api.js';
import type { BetterSidebarService } from './better-sidebar-adapter.js';
import type { HumanInkWorkbenchController } from './controller.js';
import { HumanInkApiError, sanitizeErrorText } from './errors.js';
import { createHumanInkOverlay, createHumanInkSidebarAction, type SidebarFooterActionProps } from './react-ui.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': { kind:'list'; scope:'root'; owner:SidebarFooterActionProps };
    'shell.overlay': { kind:'list'; scope:'root'; owner:Record<never, never> };
  }
}

export interface HumanInkRpcClient { call(channel:'/humanink', endpoint:string, payload:object, signal?:AbortSignal):Promise<unknown>; }
export interface SlotRegistration { name:'sidebar.footer.action'|'shell.overlay'; id:string; order:number; label:string; }
export interface HumanInkSlotsService {
  inject(name:SlotRegistration['name'], setup:()=>()=>void):void;
  register<Props>(meta:SlotRegistration, component:ComponentType<Props>):()=>void;
}
/**
 * `betterSidebar` is provided by the dsh-better-sidebar host plugin and is
 * optional: when absent the value is undefined and HumanInk falls back to the
 * legacy sidebar footer action. The structural contract lives in
 * `better-sidebar-adapter.ts` so the client keeps compiling without the host
 * package installed.
 */
export type HumanInkClientContext = Context & {
  slots:HumanInkSlotsService;
  connection:{ rpc:HumanInkRpcClient };
  betterSidebar?:BetterSidebarService | undefined;
};

type JsonRecord = Record<string, unknown>;
const ACTIONS: readonly WorkflowAction[] = ['titles','brief','outline','draft','humanize','review'];
const KINDS: readonly ContentVersionKind[] = ['source','topic','title','brief','outline','draft','humanized','review','restored'];
const CREATORS: readonly CreatedBy[] = ['user','llm','system'];
const STATUSES: readonly TaskStatus[] = ['queued','running','succeeded','failed','cancelled'];
const KIND_LABELS: Record<ContentVersionKind,string> = { source:'原始内容',topic:'选题',title:'标题',brief:'内容简报',outline:'文章大纲',draft:'初稿',humanized:'人味化调整',review:'发布前复核',restored:'恢复版本' };

function recordOf(value:unknown):JsonRecord { if(typeof value!=='object'||value===null||Array.isArray(value)) throw new Error('Invalid HumanInk RPC response'); return value as JsonRecord; }
function stringOf(record:JsonRecord,key:string,optional=false):string|undefined { const value=record[key]; if(value===undefined&&optional)return undefined; if(typeof value!=='string')throw new Error('Invalid HumanInk RPC response'); return value; }
function unwrap<T>(response:unknown):T {
  const envelope=recordOf(response);
  if(envelope.ok===true&&Object.hasOwn(envelope,'value')) return envelope.value as T;
  if(envelope.ok===false){
    const error=recordOf(envelope.error);
    const code=error.code;
    const message=sanitizeErrorText(stringOf(error,'message') ?? 'Invalid HumanInk RPC response');
    throw new HumanInkApiError(message, typeof code==='string'?code:undefined);
  }
  throw new Error('Invalid HumanInk RPC response');
}
function mapProject(value:unknown,fallbackVersionId?:string):ProjectSummary {
  const raw=recordOf(value); const status=raw.status==='archived'?'archived':'active';
  const current=stringOf(raw,'currentVersionId',true)??fallbackVersionId;
  return { id:stringOf(raw,'id')!, title:stringOf(raw,'title')!, status, updatedAt:stringOf(raw,'updatedAt')!, activeVersionId:current };
}
function mapVersion(value:unknown):ContentVersion {
  const raw=recordOf(value); const content=recordOf(raw.content); const kindValue=stringOf(raw,'kind')!; const creatorValue=stringOf(raw,'createdBy')!;
  if(!KINDS.includes(kindValue as ContentVersionKind)||!CREATORS.includes(creatorValue as CreatedBy)) throw new Error('Invalid HumanInk RPC response');
  const kind=kindValue as ContentVersionKind;
  return { id:stringOf(raw,'id')!, projectId:stringOf(raw,'projectId')!, kind, title:stringOf(content,'title')!, body:stringOf(content,'body')!, label:KIND_LABELS[kind], createdBy:creatorValue as CreatedBy, createdAt:stringOf(raw,'createdAt')!, parentVersionId:stringOf(raw,'parentVersionId',true) };
}
function actionFrom(type:string,fallback?:WorkflowAction):WorkflowAction {
  if(fallback) return fallback; const lower=type.toLowerCase();
  if(lower.includes('human')) return 'humanize';
  for(const action of ACTIONS) if(lower.includes(action==='titles'?'title':action)) return action;
  return 'draft';
}
function mapTask(value:unknown,fallback?:WorkflowAction):WorkflowTask {
  const raw=recordOf(value); const statusValue=stringOf(raw,'status')!;
  if(!STATUSES.includes(statusValue as TaskStatus)) throw new Error('Invalid HumanInk RPC response');
  return { id:stringOf(raw,'id')!, projectId:stringOf(raw,'projectId')!, action:actionFrom(stringOf(raw,'type')!,fallback), status:statusValue as TaskStatus, createdAt:stringOf(raw,'startedAt',true)??stringOf(raw,'finishedAt',true), versionId:stringOf(raw,'contentVersionId',true), message:stringOf(raw,'safeMessage',true) };
}
function newest(versions:readonly ContentVersion[],kind:ContentVersionKind):ContentVersion|undefined {
  return versions.filter((version)=>version.kind===kind).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
}
function workflowPayload(input:RunWorkflowInput):JsonRecord {
  const base:JsonRecord={ projectId:input.projectId, workflow:input.workflow };
  if(input.workflow==='humanize'||input.workflow==='review') return { ...base, versionId:input.activeVersionId };
  if(input.workflow==='titles'||input.workflow==='brief'){
    const source=newest(input.versions,'source'); if(!source) throw new Error('当前项目缺少 source 版本');
    return { ...base, sourceVersionId:source.id, ...(input.workflow==='brief'&&input.selectedTitle!==undefined?{selectedTitle:input.selectedTitle}:{}) };
  }
  const brief=newest(input.versions,'brief'); if(!brief) throw new Error('当前项目缺少 brief 版本');
  if(input.workflow==='outline') return { ...base, briefVersionId:brief.id };
  const outline=newest(input.versions,'outline'); if(!outline) throw new Error('当前项目缺少 outline 版本');
  return { ...base, briefVersionId:brief.id, outlineVersionId:outline.id };
}

export function createHumanInkConnectionApi(rpc:HumanInkRpcClient):HumanInkClientApi {
  const call=async<T>(endpoint:string,payload:object,signal?:AbortSignal):Promise<T>=>unwrap<T>(await rpc.call('/humanink',endpoint,payload,signal));
  return {
    async listProjects(){ return (await call<unknown[]>('projects/list',{})).map((project)=>mapProject(project)); },
    async getProject(projectId){
      const raw=await call<unknown>('projects/get',{projectId}); if(raw===null) throw new Error(`Project not found: ${projectId}`);
      const result=recordOf(raw); const versions=(Array.isArray(result.versions)?result.versions:[]).map(mapVersion); const current=result.currentVersion===null||result.currentVersion===undefined?undefined:mapVersion(result.currentVersion);
      return { project:mapProject(result.project,current?.id), currentVersion:current, versions } satisfies ProjectDetails;
    },
    async createProject(title,sourceBody=''){
      const result=recordOf(await call<unknown>('projects/create',{title,sourceTitle:title,sourceBody})); const source=mapVersion(result.sourceVersion); return mapProject(result.project,source.id);
    },
    async saveVersion(input:SaveVersionInput){ return mapVersion(await call<unknown>('versions/save',input)); },
    async restoreVersion(projectId,versionId){ return mapVersion(await call<unknown>('versions/restore',{projectId,versionId})); },
    async runWorkflow(input){ const task=await call<unknown>('workflow/run',workflowPayload(input)); return mapTask(task,input.workflow); },
    async listTasks(projectId){ const raw=await call<unknown[]>('tasks/list',projectId===undefined?{}:{projectId}); return raw.map((task)=>mapTask(task)); },
    cancelTask:(taskId)=>call<boolean>('tasks/cancel',{taskId}),
    exportMarkdown:(versionId)=>call<string>('export/markdown',{versionId}),
  };
}

/**
 * Runtime-safe lookup for the optional dsh-better-sidebar service. Accepts any
 * structurally compatible host object and returns undefined (never throws) when
 * the service is missing or malformed, so plugin loading cannot crash on it.
 */
export function resolveHumanInkBetterSidebar(context:HumanInkClientContext):BetterSidebarService | undefined {
  const candidate=(context as { betterSidebar?:unknown }).betterSidebar as BetterSidebarService | undefined;
  if(!candidate||typeof candidate!=='object') return undefined;
  if(typeof candidate.registerTab!=='function'||typeof candidate.openTab!=='function') return undefined;
  return candidate;
}

export interface HumanInkClientSlotOptions {
  /**
   * The full-screen overlay is no longer a default entry. It only renders when
   * a host explicitly opts in; the native Better Sidebar tab is the primary UI.
   */
  overlay?:boolean;
}

/** Harness Slot/Connection seam. A later bundle must emit lazy-CJS closure output. */
export function registerHumanInkClientSlots(context:HumanInkClientContext,controller:HumanInkWorkbenchController,options:HumanInkClientSlotOptions={}):()=>void {
  const disposers:Array<()=>void>=[]; const SidebarAction=createHumanInkSidebarAction(controller);
  context.slots.inject('sidebar.footer.action',()=>{ const dispose=context.slots.register<SidebarFooterActionProps>({name:'sidebar.footer.action',id:'humanink-open-workbench',order:80,label:'打开 HumanInk'},SidebarAction); disposers.push(dispose); return dispose; });
  if(options.overlay===true){
    const Overlay=createHumanInkOverlay(controller);
    context.slots.inject('shell.overlay',()=>{ const dispose=context.slots.register<Record<never,never>>({name:'shell.overlay',id:'humanink-workbench-overlay',order:100,label:'HumanInk 内容工作台'},Overlay); disposers.push(dispose); return dispose; });
  }
  return()=>{ for(const dispose of [...disposers].reverse())dispose(); disposers.length=0; };
}
