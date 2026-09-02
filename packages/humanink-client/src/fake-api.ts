import type { ContentVersion, HumanInkClientApi, ProjectDetails, ProjectSummary, RunWorkflowInput, SaveVersionInput, TaskStatus, WorkflowTask } from './api.js';

export interface HumanInkFakeApi extends HumanInkClientApi {
  advanceTask(id: string, status: TaskStatus, message?: string): Promise<void>;
}
const clone = <T>(value: T): T => structuredClone(value);
const kindLabel = (kind: ContentVersion['kind']): string => ({ source:'原始内容', topic:'选题', title:'标题', brief:'内容简报', outline:'文章大纲', draft:'初稿', humanized:'人味化调整', review:'发布前复核', restored:'恢复版本' })[kind];
const at = (sequence: number): string => new Date(Date.UTC(2026, 8, 2, 8, sequence)).toISOString();

export function createHumanInkFakeApi(): HumanInkFakeApi {
  let sequence = 10;
  const versions = new Map<string, ContentVersion[]>([
    ['project-tea', [
      { id:'tea-v2', projectId:'project-tea', kind:'humanized', title:'不是所有的茶，都适合慢慢喝', body:'有些茶要趁热喝，有些话却要等一等再说。\n\n真正让人记住的，往往不是术语，而是某个具体的下午。', label:'人味化调整', createdBy:'llm', createdAt:'2026-09-02T08:02:00.000Z', parentVersionId:'tea-v1' },
      { id:'tea-v1', projectId:'project-tea', kind:'source', title:'关于喝茶这件小事', body:'这是第一版正文，先把观点和材料放在桌面上。', label:'原始内容', createdBy:'user', createdAt:'2026-09-02T08:01:00.000Z', parentVersionId:undefined },
    ]],
    ['project-night', [
      { id:'night-v1', projectId:'project-night', kind:'source', title:'深夜便利店里，藏着城市的另一面', body:'凌晨一点，货架上的灯比街道更亮。有人买水，有人只是想找个地方停一下。', label:'原始内容', createdBy:'user', createdAt:'2026-09-01T20:10:00.000Z', parentVersionId:undefined },
    ]],
  ]);
  const projects: ProjectSummary[] = [
    { id:'project-tea', title:'不是所有的茶，都适合慢慢喝', status:'active', updatedAt:'2026-09-02T08:02:00.000Z', activeVersionId:'tea-v2' },
    { id:'project-night', title:'深夜便利店里，藏着城市的另一面', status:'active', updatedAt:'2026-09-01T20:10:00.000Z', activeVersionId:'night-v1' },
  ];
  const tasks: WorkflowTask[] = [];
  const requireProject = (id: string) => { const project=projects.find((item)=>item.id===id); if(!project) throw new Error(`Project not found: ${id}`); return project; };
  const details = (id: string): ProjectDetails => {
    const project=requireProject(id); const list=versions.get(id) ?? []; const current=list.find((version)=>version.id===project.activeVersionId);
    return { project:clone(project), currentVersion:current ? clone(current) : undefined, versions:clone(list) };
  };

  const api: HumanInkFakeApi = {
    async listProjects(){ return clone(projects); },
    async getProject(projectId){ return details(projectId); },
    async createProject(title, sourceBody=''){
      sequence+=1; const id=`project-${sequence}`; const versionId=`${id}-v1`; const createdAt=at(sequence); const clean=title.trim()||'未命名文章';
      const version:ContentVersion={ id:versionId, projectId:id, kind:'source', title:clean, body:sourceBody, label:'原始内容', createdBy:'user', createdAt, parentVersionId:undefined };
      const project:ProjectSummary={ id, title:clean, status:'active', updatedAt:createdAt, activeVersionId:versionId };
      versions.set(id,[version]); projects.unshift(project); return clone(project);
    },
    async saveVersion(input:SaveVersionInput){
      const project=requireProject(input.projectId); const list=versions.get(input.projectId)??[];
      if(!list.some((item)=>item.id===input.parentVersionId)) throw new Error(`Parent version not found: ${input.parentVersionId}`);
      sequence+=1; const createdAt=at(sequence); const version:ContentVersion={ id:`${input.projectId}-v${list.length+1}`, projectId:input.projectId, kind:'draft', title:input.title.trim()||'未命名文章', body:input.body, label:'初稿', createdBy:'user', createdAt, parentVersionId:input.parentVersionId };
      list.unshift(version); versions.set(input.projectId,list); project.title=version.title; project.activeVersionId=version.id; project.updatedAt=createdAt; projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)); return clone(version);
    },
    async restoreVersion(projectId, versionId){
      const project=requireProject(projectId); const list=versions.get(projectId)??[]; const target=list.find((item)=>item.id===versionId); if(!target) throw new Error(`Version not found: ${versionId}`);
      sequence+=1; const restored:ContentVersion={ ...clone(target), id:`${projectId}-v${list.length+1}`, kind:'restored', label:kindLabel('restored'), createdBy:'user', createdAt:at(sequence), parentVersionId:target.id };
      list.unshift(restored); project.activeVersionId=restored.id; project.updatedAt=restored.createdAt; return clone(restored);
    },
    async runWorkflow(input:RunWorkflowInput){
      requireProject(input.projectId); sequence+=1; const task:WorkflowTask={ id:`task-${sequence}`, projectId:input.projectId, action:input.workflow, status:'queued', createdAt:at(sequence), versionId:undefined, message:undefined }; tasks.unshift(task); return clone(task);
    },
    async listTasks(projectId){ return clone(tasks.filter((task)=>projectId===undefined||task.projectId===projectId)); },
    async cancelTask(taskId){ const task=tasks.find((item)=>item.id===taskId); if(!task) return false; task.status='cancelled'; return true; },
    async exportMarkdown(versionId){ for(const list of versions.values()){ const version=list.find((item)=>item.id===versionId); if(version) return `# ${version.title}\n\n${version.body}\n`; } throw new Error(`Version not found: ${versionId}`); },
    async advanceTask(id,status,message){ const task=tasks.find((item)=>item.id===id); if(!task) throw new Error(`Task not found: ${id}`); task.status=status; task.message=message; },
  };
  return api;
}
