import type { HumanInkClientApi } from './api.js';
import { HumanInkWorkbenchController } from './controller.js';
import { createHumanInkConnectionApi, registerHumanInkClientSlots, resolveHumanInkBetterSidebar, type HumanInkClientContext } from './host-adapter.js';
import { registerHumanInkBetterSidebarAdapter, type HumanInkWorkbenchTabComponent } from './better-sidebar-adapter.js';
import { createHumanInkNativeTab } from './native-workbench.js';

/**
 * `betterSidebar` comes from the dsh-better-sidebar host plugin. DSH client
 * runtimes inject it as undefined when the plugin is not installed, so it must
 * stay optional here and every use site has a runtime guard.
 */
export const inject = ['slots', 'connection', 'betterSidebar'] as const;

export interface HumanInkClientOptions { api?: HumanInkClientApi; }
export interface HumanInkClientPlugin { controller: HumanInkWorkbenchController; ready: Promise<void>; dispose(): void; }

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
export function apply(context: HumanInkClientContext, options: HumanInkClientOptions = {}): HumanInkClientPlugin {
  const api = options.api ?? createHumanInkConnectionApi(context.connection.rpc);
  const controller = new HumanInkWorkbenchController(api);
  const disposers: Array<() => void> = [];

  const betterSidebar = resolveHumanInkBetterSidebar(context);
  if (betterSidebar) {
    const tab: HumanInkWorkbenchTabComponent = createHumanInkNativeTab(controller);
    // ctx.effect keeps the tab registration on the Cordis fiber: HMR reloads
    // and plugin unloads dispose the descriptor, so re-activation never
    // duplicates the `humanink:workbench` tab. Plain mocks without effect
    // support (tests, minimal hosts) fall back to direct registration.
    if (typeof context.effect === 'function') {
      context.effect(() => {
        const adapter = registerHumanInkBetterSidebarAdapter(betterSidebar, tab);
        disposers.push(adapter.dispose);
        return adapter.dispose;
      });
    } else {
      const adapter = registerHumanInkBetterSidebarAdapter(betterSidebar, tab);
      disposers.push(adapter.dispose);
    }
  } else {
    disposers.push(registerHumanInkClientSlots(context, controller, { overlay: false }));
  }

  return {
    controller,
    ready: controller.initialize(),
    dispose() { for (const dispose of [...disposers].reverse()) dispose(); disposers.length = 0; },
  };
}

export * from './api.js';
export * from './better-sidebar-adapter.js';
export * from './controller.js';
export * from './errors.js';
export * from './fake-api.js';
export * from './host-adapter.js';
export * from './native-workbench.js';
export * from './react-ui.js';
export * from './theme.js';
