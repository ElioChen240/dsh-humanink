import { useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from 'react';
import type { TaskStatus, WorkflowAction } from './api.js';
import type { HumanInkWorkbenchController, WorkbenchState } from './controller.js';
import { HUMANINK_THEME } from './theme.js';

export interface HumanInkWorkbenchProps { controller: HumanInkWorkbenchController; }
export interface SidebarFooterActionProps { wide: boolean; }

const ACTION_LABELS: Record<WorkflowAction, string> = {
  titles: '生成标题', brief: '生成简报', outline: '生成大纲', draft: '生成初稿', humanize: '人味化改写', review: '发布前复核',
};
const TASK_LABELS: Record<TaskStatus, string> = {
  queued: '排队中', running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

function useWorkbenchState(controller: HumanInkWorkbenchController): Readonly<WorkbenchState> {
  return useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.getState(),
    () => controller.getState(),
  );
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function saveLabel(state: Readonly<WorkbenchState>): string {
  if (state.saveStatus === 'saving') return '正在保存…';
  if (state.saveStatus === 'saved') return '已保存为新版本';
  if (state.saveStatus === 'error') return '保存失败';
  return state.editor.dirty ? '有未保存改动' : '内容已同步';
}

function Preview({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/);
  return <article className="humanink-preview">
    {blocks.map((block, index) => {
      if (block.startsWith('### ')) return <h3 key={index}>{block.slice(4)}</h3>;
      if (block.startsWith('## ')) return <h2 key={index}>{block.slice(3)}</h2>;
      if (block.startsWith('# ')) return <h1 key={index}>{block.slice(2)}</h1>;
      return <p key={index}>{block || ' '}</p>;
    })}
  </article>;
}

export function createHumanInkSidebarAction(controller: HumanInkWorkbenchController) {
  return function HumanInkSidebarAction({ wide }: SidebarFooterActionProps) {
    return <button type="button" className={`humanink-sidebar-launch ${wide ? '' : 'is-rail'}`} title="打开 HumanInk" onClick={() => controller.open()}>
      <span className="humanink-launch-mark">墨</span>
      {wide ? <span>HumanInk</span> : null}
    </button>;
  };
}

export function createHumanInkOverlay(controller: HumanInkWorkbenchController) {
  return function HumanInkOverlay() { return <HumanInkWorkbench controller={controller} />; };
}

export function HumanInkWorkbench({ controller }: HumanInkWorkbenchProps) {
  const state = useWorkbenchState(controller);
  const [newTitle, setNewTitle] = useState('');
  if (!state.isOpen) return null;

  const createProject = () => {
    const title = newTitle.trim() || '未命名文章';
    setNewTitle('');
    void controller.createProject(title);
  };
  const trigger = (action: WorkflowAction) => { void controller.triggerAction(action).catch(() => undefined); };
  const exportMarkdown = () => {
    void controller.exportMarkdown().then((markdown) => {
      if (!markdown || typeof document === 'undefined') return;
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.editor.title.trim() || 'humanink'}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };
  const onNewTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') createProject();
  };
  const onTitleChange = (event: ChangeEvent<HTMLInputElement>) => controller.updateEditor({ title: event.target.value });
  const onBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => controller.updateEditor({ body: event.target.value });

  return <div className="humanink-overlay-screen" style={{ pointerEvents: 'auto' }} role="presentation">
    <style>{HUMANINK_THEME}</style>
    <section className="humanink-workbench" role="dialog" aria-modal="true" aria-label="HumanInk 内容工作台">
      <header className="humanink-topbar">
        <div className="humanink-brand"><span className="humanink-brandmark">墨</span><span><strong>HumanInk</strong><small>通用内容工作台</small></span></div>
        <div className="humanink-top-actions">
          <span className="humanink-save-state">{saveLabel(state)}</span>
          <button className="humanink-btn" disabled={!state.activeVersionId} onClick={exportMarkdown}>导出 Markdown</button>
          <button className="humanink-btn humanink-btn-primary" disabled={!state.activeProjectId || state.saveStatus === 'saving'} onClick={() => void controller.save()}>保存新版本</button>
          <button className="humanink-btn humanink-btn-icon humanink-btn-quiet" aria-label="关闭工作台" onClick={() => controller.close()}>×</button>
        </div>
      </header>
      <div className="humanink-layout">
        <aside className="humanink-rail">
          <div className="humanink-section-head"><h2>内容项目</h2><span>{state.projects.length}</span></div>
          <div className="humanink-new-row">
            <input className="humanink-input" value={newTitle} placeholder="输入主题或标题" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={onNewTitleKeyDown} />
            <button className="humanink-btn humanink-btn-primary" title="新建文章" onClick={createProject}>＋</button>
          </div>
          <button className="humanink-btn humanink-btn-quiet" style={{ width: '100%', marginBottom: 14 }} onClick={createProject}>新建文章</button>
          <div className="humanink-list">
            {state.projects.length ? state.projects.map((project) => <button key={project.id} className={`humanink-project ${project.id === state.activeProjectId ? 'is-active' : ''}`} onClick={() => void controller.selectProject(project.id)}>
              <strong>{project.title}</strong><small>{dateLabel(project.updatedAt)}</small>
            </button>) : <div className="humanink-empty">还没有内容项目</div>}
          </div>
          <div className="humanink-section-head"><h2>版本历史</h2><span>{state.versions.length}</span></div>
          <div className="humanink-list">
            {state.versions.length ? state.versions.map((version) => <button key={version.id} className={`humanink-version ${version.id === state.activeVersionId ? 'is-active' : ''}`} onClick={() => void controller.selectVersion(version.id)}>
              <span>{version.label}</span><small>{dateLabel(version.createdAt)}</small>
            </button>) : <div className="humanink-empty">选择项目后查看版本</div>}
          </div>
        </aside>
        <main className="humanink-editor">
          {state.error ? <div className="humanink-error">{state.error}</div> : null}
          <input className="humanink-title-input" value={state.editor.title} placeholder="给这篇内容一个标题" onChange={onTitleChange} />
          <div className="humanink-document-meta">
            <span>{state.activeVersionId ? `当前版本 · ${state.activeVersionId}` : '未选择项目'}</span>
            <div className="humanink-segmented" aria-label="编辑预览切换">
              <button className={state.mode === 'edit' ? 'is-active' : ''} onClick={() => controller.setMode('edit')}>编辑</button>
              <button className={state.mode === 'preview' ? 'is-active' : ''} onClick={() => controller.setMode('preview')}>预览</button>
            </div>
          </div>
          {state.mode === 'edit'
            ? <textarea className="humanink-body" value={state.editor.body} placeholder="从一个真实的细节开始写……" onChange={onBodyChange} />
            : <Preview body={state.editor.body} />}
        </main>
        <aside className="humanink-assistant">
          <div className="humanink-section-head"><h2>创作流程</h2><span>{state.loading ? '同步中' : '就绪'}</span></div>
          <section className="humanink-card"><h3>从想法到正文</h3><p>每个 AI 动作都先创建任务，产出应由主线程保存为新版本，不覆盖人工内容。</p>
            <div className="humanink-workflow-grid">
              {(['titles','brief','outline','draft','humanize'] as const).map((action) => <button key={action} className={`humanink-btn ${action === 'humanize' ? 'humanink-btn-primary' : ''}`} onClick={() => trigger(action)}>{ACTION_LABELS[action]}</button>)}
            </div>
          </section>
          <section className="humanink-card"><h3>发布前复核</h3><p>检查表达、事实、模板化痕迹与阅读节奏，只给建议，不自动发布。</p><button className="humanink-btn" style={{ width: '100%' }} onClick={() => trigger('review')}>开始复核</button></section>
          <section className="humanink-card">
            <div className="humanink-section-head"><h3>任务状态</h3><button className="humanink-btn humanink-btn-quiet" onClick={() => void controller.refreshTasks()}>刷新</button></div>
            {state.tasks.length ? state.tasks.map((task) => <div className="humanink-task" key={task.id}><span className={`humanink-dot is-${task.status}`} /><span>{ACTION_LABELS[task.action]}</span><strong>{TASK_LABELS[task.status]}</strong>{task.status === 'queued' || task.status === 'running' ? <button className="humanink-btn humanink-btn-quiet" onClick={() => void controller.cancelTask(task.id)}>取消</button> : <span />}</div>) : <div className="humanink-empty">动作会在这里显示进度</div>}
          </section>
        </aside>
      </div>
    </section>
  </div>;
}
