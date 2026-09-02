import { describe, expect, it, vi } from 'vitest';
import {
  HUMANINK_WORKBENCH_TAB_ID,
  registerHumanInkBetterSidebarAdapter,
  type BetterSidebarService,
  type TabDescriptor,
} from '../src/better-sidebar-adapter.js';

interface TestContext {
  source: 'dsh';
}

interface TestScope {
  sessionId: string;
  cwd?: string;
}

function createService(options: { activate?: boolean } = {}) {
  let descriptor: TabDescriptor<TestContext, TestScope> | undefined;
  const disposeRegistration = vi.fn();
  const registerTab = vi.fn((next: TabDescriptor<TestContext, TestScope>) => {
    descriptor = next;
    return disposeRegistration;
  });
  const openTab = vi.fn();
  const activateTab = options.activate === false ? undefined : vi.fn();
  const service: BetterSidebarService<TestContext, TestScope> = {
    registerTab,
    openTab,
    ...(activateTab ? { activateTab } : {}),
  };

  return {
    service,
    registerTab,
    openTab,
    activateTab,
    disposeRegistration,
    getDescriptor: () => descriptor,
  };
}

describe('HumanInk Better Sidebar adapter', () => {
  it('registers one single-instance workbench tab and narrows component props', () => {
    const sidebar = createService();
    const render = vi.fn(({ ctx, scope, visible }) => `${ctx.source}:${scope.sessionId}:${visible}`);

    const adapter = registerHumanInkBetterSidebarAdapter(sidebar.service, render);
    const descriptor = sidebar.getDescriptor();

    expect(sidebar.registerTab).toHaveBeenCalledOnce();
    expect(descriptor).toMatchObject({
      id: HUMANINK_WORKBENCH_TAB_ID,
      title: 'HumanInk',
      single: true,
    });
    expect(descriptor?.component({
      ctx: { source: 'dsh' },
      scope: { sessionId: 'session-1', cwd: 'E:/work/HumanInk' },
      visible: true,
      store: { ignored: true },
      tab: { ignored: true },
    })).toBe('dsh:session-1:true');
    expect(render).toHaveBeenCalledWith({
      ctx: { source: 'dsh' },
      scope: { sessionId: 'session-1', cwd: 'E:/work/HumanInk' },
      visible: true,
    });
    expect(adapter.descriptor).toBe(descriptor);
  });

  it('opens the HumanInk workbench in a target session scope', () => {
    const sidebar = createService();
    const adapter = registerHumanInkBetterSidebarAdapter(sidebar.service, () => null);
    const scope = { sessionId: 'session-2', cwd: 'E:/content' };

    adapter.open(scope);

    expect(sidebar.openTab).toHaveBeenCalledWith({
      type: HUMANINK_WORKBENCH_TAB_ID,
      id: HUMANINK_WORKBENCH_TAB_ID,
      title: 'HumanInk',
    }, scope);
  });

  it('focuses an existing tab through activateTab when supported', () => {
    const sidebar = createService();
    const adapter = registerHumanInkBetterSidebarAdapter(sidebar.service, () => null);
    const scope = { sessionId: 'session-3' };

    adapter.focus(scope);

    expect(sidebar.activateTab).toHaveBeenCalledWith(HUMANINK_WORKBENCH_TAB_ID, scope);
    expect(sidebar.openTab).not.toHaveBeenCalled();
  });

  it('falls back to single-instance open when activateTab is unavailable', () => {
    const sidebar = createService({ activate: false });
    const adapter = registerHumanInkBetterSidebarAdapter(sidebar.service, () => null);

    adapter.focus();

    expect(sidebar.openTab).toHaveBeenCalledWith({
      type: HUMANINK_WORKBENCH_TAB_ID,
      id: HUMANINK_WORKBENCH_TAB_ID,
      title: 'HumanInk',
    }, undefined);
  });

  it('disposes the tab registration once', () => {
    const sidebar = createService();
    const adapter = registerHumanInkBetterSidebarAdapter(sidebar.service, () => null);

    adapter.dispose();
    adapter.dispose();

    expect(sidebar.disposeRegistration).toHaveBeenCalledOnce();
  });
});
