import { describe, expect, it } from 'vitest';
import { createHumanInkPersistence, DEFAULT_HUMANINK_UI_STATE } from '../src/persistence.js';

describe('HumanInk UI persistence', () => {
  it('persists only selection, filter, and panel width', () => {
    const storage = new Map<string, string>();
    const persistence = createHumanInkPersistence({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) });
    persistence.save({ selectedContentId: 'project-1', query: 'AI', sidebarWidth: 360, body: 'must not persist' } as never);
    expect(JSON.parse(storage.get('humanink.ui-state')!)).toEqual({ selectedContentId: 'project-1', query: 'AI', sidebarWidth: 360 });
    expect(storage.get('humanink.ui-state')).not.toContain('must not persist');
  });

  it('recovers defaults from malformed or out-of-range state', () => {
    const storage = new Map([['humanink.ui-state', '{"selectedContentId":42,"query":true,"sidebarWidth":9999,"body":"secret"}']]);
    const persistence = createHumanInkPersistence({ getItem: (key) => storage.get(key) ?? null, setItem: () => undefined, removeItem: () => undefined });
    expect(persistence.load()).toEqual(DEFAULT_HUMANINK_UI_STATE);
  });
});
