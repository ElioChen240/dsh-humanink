import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HumanInkWorkbenchController } from '../src/controller.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import type { HumanInkClientContext, SlotRegistration } from '../src/host-adapter.js';
import { ContentInspector } from '../src/inspector/ContentInspector.js';
import { HumanInkSidebarRoot, registerHumanInkNativeShell } from '../src/sidebar/HumanInkSidebarRoot.js';

function harness() {
  const registered: Array<{ meta: SlotRegistration; component: FunctionComponent<any>; dispose: ReturnType<typeof vi.fn> }> = [];
  const context = {
    slots: {
      inject: (_name: string, setup: () => () => void) => setup(),
      register: (meta: SlotRegistration, component: FunctionComponent<any>) => {
        const dispose = vi.fn();
        registered.push({ meta, component, dispose });
        return dispose;
      },
    },
    connection: { rpc: { call: vi.fn() } },
  } as unknown as HumanInkClientContext;
  return { context, registered };
}

describe('HumanInk native shell', () => {
  it('keeps the official footer entry and mounts an inspector only after content is selected', async () => {
    const { context, registered } = harness();
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    const dispose = registerHumanInkNativeShell(context, controller, { onOpen: () => controller.open() });

    expect(registered.map((item) => item.meta.name)).toEqual(['sidebar.footer.action']);
    await controller.initialize();
    expect(registered.map((item) => item.meta.name)).toEqual(['sidebar.footer.action', 'shell.overlay']);
    expect(registered[1]!.meta.id).toBe('humanink-content-inspector:project-tea');

    await controller.selectProject('project-night');
    expect(registered[1]!.dispose).toHaveBeenCalledOnce();
    expect(registered.at(-1)!.meta.id).toBe('humanink-content-inspector:project-night');

    dispose();
    expect(registered[0]!.dispose).toHaveBeenCalledOnce();
    expect(registered.at(-1)!.dispose).toHaveBeenCalledOnce();
  });

  it('renders capability degradation without disabling content navigation', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();
    const html = renderToStaticMarkup(createElement(HumanInkSidebarRoot, {
      controller,
      visible: true,
      capabilities: { core: { state: 'ready' }, storage: { state: 'ready' }, contentLibrary: { state: 'ready' }, llm: { state: 'missing', action: '配置 DSH 模型' }, remote: { state: 'ready' }, credentials: { state: 'unsupported' } },
    }));
    expect(html).toContain('HumanInk');
    expect(html).toContain('配置 DSH 模型');
    expect(html).toContain('project-tea');
  });

  it('keeps the inspector hidden until explicitly opened', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();
    let html = renderToStaticMarkup(createElement(ContentInspector, { controller, contentId: 'project-tea' }));
    expect(html).toBe('');
    controller.open();
    html = renderToStaticMarkup(createElement(ContentInspector, { controller, contentId: 'project-tea' }));
    expect(html).toContain('humanink-inspector');
    expect(html).toContain('project-tea');
  });
});
