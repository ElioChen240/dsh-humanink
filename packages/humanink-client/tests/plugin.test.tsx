import type { FunctionComponent, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { apply, inject } from '../src/index.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import type { HumanInkClientContext, SlotRegistration } from '../src/host-adapter.js';

describe('DeepSeek Harness React client entry', () => {
  it('declares the exact Cordis client services', () => {
    expect(inject).toEqual(['slots', 'connection']);
  });

  it('registers React components in sidebar.footer.action and shell.overlay', async () => {
    const registrations: Array<{ meta: SlotRegistration; component: FunctionComponent<any> }> = [];
    const disposers = [vi.fn(), vi.fn()];
    const context = {
      slots: {
        inject: (_name: string, setup: () => () => void) => setup(),
        register: (meta: SlotRegistration, component: FunctionComponent<any>) => {
          registrations.push({ meta, component });
          return disposers[registrations.length - 1]!;
        },
      },
      connection: { rpc: { call: vi.fn() } },
    } as unknown as HumanInkClientContext;
    const plugin = apply(context, { api: createHumanInkFakeApi() });
    await plugin.ready;
    expect(registrations.map(({ meta }) => meta.name)).toEqual(['sidebar.footer.action', 'shell.overlay']);
    expect(registrations.map(({ meta }) => meta.id)).toEqual(['humanink-open-workbench', 'humanink-workbench-overlay']);
    const SidebarAction = registrations[0]!.component as FunctionComponent<{ wide: boolean }>;
    const sidebarElement = SidebarAction({ wide: true }) as ReactElement<{ onClick: () => void }>;
    sidebarElement.props.onClick();
    expect(plugin.controller.getState().isOpen).toBe(true);
    plugin.dispose();
    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(disposers[1]).toHaveBeenCalledOnce();
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
