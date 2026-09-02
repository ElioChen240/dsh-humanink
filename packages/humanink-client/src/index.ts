import type { HumanInkClientApi } from './api.js';
import { HumanInkWorkbenchController } from './controller.js';
import { createHumanInkConnectionApi, registerHumanInkClientSlots, type HumanInkClientContext } from './host-adapter.js';

export const inject = ['slots', 'connection'] as const;

export interface HumanInkClientOptions { api?: HumanInkClientApi; }
export interface HumanInkClientPlugin { controller: HumanInkWorkbenchController; ready: Promise<void>; dispose(): void; }

/** DeepSeek Harness Browser Client source entry. */
export function apply(context: HumanInkClientContext, options: HumanInkClientOptions = {}): HumanInkClientPlugin {
  const api = options.api ?? createHumanInkConnectionApi(context.connection.rpc);
  const controller = new HumanInkWorkbenchController(api);
  const disposeSlots = registerHumanInkClientSlots(context, controller);
  return { controller, ready: controller.initialize(), dispose: disposeSlots };
}

export * from './api.js';
export * from './controller.js';
export * from './fake-api.js';
export * from './host-adapter.js';
export * from './react-ui.js';
export * from './theme.js';
