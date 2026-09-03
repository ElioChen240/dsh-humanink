import { describe, expect, it, vi } from 'vitest';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import { createContentMention, formatContentMention, searchContentMentions } from '../src/content-trigger.js';
import { createHumanInkContentSelection } from '../src/content-selection.js';
import { createHumanInkPersistence } from '../src/persistence.js';

describe('HumanInk content mentions', () => {
  it('searches remote content and returns structured mentions without body text', async () => {
    const mentions = await searchContentMentions(createHumanInkFakeApi(), '茶');
    expect(mentions[0]).toEqual({ type: 'humanink-content', contentId: 'project-tea', title: expect.any(String), versionId: 'tea-v2' });
    expect(mentions[0]).not.toHaveProperty('body');
  });

  it('formats and parses a stable @文章 reference', () => {
    const mention = createContentMention({ contentId: 'project-tea', title: '关于喝茶', versionId: 'tea-v2' });
    expect(formatContentMention(mention)).toBe('@文章：关于喝茶');
  });

  it('restores selection from persistence and notifies changes without persisting正文', () => {
    let stored = JSON.stringify({ selectedContentId: 'project-tea', query: '', sidebarWidth: 320 });
    const storage = { value: stored, getItem: vi.fn(() => stored), setItem: vi.fn((_key: string, value: string) => { stored = value; }), removeItem: vi.fn() };
    const persistence = createHumanInkPersistence(storage);
    const selection = createHumanInkContentSelection(persistence);
    const listener = vi.fn();
    selection.subscribe(listener);
    expect(selection.get()).toBe('project-tea');
    selection.select({ type: 'humanink-content', contentId: 'project-night', title: '深夜便利店', versionId: 'night-v1' });
    expect(selection.get()).toBe('project-night');
    expect(listener).toHaveBeenCalledWith('project-night');
    expect(stored).not.toContain('body');
  });
});
