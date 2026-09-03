import type { ContentMention } from './content-trigger.js';
import type { HumanInkPersistence, HumanInkUiState } from './persistence.js';

export interface ContentSelectionStore {
  get(): string | undefined;
  subscribe(listener: (contentId: string | undefined) => void): () => void;
  select(mention: ContentMention): void;
  clear(): void;
}

export function createHumanInkContentSelection(persistence: Pick<HumanInkPersistence, 'load' | 'save'>): ContentSelectionStore {
  let selectedContentId = persistence.load().selectedContentId;
  const listeners = new Set<(contentId: string | undefined) => void>();
  const persist = () => {
    const state = persistence.load();
    const next: HumanInkUiState = selectedContentId
      ? { ...state, selectedContentId }
      : { query: state.query, sidebarWidth: state.sidebarWidth };
    persistence.save(next);
  };
  const notify = () => listeners.forEach((listener) => listener(selectedContentId));
  return {
    get: () => selectedContentId,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    select(mention) { selectedContentId = mention.contentId; persist(); notify(); },
    clear() { selectedContentId = undefined; persist(); notify(); },
  };
}
