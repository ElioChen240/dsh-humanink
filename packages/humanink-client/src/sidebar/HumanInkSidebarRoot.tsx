import { useEffect, useState, type ComponentType } from 'react';
import type { CapabilityReport } from '../api.js';
import type { HumanInkWorkbenchController } from '../controller.js';
import type { HumanInkClientContext, SlotRegistration } from '../host-adapter.js';
import type { SidebarFooterActionProps } from '../react-ui.js';
import { createHumanInkPersistence, DEFAULT_HUMANINK_UI_STATE, type HumanInkStorageLike, type HumanInkUiState } from '../persistence.js';
import { ContentInspector } from '../inspector/ContentInspector.js';
import { ContentSidebarPanel } from './ContentSidebarPanel.js';

export interface HumanInkSidebarRootProps {
  controller: HumanInkWorkbenchController;
  visible: boolean;
  capabilities?: CapabilityReport;
  storage?: HumanInkStorageLike;
}

const degradedCapability = (report?: CapabilityReport) => report
  ? Object.values(report).find((capability) => capability.state !== 'ready' && capability.action)
  : undefined;

export function HumanInkSidebarRoot({ controller, visible, capabilities, storage }: HumanInkSidebarRootProps) {
  const persistence = storage ? createHumanInkPersistence(storage) : undefined;
  const [uiState, setUiState] = useState<HumanInkUiState>(() => persistence?.load() ?? DEFAULT_HUMANINK_UI_STATE);
  const degraded = degradedCapability(capabilities);
  const updateUiState = (next: HumanInkUiState) => { setUiState(next); persistence?.save(next); };

  useEffect(() => {
    if (!visible || !uiState.selectedContentId) return;
    if (controller.getState().activeProjectId !== uiState.selectedContentId) void controller.selectProject(uiState.selectedContentId);
  }, [controller, uiState.selectedContentId, visible]);

  return <div className="humanink-sidebar-root">
    <header><strong>HumanInk</strong><span>内容工作台</span></header>
    {degraded ? <p role="status">{degraded.action}</p> : null}
    <ContentSidebarPanel controller={controller} uiState={uiState} onUiStateChange={updateUiState} />
    <button type="button" disabled={!controller.getState().activeProjectId} onClick={() => controller.open()}>打开内容检查器</button>
  </div>;
}

export interface RegisterHumanInkNativeShellOptions {
  onOpen?: () => void;
}

const activeShells = new WeakMap<object, () => void>();

export function registerHumanInkNativeShell(
  context: HumanInkClientContext,
  controller: HumanInkWorkbenchController,
  options: RegisterHumanInkNativeShellOptions = {},
): () => void {
  activeShells.get(context as object)?.();
  let footerDispose: (() => void) | undefined;
  let overlayDispose: (() => void) | undefined;
  let selectedContentId: string | undefined;

  const FooterAction = ((props: SidebarFooterActionProps) => <button type="button" data-wide={props.wide} onClick={() => (options.onOpen ?? (() => controller.open()))()}>HumanInk</button>) as ComponentType<SidebarFooterActionProps>;
  context.slots.inject('sidebar.footer.action', () => {
    footerDispose = context.slots.register<SidebarFooterActionProps>({ name: 'sidebar.footer.action', id: 'humanink-open-workbench', order: 80, label: '打开 HumanInk' }, FooterAction);
    return footerDispose;
  });

  const syncInspector = () => {
    const next = controller.getState().activeProjectId;
    if (next === selectedContentId) return;
    overlayDispose?.();
    overlayDispose = undefined;
    selectedContentId = next;
    if (!next) return;
    const Inspector = (() => <ContentInspector controller={controller} contentId={next} />) as ComponentType<Record<never, never>>;
    context.slots.inject('shell.overlay', () => {
      const meta: SlotRegistration = { name: 'shell.overlay', id: `humanink-content-inspector:${next}`, order: 100, label: 'HumanInk 内容检查器' };
      overlayDispose = context.slots.register(meta, Inspector);
      return overlayDispose;
    });
  };
  const unsubscribe = controller.subscribe(syncInspector);
  syncInspector();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    overlayDispose?.();
    footerDispose?.();
    overlayDispose = undefined;
    footerDispose = undefined;
    if (activeShells.get(context as object) === dispose) activeShells.delete(context as object);
  };
  activeShells.set(context as object, dispose);
  return dispose;
}
