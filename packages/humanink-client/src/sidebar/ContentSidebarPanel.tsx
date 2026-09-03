import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ProjectSummary } from '../api.js';
import type { HumanInkWorkbenchController, WorkbenchState } from '../controller.js';
import { DEFAULT_HUMANINK_UI_STATE, type HumanInkUiState } from '../persistence.js';

export interface ContentSidebarPanelProps {
  controller: HumanInkWorkbenchController;
  uiState?: HumanInkUiState;
  onUiStateChange?: (state: HumanInkUiState) => void;
}

function useWorkbenchState(controller: HumanInkWorkbenchController): Readonly<WorkbenchState> {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
}

export function ContentSidebarPanel({ controller, uiState = DEFAULT_HUMANINK_UI_STATE, onUiStateChange }: ContentSidebarPanelProps) {
  const state = useWorkbenchState(controller);
  const [query, setQuery] = useState(uiState.query);
  const projects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return state.projects;
    return state.projects.filter((project) => project.title.toLocaleLowerCase().includes(needle));
  }, [query, state.projects]);

  const select = (project: ProjectSummary) => {
    onUiStateChange?.({ ...uiState, query, selectedContentId: project.id });
    void controller.selectProject(project.id);
  };

  return <section className="humanink-content-sidebar" style={{ width: uiState.sidebarWidth }}>
    <label>
      <span>搜索内容</span>
      <input
        aria-label="搜索内容"
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          onUiStateChange?.({ ...uiState, query: next, ...(state.activeProjectId ? { selectedContentId: state.activeProjectId } : {}) });
        }}
      />
    </label>
    <div className="humanink-content-sidebar__list">
      {projects.map((project) => <button
        type="button"
        key={project.id}
        data-content-id={project.id}
        aria-current={project.id === state.activeProjectId ? 'page' : undefined}
        onClick={() => select(project)}
      >
        <strong>{project.title}</strong>
        <small>{project.updatedAt}</small>
      </button>)}
      {projects.length === 0 ? <p>没有匹配的内容</p> : null}
    </div>
  </section>;
}
