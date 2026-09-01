import type { HumanInkApplication } from '../runtime/humanink-application.js';

export interface HarnessCommandInvocation {
  readonly commandId?: string;
  readonly agent?: unknown;
  readonly rawInput: string;
  readonly signal?: AbortSignal;
}

export type HarnessCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string };

export interface HarnessCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly input?: {
    readonly hint: string;
  };
  readonly handler: (
    invocation: HarnessCommandInvocation,
  ) => HarnessCommandResult | Promise<HarnessCommandResult>;
}

export type HarnessCommandDisposer = () => void;

export interface HarnessCommandRegistryLike {
  register(definition: HarnessCommandDefinition): HarnessCommandDisposer | void;
}

export type HumanInkCommandApplication = Pick<
  HumanInkApplication,
  | 'createProject'
  | 'generateTitles'
  | 'generateBrief'
  | 'generateOutline'
  | 'generateDraft'
  | 'humanizeContent'
  | 'reviewContent'
  | 'getTask'
  | 'cancelTask'
  | 'exportVersion'
>;
