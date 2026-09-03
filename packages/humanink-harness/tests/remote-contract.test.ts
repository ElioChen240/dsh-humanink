import { describe, expect, it, vi } from 'vitest';
import { HUMANINK_WORKBENCH_INVOCATIONS } from '../src/remote/contract.js';
import { WORKBENCH_REMOTE_CHANNEL, createHumanInkWorkbenchRemoteHandler, registerHumanInkWorkbenchRemote } from '../src/remote/host.js';
import type { HumanInkWorkbenchRemoteService } from '../src/remote/host.js';

function service(overrides: Partial<HumanInkWorkbenchRemoteService> = {}): HumanInkWorkbenchRemoteService {
  return {
    listContents: vi.fn(async () => []), getContent: vi.fn(async () => null), createContent: vi.fn(async () => ({ project: { id: 'project-1' }, sourceVersion: { id: 'version-1' } } as never)), saveVersion: vi.fn(async () => ({ id: 'version-2' } as never)), startAction: vi.fn(async () => ({ id: 'task-1' } as never)), getTask: vi.fn(async () => null), cancelTask: vi.fn(async () => true), getSettings: vi.fn(async () => ({ libraryRoot: 'C:/content', writingProfile: '' })), setLibraryRoot: vi.fn(async () => ({ libraryRoot: 'C:/new', writingProfile: '' })), setWritingProfile: vi.fn(async () => ({ libraryRoot: 'C:/content', writingProfile: '自然' })), getCapabilities: vi.fn(async () => ({ core: { state: 'ready' as const }, storage: { state: 'ready' as const }, contentLibrary: { state: 'ready' as const }, llm: { state: 'ready' as const }, remote: { state: 'ready' as const }, credentials: { state: 'unsupported' as const } })), getRevision: vi.fn(async () => 1),
    ...overrides,
  };
}

const signal = new AbortController().signal;

describe('HumanInk typed workbench remote', () => {
  it('publishes the complete MVP invocation contract', () => {
    expect(HUMANINK_WORKBENCH_INVOCATIONS).toEqual([
      'listContents', 'getContent', 'createContent', 'saveVersion', 'startAction', 'getTask', 'cancelTask', 'getCapabilities', 'getRevision', 'getSettings', 'setLibraryRoot', 'setWritingProfile',
    ]);
  });
  it('validates and dispatches named invocations with AbortSignal', async () => {
    const listContents = vi.fn(async () => []);
    const handler = createHumanInkWorkbenchRemoteHandler(service({ listContents }));
    await expect(handler('listContents', { query: 'AI' }, signal)).resolves.toEqual({ ok: true, value: [] });
    expect(listContents).toHaveBeenCalledWith({ query: 'AI' }, signal);
    await expect(handler('createContent', { title: '   ' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('maps missing content and internal failures to stable sanitized errors', async () => {
    const handler = createHumanInkWorkbenchRemoteHandler(service({
      getContent: vi.fn(async () => null),
      listContents: vi.fn(async () => { throw new Error('Authorization: Bearer secret-token'); }),
    }));
    await expect(handler('getContent', { contentId: 'missing' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND', retryable: false } });
    const failed = await handler('listContents', {}, signal);
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL', retryable: false } });
    expect(JSON.stringify(failed)).not.toContain('secret-token');
  });

  it('honors cancellation before invoking the service', async () => {
    const listContents = vi.fn(async () => []);
    const handler = createHumanInkWorkbenchRemoteHandler(service({ listContents }));
    const controller = new AbortController(); controller.abort();
    await expect(handler('listContents', {}, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'REQUEST_CANCELLED' } });
    expect(listContents).not.toHaveBeenCalled();
  });

  it('registers a dedicated channel and returns its disposer', () => {
    const dispose = vi.fn(async () => undefined);
    const handle = vi.fn(() => dispose);
    expect(registerHumanInkWorkbenchRemote({ rpc: { handle } }, service())).toBe(dispose);
    expect(handle).toHaveBeenCalledWith(WORKBENCH_REMOTE_CHANNEL, expect.any(Function));
  });
});