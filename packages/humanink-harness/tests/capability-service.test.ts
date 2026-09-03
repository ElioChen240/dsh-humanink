import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityService } from '../src/capabilities/capability-service.js';
import { HumanInkWorkbenchService } from '../src/application/workbench-service.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function application() {
  return {
    listProjects: vi.fn(async () => []), getProject: vi.fn(async () => null), listVersions: vi.fn(async () => []), getVersion: vi.fn(async () => null),
    createProject: vi.fn(), createDerivedVersion: vi.fn(), generateTitles: vi.fn(), generateBrief: vi.fn(), generateOutline: vi.fn(), generateDraft: vi.fn(), humanizeContent: vi.fn(), reviewContent: vi.fn(), getTask: vi.fn(() => null),
  };
}

describe('CapabilityService', () => {
  it('reports ready capabilities from live read-only probes', async () => {
    const libraryRoot = mkdtempSync(join(tmpdir(), 'humanink-capabilities-')); roots.push(libraryRoot);
    const service = new CapabilityService({ libraryRoot, llm: () => true, remote: () => true, credentials: () => true });
    await expect(service.inspect()).resolves.toEqual({
      core: { state: 'ready' }, storage: { state: 'ready' }, contentLibrary: { state: 'ready' }, llm: { state: 'ready' }, remote: { state: 'ready' }, credentials: { state: 'ready' },
    });
  });

  it('reports missing or unsupported optional capabilities without writing configuration', async () => {
    const missing = join(tmpdir(), `humanink-missing-${Date.now()}`);
    const service = new CapabilityService({ libraryRoot: missing, llm: () => false, remote: () => false });
    await expect(service.inspect()).resolves.toMatchObject({
      contentLibrary: { state: 'missing', action: 'Choose an existing HumanInk content directory.' },
      llm: { state: 'missing' }, remote: { state: 'missing' }, credentials: { state: 'unsupported' },
    });
  });

  it('isolates probe failures as an error state', async () => {
    const libraryRoot = mkdtempSync(join(tmpdir(), 'humanink-capabilities-error-')); roots.push(libraryRoot);
    const service = new CapabilityService({ libraryRoot, llm: () => { throw new Error('provider offline'); }, remote: () => true });
    await expect(service.inspect()).resolves.toMatchObject({ llm: { state: 'error', reason: 'provider offline' }, remote: { state: 'ready' } });
  });

  it('is the capability source used by HumanInkWorkbenchService', async () => {
    const inspect = vi.fn(async () => ({ core: { state: 'ready' as const }, storage: { state: 'ready' as const }, contentLibrary: { state: 'missing' as const }, llm: { state: 'ready' as const }, remote: { state: 'missing' as const }, credentials: { state: 'unsupported' as const } }));
    const service = new HumanInkWorkbenchService({ application: application(), capabilityService: { inspect } });
    await expect(service.getCapabilities()).resolves.toMatchObject({ contentLibrary: { state: 'missing' } });
    expect(inspect).toHaveBeenCalledOnce();
  });
});