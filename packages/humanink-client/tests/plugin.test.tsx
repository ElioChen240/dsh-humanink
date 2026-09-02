import type { FunctionComponent, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { apply, inject } from '../src/index.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import { HUMANINK_WORKBENCH_TAB_ID, type TabDescriptor } from '../src/better-sidebar-adapter.js';
import type { HumanInkClientContext, SlotRegistration } from '../src/host-adapter.js';

interface TestHarness {
  context: HumanInkClientContext;
  registered: Array<{ meta: SlotRegistration; component: FunctionComponent<any> }>;
  disposeSlot: ReturnType<typeof vi.fn>;
  registerTab: ReturnType<typeof vi.fn>;
  disposeTab: ReturnType<typeof vi.fn>;
  getDescriptor: () => TabDescriptor | undefined;
}

function createHarness(options: { betterSidebar?: unknown } = {}): TestHarness {
  const registered: Array<{ meta: SlotRegistration; component: FunctionComponent<any> }> = [];
  const disposeSlot = vi.fn();
  const disposeTab = vi.fn();
  let descriptor: TabDescriptor | undefined;
  const registerTab = vi.fn((next: TabDescriptor) => {
    descriptor = next;
    return disposeTab;
  });
  const betterSidebar = options.betterSidebar === undefined
    ? { registerTab, openTab: vi.fn(), activateTab: vi.fn() }
    : options.betterSidebar;
  const context = {
    effect: vi.fn((body: () => () => void) => body()),
    slots: {
      inject: (_name: string, setup: () => () => void) => setup(),
      register: (meta: SlotRegistration, component: FunctionComponent<any>) => {
        registered.push({ meta, component });
        return disposeSlot;
      },
    },
    connection: { rpc: { call: vi.fn(async () => ({ ok: true as const, value: [] })) } },
    betterSidebar,
  } as unknown as HumanInkClientContext;
  return {
    context,
    registered,
    disposeSlot,
    disposeTab,
    registerTab,
    getDescriptor: () => descriptor,
  };
}

describe('DeepSeek Harness React client entry', () => {
  it('declares the exact Cordis client services including optional betterSidebar', () => {
    expect(inject).toEqual(['slots', 'connection', 'betterSidebar']);
  });

  it('registers only the native Better Sidebar tab when the service is available', async () => {
    const harness = createHarness({});
    const plugin = apply(harness.context, { api: createHumanInkFakeApi() });
    await plugin.ready;

    expect(harness.registerTab).toHaveBeenCalledOnce();
    expect(harness.getDescriptor()).toMatchObject({
      id: HUMANINK_WORKBENCH_TAB_ID,
      title: 'HumanInk',
      single: true,
    });
    expect(typeof harness.getDescriptor()?.component).toBe('function');
    // The native tab replaces the legacy slot entries entirely.
    expect(harness.registered.map(({ meta }) => meta.name)).toEqual([]);
    expect(harness.disposeSlot).not.toHaveBeenCalled();

    plugin.dispose();
    expect(harness.disposeTab).toHaveBeenCalledOnce();
  });

  it('does not register the full-screen overlay even in the legacy fallback', async () => {
    const harness = createHarness({ betterSidebar: null });
    const plugin = apply(harness.context, { api: createHumanInkFakeApi() });
    await plugin.ready;

    expect(harness.registerTab).not.toHaveBeenCalled();
    expect(harness.registered.map(({ meta }) => meta.name)).toEqual(['sidebar.footer.action']);
    expect(harness.registered.map(({ meta }) => meta.id)).toEqual(['humanink-open-workbench']);

    const SidebarAction = harness.registered[0]!.component as FunctionComponent<{ wide: boolean }>;
    const sidebarElement = SidebarAction({ wide: true }) as ReactElement<{ onClick: () => void }>;
    sidebarElement.props.onClick();
    expect(plugin.controller.getState().isOpen).toBe(true);

    plugin.dispose();
    expect(harness.disposeSlot).toHaveBeenCalledOnce();
    expect(harness.disposeTab).not.toHaveBeenCalled();
  });

  it('falls back to the legacy slot when betterSidebar is malformed', async () => {
    const harness = createHarness({ betterSidebar: { registerTab: 'not-a-function' } });
    const plugin = apply(harness.context, { api: createHumanInkFakeApi() });
    await plugin.ready;

    expect(harness.registerTab).not.toHaveBeenCalled();
    expect(harness.registered).toHaveLength(1);
    plugin.dispose();
  });

  it('dispose then re-apply never duplicates the tab registration (HMR contract)', async () => {
    const harness = createHarness({});
    const first = apply(harness.context, { api: createHumanInkFakeApi() });
    await first.ready;
    first.dispose();
    expect(harness.disposeTab).toHaveBeenCalledOnce();

    const second = apply(harness.context, { api: createHumanInkFakeApi() });
    await second.ready;
    expect(harness.registerTab).toHaveBeenCalledTimes(2);
    expect(harness.getDescriptor()?.id).toBe(HUMANINK_WORKBENCH_TAB_ID);
    second.dispose();
    expect(harness.disposeTab).toHaveBeenCalledTimes(2);
  });

  it('uses Connection RPC as the default API implementation', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: [] }));
    const context = {
      slots: {
        inject: (_name: string, setup: () => () => void) => setup(),
        register: () => vi.fn(),
      },
      connection: { rpc: { call } },
    } as unknown as HumanInkClientContext;
    const plugin = apply(context);
    await plugin.ready;
    expect(call).toHaveBeenCalledWith('/humanink', 'projects/list', {}, undefined);
    plugin.dispose();
  });
});
