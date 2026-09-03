import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, inject } from '../src/plugin.js';
import type { HarnessLlmServiceLike } from '../src/services/llm-provider.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function idleLlm(): HarnessLlmServiceLike {
  return {
    stream() {
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } };
      }());
    },
  };
}

describe('DSH native host integration contract', () => {
  it('keeps the optional client transport out of hard host injections', () => {
    expect(inject).toEqual(['commands', 'llm']);
  });

  it('loads and disposes without a connection service', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-native-contract-'));
    roots.push(dataDir);
    const disposeCommand = vi.fn();
    const register = vi.fn(() => disposeCommand);

    const dispose = apply({
      commands: { register },
      llm: idleLlm(),
    }, {
      dataDir,
      provider: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(typeof dispose).toBe('function');
    expect(register).toHaveBeenCalled();
    dispose();
    expect(disposeCommand).toHaveBeenCalledTimes(register.mock.calls.length);
  });
});