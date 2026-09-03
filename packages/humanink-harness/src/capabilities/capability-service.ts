import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CapabilityReport, CapabilityState } from '../application/contracts.js';

export type CapabilityProbe = () => boolean | Promise<boolean>;

export interface CapabilityServiceOptions {
  readonly libraryRoot?: string;
  readonly core?: CapabilityProbe;
  readonly storage?: CapabilityProbe;
  readonly llm?: CapabilityProbe;
  readonly remote?: CapabilityProbe;
  readonly credentials?: CapabilityProbe;
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : 'Capability probe failed.';
}

async function inspectProbe(probe: CapabilityProbe | undefined, omitted: CapabilityState): Promise<CapabilityState> {
  if (probe === undefined) return omitted;
  try {
    return await probe() ? { state: 'ready' } : { state: 'missing' };
  } catch (error) {
    return { state: 'error', reason: errorReason(error) };
  }
}

export class CapabilityService {
  constructor(private readonly options: CapabilityServiceOptions) {}

  async inspect(signal?: AbortSignal): Promise<CapabilityReport> {
    signal?.throwIfAborted();
    const contentLibrary: CapabilityState = this.options.libraryRoot === undefined
      ? { state: 'missing', action: 'Choose an existing HumanInk content directory.' }
      : existsSync(resolve(this.options.libraryRoot))
        ? { state: 'ready' }
        : { state: 'missing', action: 'Choose an existing HumanInk content directory.' };
    const [core, storage, llm, remote, credentials] = await Promise.all([
      inspectProbe(this.options.core ?? (() => true), { state: 'error', reason: 'HumanInk core probe is unavailable.' }),
      inspectProbe(this.options.storage ?? (() => true), { state: 'error', reason: 'HumanInk storage probe is unavailable.' }),
      inspectProbe(this.options.llm, { state: 'missing' }),
      inspectProbe(this.options.remote, { state: 'missing' }),
      inspectProbe(this.options.credentials, { state: 'unsupported' }),
    ]);
    signal?.throwIfAborted();
    return { core, storage, contentLibrary, llm, remote, credentials };
  }
}