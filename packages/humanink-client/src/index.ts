import type { HumanInkClientApi } from './api.js';
import { createElement } from 'react';
import { HumanInkWorkbenchController } from './controller.js';
import { registerHumanInkClientSlots, resolveHumanInkBetterSidebar, type HumanInkClientContext } from './host-adapter.js';
import { registerHumanInkBetterSidebarAdapter, type BetterSidebarService, type HumanInkWorkbenchTabComponent } from './better-sidebar-adapter.js';
import { HumanInkSidebarRoot, registerHumanInkNativeShell } from './sidebar/HumanInkSidebarRoot.js';
import { createHumanInkWorkbenchRemoteClient } from './remote/client.js';
import { createHumanInkContentSelection, type ContentSelectionStore } from './content-selection.js';
import { createHumanInkPersistence, type HumanInkStorageLike } from './persistence.js';

/**
 * `betterSidebar` is deliberately NOT in `inject`. Cordis keeps a fiber
 * "pending" until every injected service exists, so on hosts where the Better
 * Sidebar plugin is absent or crashes at startup (observed with
 * dsh-better-sidebar 0.17.1 on DSH Desktop 2.0.4) the wait would never end and
 * the whole renderer boot would fail. The optional service is read through
 * `ctx.get()` instead — the same pattern better-sidebar's own client uses for
 * optional integrations — and its absence degrades to the legacy footer action.
 */
export const inject = ['slots', 'connection'] as const;

export interface HumanInkClientOptions { api?: HumanInkClientApi; }
export interface HumanInkClientPlugin { controller: HumanInkWorkbenchController; contentSelection: ContentSelectionStore; ready: Promise<void>; dispose(): void; }

/** Instances created by apply(); lets tests and hosts reach the controller without breaking the Cordis plugin contract. */
const activeClients = new Set<HumanInkClientPlugin>();
export function activeHumanInkClients(): readonly HumanInkClientPlugin[] { return [...activeClients]; }

/** How long apply() bounds the initial project load. */
const READY_TIMEOUT_MS = 10_000;

/**
 * DeepSeek Harness Browser Client source entry.
 *
 * Entry priority:
 * 1. Native Better Sidebar tab (`humanink:workbench`) — the primary UI, bound
 *    to the current DSH session scope (sessionId / cwd / repoRoot).
 * 2. Legacy `sidebar.footer.action` fallback for DSH builds without Better
 *    Sidebar; the full-screen `shell.overlay` is no longer registered by
 *    default and never opens automatically.
 *
 * MVP note: the workbench controller is intentionally shared per client
 * process. All sessions render the same project store through it; the tab's
 * `scope.sessionId` / `scope.cwd` are displayed and passed through unchanged
 * so a future per-session split only needs to touch this factory.
 */
/**
 * Cordis plugin contract: apply() must return `undefined` or a disposer.
 * Returning the instance object would make the fiber fail with
 * `TypeError("Invalid effect")` and block the whole renderer boot, so the
 * instance is exposed through `activeHumanInkClients()` instead.
 */
export function apply(context: HumanInkClientContext, options: HumanInkClientOptions = {}): () => void {
  const api = options.api ?? createHumanInkWorkbenchRemoteClient(context.connection.rpc);
  const controller = new HumanInkWorkbenchController(api);
  const storage = (() => { try { return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage as unknown as HumanInkStorageLike; } catch { return undefined; } })();
  const contentSelection = createHumanInkContentSelection(createHumanInkPersistence(storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }));
  const disposers: Array<() => void> = [];

  let nativeAdapter: ReturnType<typeof registerHumanInkBetterSidebarAdapter> | undefined;
  const betterSidebar = resolveHumanInkBetterSidebar(context);
  if (betterSidebar) {
    try {
      nativeAdapter = registerHumanInkBetterSidebarAdapter(betterSidebar, ({ scope, visible }) => (
        createElement(HumanInkSidebarRoot, { controller, visible })
      ));
      disposers.push(() => nativeAdapter?.dispose());
    } catch {
      nativeAdapter = undefined;
    }
  }

  // The official DSH footer entry is always present. Better Sidebar only
  // changes where it opens the workbench; it is never a startup dependency.
  disposers.push(registerHumanInkNativeShell(context, controller, {
    onOpen: () => nativeAdapter?.open() ?? controller.open(),
  }));
  const ready = Promise.race([
    controller.initialize(),
    new Promise<void>((resolve) => { setTimeout(resolve, READY_TIMEOUT_MS); }),
  ]);

  const instance: HumanInkClientPlugin = {
    controller,
    contentSelection,
    ready,
    dispose() { for (const dispose of [...disposers].reverse()) dispose(); disposers.length = 0; },
  };
  activeClients.add(instance);
  return () => {
    instance.dispose();
    activeClients.delete(instance);
  };
}

export * from './api.js';
export * from './better-sidebar-adapter.js';
export * from './controller.js';
export * from './errors.js';
export * from './fake-api.js';
export * from './host-adapter.js';
export * from './native-workbench.js';
export * from './remote/client.js';
export * from './content-trigger.js';
export * from './content-selection.js';
export * from './persistence.js';
export * from './sidebar/HumanInkSidebarRoot.js';
export * from './sidebar/ContentSidebarPanel.js';
export * from './inspector/ContentInspector.js';
export * from './react-ui.js';
export * from './theme.js';
