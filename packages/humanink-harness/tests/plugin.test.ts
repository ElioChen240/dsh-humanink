import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apply, inject, name } from '../src/plugin.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('HumanInk Harness plugin', () => {
  it('composes storage, runtime, LLM adapter, and command registrations', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-plugin-'));
    roots.push(dataDir);
    const registrations: Array<{ name: string }> = [];
    let disposed = 0;
    const ctx = {
      commands: {
        register(definition: { name: string }) {
          registrations.push(definition);
          return () => { disposed += 1; };
        },
      },
      llm: {
        stream() {
          return (async function* () {
            yield { type: 'finish', reason: { kind: 'stop' } };
          }());
        },
      },
    };

    const dispose = apply(ctx, {
      dataDir,
      provider: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(name).toBe('humanink');
    expect(inject).toEqual(['commands', 'llm']);
    expect(registrations.map((item) => item.name)).toEqual(expect.arrayContaining([
      'humanink-create',
      'humanink-title',
      'humanink-brief',
      'humanink-outline',
      'humanink-draft',
      'humanink-task',
      'humanink-cancel',
      'humanink-export',
    ]));

    dispose();
    expect(disposed).toBe(registrations.length);
  });
});
