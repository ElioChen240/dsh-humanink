import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apply,
  createHumanInkApplication,
  inject,
  name,
  type HumanInkHarnessConfig,
} from '../src/plugin.js';
import type {
  HarnessGenerateOptionsLike,
  HarnessLlmServiceLike,
} from '../src/services/llm-provider.js';

declare const process: {
  cwd(): string;
};

const dataFileNames = [
  'projects.jsonl',
  'tasks.jsonl',
  'transactions.jsonl',
  'versions.jsonl',
] as const;

function existingDataFiles(dataDir: string): readonly string[] {
  return dataFileNames.filter((fileName) => existsSync(join(dataDir, fileName)));
}

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

function workflowLlm(): HarnessLlmServiceLike {
  return {
    stream(options: HarnessGenerateOptionsLike) {
      const requestText = options.messages[0]?.content[0]?.text;
      if (requestText === undefined) {
        throw new TypeError('Missing HumanInk request payload');
      }
      const request = JSON.parse(requestText) as { readonly task?: string };
      const value = request.task === 'humanize'
        ? {
            title: '更自然的标题',
            body: '这是一段更自然、更具体的正文。',
            changes: [{ before: '原始正文。', after: '这是一段更自然、更具体的正文。', reason: '表达更具体' }],
            questions: [],
          }
        : request.task === 'review'
          ? {
              verdict: 'pass',
              summary: '标题与正文一致，可以进入人工确认。',
              findings: [],
            }
          : {};

      return (async function* () {
        yield { type: 'text-delta', index: 0, text: JSON.stringify(value) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }());
    },
  };
}

const invalidConfigs: readonly {
  readonly label: string;
  readonly config: HumanInkHarnessConfig;
  readonly error: string;
}[] = [
  {
    label: 'empty provider',
    config: { provider: '   ', model: 'deepseek-chat' },
    error: 'provider must not be empty',
  },
  {
    label: 'empty model',
    config: { provider: 'deepseek', model: '   ' },
    error: 'model must not be empty',
  },
  {
    label: 'invalid temperature',
    config: { provider: 'deepseek', model: 'deepseek-chat', temperature: -1 },
    error: 'temperature must be a non-negative finite number',
  },
  {
    label: 'invalid maxTokens',
    config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 0 },
    error: 'maxTokens must be a positive integer',
  },
  {
    label: 'invalid timeoutMs',
    config: { provider: 'deepseek', model: 'deepseek-chat', timeoutMs: 0 },
    error: 'timeoutMs must be a positive finite number',
  },
  {
    label: 'invalid maxAttempts',
    config: { provider: 'deepseek', model: 'deepseek-chat', maxAttempts: 0 },
    error: 'maxAttempts must be a positive integer',
  },
  {
    label: 'invalid backoffMs',
    config: { provider: 'deepseek', model: 'deepseek-chat', backoffMs: -1 },
    error: 'backoffMs must be a non-negative finite number',
  },
];

describe('HumanInk Harness plugin', () => {
  it.each([
    { label: 'empty', dataDir: '' },
    { label: 'whitespace-only', dataDir: ' \t\r\n ' },
  ])('rejects an explicitly $label dataDir without filesystem side effects', ({ dataDir }) => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-plugin-data-dir-invalid-'));
    roots.push(root);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    let thrown: unknown;

    try {
      createHumanInkApplication({ llm: idleLlm() }, {
        dataDir,
        provider: 'deepseek',
        model: 'deepseek-chat',
      });
    } catch (error) {
      thrown = error;
    } finally {
      cwd.mockRestore();
    }

    expect({
      errorName: thrown instanceof Error ? thrown.name : undefined,
      errorMessage: thrown instanceof Error ? thrown.message : undefined,
      createdFiles: existingDataFiles(dataDir.length === 0 ? root : join(root, dataDir)),
    }).toEqual({
      errorName: 'TypeError',
      errorMessage: 'dataDir must not be empty',
      createdFiles: [],
    });
  });

  it('uses .humanink when dataDir is undefined', () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-plugin-data-dir-default-'));
    roots.push(root);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);

    try {
      createHumanInkApplication({ llm: idleLlm() }, {
        provider: 'deepseek',
        model: 'deepseek-chat',
      });
    } finally {
      cwd.mockRestore();
    }

    expect(existingDataFiles(root)).toEqual([]);
    expect(existingDataFiles(join(root, '.humanink'))).toEqual(dataFileNames);
  });

  it('trims an explicitly configured non-empty dataDir before resolving it', () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-plugin-data-dir-trim-'));
    roots.push(root);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);

    try {
      createHumanInkApplication({ llm: idleLlm() }, {
        dataDir: '  data  ',
        provider: 'deepseek',
        model: 'deepseek-chat',
      });
    } finally {
      cwd.mockRestore();
    }

    expect(existingDataFiles(join(root, 'data'))).toEqual(dataFileNames);
    expect(existingDataFiles(join(root, '  data  '))).toEqual([]);
  });

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
      llm: idleLlm(),
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
      'humanink-humanize',
      'humanink-review',
      'humanink-task',
      'humanink-cancel',
      'humanink-export',
    ]));

    dispose();
    expect(disposed).toBe(registrations.length);
  });

  it('injects humanize and review capabilities from the plugin factory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-plugin-capabilities-'));
    roots.push(dataDir);
    const application = createHumanInkApplication({ llm: workflowLlm() }, {
      dataDir,
      provider: 'deepseek',
      model: 'deepseek-chat',
      backoffMs: 0,
    });
    const created = await application.createProject({
      title: '原始标题',
      source: { title: '原始标题', body: '原始正文。' },
    });

    const humanizeTask = application.humanizeContent({
      projectId: created.project.id,
      versionId: created.sourceVersion.id,
    });
    const humanized = await application.waitForTask(humanizeTask.id);
    expect(humanized.status).toBe('succeeded');
    expect(humanized.contentVersionId).toBeDefined();

    const reviewTask = application.reviewContent({
      projectId: created.project.id,
      versionId: humanized.contentVersionId!,
    });
    const reviewed = await application.waitForTask(reviewTask.id);
    expect(reviewed.status).toBe('succeeded');
    expect(reviewed.contentVersionId).toBeDefined();
  });

  it.each(invalidConfigs)(
    'rejects $label before creating the configured data directory',
    ({ config, error }) => {
      const root = mkdtempSync(join(tmpdir(), 'humanink-plugin-invalid-'));
      roots.push(root);
      const dataDir = join(root, 'data');

      expect(() => createHumanInkApplication({ llm: idleLlm() }, {
        ...config,
        dataDir,
      })).toThrow(error);

      expect(existsSync(dataDir)).toBe(false);
    },
  );
});
