import type { FunctionComponent, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { activeHumanInkClients, apply, inject } from '../src/index.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import { HUMANINK_WORKBENCH_TAB_ID, type TabDescriptor } from '../src/better-sidebar-adapter.js';
import type { HumanInkClientContext, SlotRegistration } from '../src/host-adapter.js';

interface TestHarness {
  context: HumanInkClientContext;
  registered: Array<{ meta: SlotRegistration; component: FunctionComponent<any> }>;
  disposeSlot: ReturnType<typeof vi.fn>;
  disposeTab: ReturnType<typeof vi.fn>;
  registerTab: ReturnType<typeof vi.fn>;
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
  const context = {
    slots: {
      inject: (_name: string, setup: () => () => void) => setup(),
      register: (meta: SlotRegistration, component: FunctionComponent<any>) => {
        registered.push({ meta, component });
        return disposeSlot;
      },
    },
    connection: { rpc: { call: vi.fn(async () => ({ ok: true as const, value: [] })) } },
    ...(options.betterSidebar === undefined ? {} : { betterSidebar: options.betterSidebar }),
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
  it('declares core Cordis services; betterSidebar is read via ctx.get to avoid pending fibers', () => {
    expect(inject).toEqual(['slots', 'connection']);
  });

  it('resolves betterSidebar through ctx.get when the runtime exposes it', async () => {
    const harness = createHarness();
    const service = {
      registerTab: harness.registerTab,
      openTab: vi.fn(),
      activateTab: vi.fn(),
    };
    (harness.context as { get?: unknown }).get = (name: string) => name === 'betterSidebar' ? service : undefined;

    apply(harness.context, { api: createHumanInkFakeApi() });

    expect(harness.registerTab).toHaveBeenCalledOnce();
    expect(harness.getDescriptor()).toMatchObject({ id: HUMANINK_WORKBENCH_TAB_ID, title: 'HumanInk' });
    expect(harness.registered).toEqual([]);
    activeHumanInkClients().at(-1)!.dispose();
  });

  it('applies as a Cordis plugin: returns a disposer, never an object', async () => {
    const harness = createHarness();
    const disposer = apply(harness.context, { api: createHumanInkFakeApi() });
    expect(typeof disposer).toBe('function');
    const instance = activeHumanInkClients().at(-1)!;
    expect(instance.controller).toBeDefined();
    await expect(instance.ready).resolves.toBeUndefined();
    disposer();
    expect(activeHumanInkClients()).not.toContain(instance);
  });

  it('registers the native Better Sidebar tab when the service is available', async () => {
    const harness = createHarness();
    (harness.context as { betterSidebar?: unknown }).betterSidebar = {
      registerTab: harness.registerTab,
      openTab: vi.fn(),
      activateTab: vi.fn(),
    };

    const disposer = apply(harness.context, { api: createHumanInkFakeApi() });

    expect(harness.registerTab).toHaveBeenCalledOnce();
    expect(harness.getDescriptor()).toMatchObject({
      id: HUMANINK_WORKBENCH_TAB_ID,
      title: 'HumanInk',
      single: true,
    });
    // The native tab replaces the legacy slot entries entirely.
    expect(harness.registered).toEqual([]);
    disposer();
    expect(harness.disposeTab).toHaveBeenCalledOnce();
  });

  it('falls back to the footer action when Better Sidebar is absent', async () => {
    const harness = createHarness();
    const disposer = apply(harness.context, { api: createHumanInkFakeApi() });

    expect(harness.registerTab).not.toHaveBeenCalled();
    expect(harness.registered.map(({ meta }) => meta.name)).toEqual(['sidebar.footer.action', 'shell.overlay']);
    expect(harness.registered.map(({ meta }) => meta.id)).toEqual(['humanink-open-workbench', 'humanink-workbench-overlay']);
    // The overlay component registers for the explicit footer trigger, but the
    // workbench stays hidden until the user opens it.
    expect(activeHumanInkClients().at(-1)!.controller.getState().isOpen).toBe(false);

    const SidebarAction = harness.registered[0]!.component as FunctionComponent<{ wide: boolean }>;
    const sidebarElement = SidebarAction({ wide: true }) as ReactElement<{ onClick: () => void }>;
    sidebarElement.props.onClick();
    expect(activeHumanInkClients().at(-1)!.controller.getState().isOpen).toBe(true);

    disposer();
    // Both slot registrations (footer action + overlay) share the mock disposer.
    expect(harness.disposeSlot).toHaveBeenCalledTimes(2);
  });

  it('survives a malformed betterSidebar and falls back safely', () => {
    const harness = createHarness({ betterSidebar: { registerTab: 'not-a-function' } });
    const disposer = apply(harness.context, { api: createHumanInkFakeApi() });

    expect(harness.registerTab).not.toHaveBeenCalled();
    expect(harness.registered.map(({ meta }) => meta.name)).toEqual(['sidebar.footer.action', 'shell.overlay']);
    disposer();
  });

  it('dispose then re-apply never duplicates the tab registration (HMR contract)', () => {
    const harness = createHarness();
    (harness.context as { betterSidebar?: unknown }).betterSidebar = {
      registerTab: harness.registerTab,
      openTab: vi.fn(),
      activateTab: vi.fn(),
    };
    const disposeFirst = apply(harness.context, { api: createHumanInkFakeApi() });
    expect(harness.registerTab).toHaveBeenCalledTimes(1);
    disposeFirst();
    expect(harness.disposeTab).toHaveBeenCalledOnce();

    apply(harness.context, { api: createHumanInkFakeApi() });
    expect(harness.registerTab).toHaveBeenCalledTimes(2);
    expect(harness.getDescriptor()?.id).toBe(HUMANINK_WORKBENCH_TAB_ID);
    activeHumanInkClients().at(-1)!.dispose();
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
    apply(context);
    expect(call).toHaveBeenCalledWith('/humanink/workbench', 'listContents', {}, undefined);
    activeHumanInkClients().at(-1)!.dispose();
  });
});
