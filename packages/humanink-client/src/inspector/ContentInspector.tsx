import { useSyncExternalStore } from 'react';
import type { WorkflowAction } from '../api.js';
import type { HumanInkWorkbenchController, WorkbenchState } from '../controller.js';

export interface ContentInspectorProps {
  controller: HumanInkWorkbenchController;
  contentId: string;
}

function useWorkbenchState(controller: HumanInkWorkbenchController): Readonly<WorkbenchState> {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
}

const actions: ReadonlyArray<{ action: WorkflowAction; label: string }> = [
  { action: 'titles', label: '标题' },
  { action: 'draft', label: '写作' },
  { action: 'humanize', label: '人味化' },
  { action: 'review', label: '复核' },
];

export function ContentInspector({ controller, contentId }: ContentInspectorProps) {
  const state = useWorkbenchState(controller);
  if (!state.isOpen || state.activeProjectId !== contentId) return null;
  return <aside className="humanink-inspector" data-content-id={contentId} aria-label="HumanInk 内容检查器">
    <header>
      <div><small>HumanInk 内容</small><strong>{state.editor.title || contentId}</strong></div>
      <button type="button" onClick={() => controller.close()} aria-label="关闭 HumanInk">×</button>
    </header>
    {state.error ? <p role="alert">{state.error}</p> : null}
    <textarea
      aria-label="正文"
      value={state.editor.body}
      onChange={(event) => controller.updateEditor({ body: event.target.value })}
    />
    <div className="humanink-inspector__actions">
      <button type="button" disabled={!state.editor.dirty} onClick={() => void controller.save()}>保存版本</button>
      {actions.map(({ action, label }) => <button
        type="button"
        key={action}
        disabled={!state.activeVersionId || state.loading}
        onClick={() => void controller.triggerAction(action).catch(() => undefined)}
      >{label}</button>)}
    </div>
  </aside>;
}
