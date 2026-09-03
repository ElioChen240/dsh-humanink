import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayStore } from '../src/workbench/overlay-store.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('OverlayStore', () => {
  it('serializes concurrent updates without losing writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-overlay-')); roots.push(root);
    const store = new OverlayStore(root);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.update((state) => ({ ...state, items: { ...state.items, [`item-${index}`]: { stage: 'draft' } } }))));
    const state = await store.read();
    expect(Object.keys(state.items)).toHaveLength(20);
    expect(state.revision).toBe(20);
    expect(existsSync(join(root, 'overlay.json.tmp'))).toBe(false);
  });

  it('recovers to an empty state when persisted data is malformed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-overlay-bad-')); roots.push(root);
    const store = new OverlayStore(root);
    writeFileSync(join(root, 'overlay.json'), '{broken', 'utf8');
    await expect(store.read()).resolves.toEqual({ schemaVersion: 1, revision: 0, items: {} });
  });
});