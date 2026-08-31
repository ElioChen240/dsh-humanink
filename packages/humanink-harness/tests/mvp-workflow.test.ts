import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessCommandDefinition } from '../src/commands/index.js';
import { apply } from '../src/plugin.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const modelOutputs = {
  title: [{
    title: '社区咖啡店留住熟客，靠的不是打折',
    strategy: '反常识',
    reason: '标题能被素材支撑',
    riskFlags: [],
  }],
  brief: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    audience: '社区咖啡店店主',
    objective: '说明稳定体验如何带来复购',
    angle: '从日常动作切入',
    keyPoints: ['稳定出品', '记住偏好'],
    questions: ['如何衡量复购？'],
  },
  outline: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    sections: [{
      heading: '先把每次体验做稳定',
      purpose: '建立熟客信任',
      keyPoints: ['出品标准', '服务节奏'],
    }],
    ending: '从一周实验开始',
  },
  draft: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    body: '很多小店先想到打折。\n\n但熟客更在意的，是每一次到店都能得到稳定体验。',
  },
} as const;

function parseResult(result: { readonly kind: string; readonly text?: string }) {
  expect(result.kind).toBe('success');
  expect(result.text).toBeDefined();
  return JSON.parse(result.text!) as Record<string, unknown>;
}

async function waitForTask(definitions: Map<string, HarnessCommandDefinition>, taskId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await definitions.get('humanink-task')!.handler({ rawInput: taskId });
    const task = parseResult(result);
    if (['succeeded', 'failed', 'cancelled'].includes(String(task.status))) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Task did not settle: ${taskId}`);
}

describe('HumanInk persisted MVP workflow', () => {
  it('runs create, title, brief, outline, draft, task tracking, and export through registered commands', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-mvp-'));
    roots.push(dataDir);
    const definitions = new Map<string, HarnessCommandDefinition>();
    const dispose = apply({
      commands: {
        register(definition) {
          definitions.set(definition.name, definition);
          return () => definitions.delete(definition.name);
        },
      },
      llm: {
        stream(options) {
          return (async function* () {
            const text = String((options.messages[0]?.content[0] as { text?: string } | undefined)?.text ?? '{}');
            const request = JSON.parse(text) as { task: keyof typeof modelOutputs };
            yield { type: 'text-delta', text: JSON.stringify(modelOutputs[request.task]) };
            yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } };
            yield { type: 'finish', reason: { kind: 'stop' } };
          }());
        },
      },
    }, { dataDir, provider: 'deepseek', model: 'deepseek-chat' });

    const created = parseResult(await definitions.get('humanink-create')!.handler({
      rawInput: JSON.stringify({
        title: '社区咖啡店如何留下熟客',
        source: {
          title: '社区咖啡店如何留下熟客',
          body: '一家街角咖啡店想减少对低价促销的依赖。',
        },
      }),
    }));
    const projectId = String(created.projectId);
    const sourceVersionId = String(created.sourceVersionId);

    const titleQueued = parseResult(await definitions.get('humanink-title')!.handler({
      rawInput: JSON.stringify({ projectId, sourceVersionId, count: 1 }),
    }));
    const titleTask = await waitForTask(definitions, String(titleQueued.taskId));
    expect(titleTask.status).toBe('succeeded');

    const briefQueued = parseResult(await definitions.get('humanink-brief')!.handler({
      rawInput: JSON.stringify({
        projectId,
        sourceVersionId,
        selectedTitle: modelOutputs.title[0].title,
      }),
    }));
    const briefTask = await waitForTask(definitions, String(briefQueued.taskId));

    const outlineQueued = parseResult(await definitions.get('humanink-outline')!.handler({
      rawInput: JSON.stringify({ projectId, briefVersionId: briefTask.contentVersionId }),
    }));
    const outlineTask = await waitForTask(definitions, String(outlineQueued.taskId));

    const draftQueued = parseResult(await definitions.get('humanink-draft')!.handler({
      rawInput: JSON.stringify({
        projectId,
        briefVersionId: briefTask.contentVersionId,
        outlineVersionId: outlineTask.contentVersionId,
      }),
    }));
    const draftTask = await waitForTask(definitions, String(draftQueued.taskId));
    expect(draftTask.status).toBe('succeeded');

    const exported = await definitions.get('humanink-export')!.handler({
      rawInput: String(draftTask.contentVersionId),
    });
    expect(exported).toEqual({
      kind: 'success',
      text: `# ${modelOutputs.draft.title}\n\n${modelOutputs.draft.body}\n`,
    });

    for (const file of ['projects.jsonl', 'versions.jsonl', 'tasks.jsonl']) {
      const path = join(dataDir, file);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8').trim()).not.toBe('');
    }

    dispose();
    expect(definitions.size).toBe(0);
  });
});
