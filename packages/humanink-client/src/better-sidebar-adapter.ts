import type { ReactNode } from 'react';

export const HUMANINK_WORKBENCH_TAB_ID = 'humanink:workbench';
export const HUMANINK_WORKBENCH_TAB_TITLE = 'HumanInk';

/** Structural subset of dsh-better-sidebar's session scope. */
export interface BetterSidebarSessionScope {
  sessionId: string;
  cwd?: string;
  repoRoot?: string;
}

/**
 * Structural subset of the props delivered to every Better Sidebar tab.
 * Additional host-owned props remain accepted without leaking them into the
 * HumanInk workbench component contract.
 */
export interface BetterSidebarTabComponentProps<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> {
  ctx: TContext;
  scope: TScope;
  visible: boolean;
  [key: string]: unknown;
}

/** Minimal descriptor shape accepted by dsh-better-sidebar 0.17.x. */
export interface TabDescriptor<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> {
  id: string;
  title: string | (() => string);
  single?: boolean;
  component: (props: BetterSidebarTabComponentProps<TContext, TScope>) => ReactNode;
}

export interface BetterSidebarOpenTabSeed {
  type: string;
  title?: string;
  id?: string;
  path?: string;
  url?: string;
  meta?: unknown;
}

/**
 * Consumer-facing subset of ctx.betterSidebar. An installed Better Sidebar
 * service is structurally compatible with this interface.
 */
export interface BetterSidebarService<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> {
  registerTab(descriptor: TabDescriptor<TContext, TScope>): () => void;
  openTab(seed: BetterSidebarOpenTabSeed, scope?: TScope): void;
  activateTab?(tabId: string, scope?: TScope): void;
}

export interface HumanInkWorkbenchTabProps<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> {
  ctx: TContext;
  scope: TScope;
  visible: boolean;
}

export type HumanInkWorkbenchTabComponent<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> = (props: HumanInkWorkbenchTabProps<TContext, TScope>) => ReactNode;

export interface HumanInkBetterSidebarAdapter<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
> {
  readonly descriptor: TabDescriptor<TContext, TScope>;
  open(scope?: TScope): void;
  focus(scope?: TScope): void;
  dispose(): void;
}

const workbenchSeed: BetterSidebarOpenTabSeed = {
  type: HUMANINK_WORKBENCH_TAB_ID,
  id: HUMANINK_WORKBENCH_TAB_ID,
  title: HUMANINK_WORKBENCH_TAB_TITLE,
};

/**
 * Registers HumanInk as a native Better Sidebar tab without changing the
 * existing overlay entry. The returned handle lets the caller open or focus
 * the tab and dispose the registration during Cordis/HMR teardown.
 */
export function registerHumanInkBetterSidebarAdapter<
  TContext = unknown,
  TScope extends BetterSidebarSessionScope = BetterSidebarSessionScope,
>(
  service: BetterSidebarService<TContext, TScope>,
  component: HumanInkWorkbenchTabComponent<TContext, TScope>,
): HumanInkBetterSidebarAdapter<TContext, TScope> {
  const descriptor: TabDescriptor<TContext, TScope> = {
    id: HUMANINK_WORKBENCH_TAB_ID,
    title: HUMANINK_WORKBENCH_TAB_TITLE,
    single: true,
    component: ({ ctx, scope, visible }) => component({ ctx, scope, visible }),
  };
  const unregister = service.registerTab(descriptor);
  let disposed = false;

  const open = (scope?: TScope) => {
    service.openTab({ ...workbenchSeed }, scope);
  };

  return {
    descriptor,
    open,
    focus(scope?: TScope) {
      if (service.activateTab) {
        service.activateTab(HUMANINK_WORKBENCH_TAB_ID, scope);
        return;
      }
      open(scope);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unregister();
    },
  };
}