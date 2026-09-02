import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { WorkflowAction } from './api.js';
import type { HumanInkWorkbenchController, WorkbenchState } from './controller.js';
import { HUMANINK_NATIVE_THEME } from './native-theme.js';

export interface HumanInkNativeWorkbenchProps {
  controller: HumanInkWorkbenchController;
  sessionId: string;
  cwd?: string;
  visible: boolean;
}

const ACTIONS: ReadonlyArray<{ action: WorkflowAction; label: string; prerequisite?: string }> = [
  { action: 'titles', label: '标题' },
  { action: 'brief', label: '简报' },
  { action: 'outline', label: '大纲', prerequisite: '先生成简报' },
  { action: 'draft', label: '初稿', prerequisite: '先生成大纲' },
  { action: 'humanize', label: '人味化' },
  { action: 'review', label: '复核' },
];

function useWorkbenchState(controller: HumanInkWorkbenchController): Readonly<WorkbenchState> {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
}

function workflowAvailable(state: Readonly<WorkbenchState>, action: WorkflowAction): boolean {
  if (!state.activeVersionId || state.loading) return false;
  if (action === 'outline') return state.versions.some((version) => version.kind === 'brief');
  if (action === 'draft') {
    return state.versions.some((version) => version.kind === 'brief')
      && state.versions.some((version) => version.kind === 'outline');
  }
  return true;
}

function statusLabel(status: string): string {
  return ({ queued: '排队', running: '生成中', succeeded: '完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] ?? status;
}

function shortSession(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export function HumanInkNativeWorkbench({ controller, sessionId, cwd, visible }: HumanInkNativeWorkbenchProps) {
  const state = useWorkbenchState(controller);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => {
      if (controller.getState().tasks.some((task) => task.status === 'queued' || task.status === 'running')) {
        void controller.refreshTasksAndProject();
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [controller, visible]);

  const createProject = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await controller.createProject(title);
    setNewTitle('');
  };

  const onNewTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void createProject();
  };

  const run = async (action: WorkflowAction) => {
    try {
      await controller.triggerAction(action);
    } catch {
      // Controller exposes the safe failure message in state.error.
    }
  };

  const downloadMarkdown = async () => {
    const markdown = await controller.exportMarkdown();
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.editor.title.trim() || 'humanink'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="humanink-native">
    <style>{HUMANINK_NATIVE_THEME}</style>
    <header className="humanink-native__header">
      <div>
        <strong>HumanInk</strong>
        <span>内容助手</span>
      </div>
      <span className="humanink-native__session" title={cwd ?? sessionId}>会话 {shortSession(sessionId)}</span>
    </header>

    <div className="humanink-native__create">
      <input value={newTitle} placeholder="输入主题，新建内容" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={onNewTitleKeyDown} />
      <button type="button" onClick={() => void createProject()}>新建</button>
    </div>

    {state.projects.length > 0 ? <select className="humanink-native__project" value={state.activeProjectId ?? ''} onChange={(event) => void controller.selectProject(event.target.value)}>
      {state.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
    </select> : <div className="humanink-native__empty">先创建一个内容项目</div>}

    {state.error ? <div className="humanink-native__error"><strong>操作未完成</strong><span>{state.error}</span></div> : null}

    <section className="humanink-native__workflow" aria-label="创作流程">
      {ACTIONS.map(({ action, label, prerequisite }) => {
        const enabled = workflowAvailable(state, action);
        return <button type="button" key={action} disabled={!enabled} title={enabled ? label : prerequisite ?? '请先选择内容版本'} onClick={() => void run(action)}>{label}</button>;
      })}
    </section>

    <section className="humanink-native__editor">
      <input className="humanink-native__title" value={state.editor.title} placeholder="标题" disabled={!state.activeVersionId} onChange={(event) => controller.updateEditor({ title: event.target.value })} />
      <textarea value={state.editor.body} placeholder="正文会在这里生成，也可以直接编辑…" disabled={!state.activeVersionId} onChange={(event) => controller.updateEditor({ body: event.target.value })} />
    </section>

    <div className="humanink-native__actions">
      <button type="button" disabled={!state.editor.dirty || state.saveStatus === 'saving'} onClick={() => void controller.save('人工编辑')}>{state.saveStatus === 'saving' ? '保存中…' : state.saveStatus === 'saved' ? '已保存' : '保存版本'}</button>
      <button type="button" disabled={!state.activeVersionId} onClick={() => void downloadMarkdown()}>导出</button>
      <button type="button" onClick={() => void controller.refreshTasksAndProject()}>刷新</button>
    </div>

    <section className="humanink-native__tasks">
      <div className="humanink-native__section-title"><strong>任务</strong><span>{state.tasks.length}</span></div>
      {state.tasks.length === 0 ? <div className="humanink-native__empty">生成任务会显示在这里</div> : state.tasks.slice(0, 6).map((task) => <div className={`humanink-native__task is-${task.status}`} key={task.id}>
        <span>{ACTIONS.find((item) => item.action === task.action)?.label ?? task.action}</span>
        <strong>{statusLabel(task.status)}</strong>
        {task.message ? <small title={task.message}>{task.message}</small> : null}
      </div>)}
    </section>

    <details className="humanink-native__versions">
      <summary>版本历史 · {state.versions.length}</summary>
      {state.versions.map((version) => <button type="button" className={version.id === state.activeVersionId ? 'is-active' : ''} key={version.id} onClick={() => void controller.selectVersion(version.id)}><span>{version.label}</span><small>{new Date(version.createdAt).toLocaleString()}</small></button>)}
    </details>
  </div>;
}
