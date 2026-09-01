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
    body: '很多社区咖啡店先想到打折。\n\n但熟客更在意的，是每一次到店都能得到稳定体验。',
  },
  humanize: {
    title: '社区咖啡店的熟客，不是打折换来的',
    body: '街角的社区咖啡店一着急，最容易先降价。\n\n可真正让人下周还来，往往是咖啡入口的味道和上次一样。',
    changes: [{
      before: '很多社区咖啡店先想到打折。',
      after: '街角的社区咖啡店一着急，最容易先降价。',
      reason: '补充场景并减少模板化表达',
    }],
    questions: [],
  },
  review: {
    verdict: 'pass',
    summary: '标题与正文一致，未发现需要立即修订的问题。',
    findings: [],
  },
} as const;

const humanizeWithoutProtectedField = {
  title: '熟客不是打折换来的',
  body: '一家小店一着急，最容易先降价。\n\n可真正让人下周还来，往往是入口的味道和上次一样。',
  changes: [{
    before: '社区咖啡店',
    after: '一家小店',
    reason: '错误删除了保护字段',
  }],
  questions: [],
} as const;

type ModelTask = keyof typeof modelOutputs;

interface CapturedModelRequest {
  readonly task: ModelTask;
  readonly promptTemplateVersion: string;
  readonly input: Record<string, unknown>;
  readonly outputSchema: string;
  readonly system?: string;
}

interface StoredVersionRecord {
  readonly id: string;
  readonly kind: string;
  readonly parentVersionId?: string;
  readonly protectedFields: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly content: {
    readonly format: string;
    readonly title: string;
    readonly body: string;
  };
}

interface StoredTaskRecord {
  readonly id: string;
  readonly status: string;
  readonly contentVersionId?: string;
  readonly errorCode?: string;
}

type ModelResolver = (
  request: CapturedModelRequest,
  signal: AbortSignal | undefined,
) => unknown | Promise<unknown>;

function parseResult(result: { readonly kind: string; readonly text?: string }) {
  expect(result.kind).toBe('success');
  expect(result.text).toBeDefined();
  return JSON.parse(result.text!) as Record<string, unknown>;
}

function readJsonl<T>(path: string): T[] {
  const text = readFileSync(path, 'utf8').trim();
  return text.length === 0
    ? []
    : text.split(/\r?\n/u).map((line) => JSON.parse(line) as T);
}

function latestTaskRecord(dataDir: string, taskId: string): StoredTaskRecord {
  const records = readJsonl<StoredTaskRecord>(join(dataDir, 'tasks.jsonl'))
    .filter((record) => record.id === taskId);
  const record = records.at(-1);
  expect(record).toBeDefined();
  return record!;
}

function createHarness(dataDir: string, resolveModel: ModelResolver = (request) => modelOutputs[request.task]) {
  const definitions = new Map<string, HarnessCommandDefinition>();
  const requests: CapturedModelRequest[] = [];
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
          const serialized = JSON.parse(text) as Omit<CapturedModelRequest, 'system'>;
          const request: CapturedModelRequest = {
            ...serialized,
            ...(options.system === undefined ? {} : { system: options.system }),
          };
          requests.push(request);
          const output = await resolveModel(request, options.signal);
          yield {
            type: 'text-delta',
            text: typeof output === 'string' ? output : JSON.stringify(output),
          };
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }());
      },
    },
  }, {
    dataDir,
    provider: 'deepseek',
    model: 'deepseek-chat',
    timeoutMs: 2_000,
    maxAttempts: 1,
    backoffMs: 0,
  });
  return { definitions, requests, dispose };
}

async function waitForTask(definitions: Map<string, HarnessCommandDefinition>, taskId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await definitions.get('humanink-task')!.handler({ rawInput: taskId });
    const task = parseResult(result);
    if (['succeeded', 'failed', 'cancelled'].includes(String(task.status))) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Task did not settle: ${taskId}`);
}

async function createDraft(definitions: Map<string, HarnessCommandDefinition>) {
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
  expect(briefTask.status).toBe('succeeded');

  const outlineQueued = parseResult(await definitions.get('humanink-outline')!.handler({
    rawInput: JSON.stringify({ projectId, briefVersionId: briefTask.contentVersionId }),
  }));
  const outlineTask = await waitForTask(definitions, String(outlineQueued.taskId));
  expect(outlineTask.status).toBe('succeeded');

  const draftQueued = parseResult(await definitions.get('humanink-draft')!.handler({
    rawInput: JSON.stringify({
      projectId,
      briefVersionId: briefTask.contentVersionId,
      outlineVersionId: outlineTask.contentVersionId,
      protectedFields: ['社区咖啡店'],
      sourceRefs: ['source://coffee-case'],
    }),
  }));
  const draftTask = await waitForTask(definitions, String(draftQueued.taskId));
  expect(draftTask.status).toBe('succeeded');

  return {
    projectId,
    sourceVersionId,
    draftTask,
    draftVersionId: String(draftTask.contentVersionId),
  };
}

async function humanizeDraft(
  definitions: Map<string, HarnessCommandDefinition>,
  projectId: string,
  draftVersionId: string,
) {
  const queued = parseResult(await definitions.get('humanink-humanize')!.handler({
    rawInput: JSON.stringify({
      projectId,
      versionId: draftVersionId,
      direction: '增加具体场景，保留事实和保护字段',
    }),
  }));
  return {
    taskId: String(queued.taskId),
    task: await waitForTask(definitions, String(queued.taskId)),
  };
}

function abortError(): DOMException {
  return new DOMException('The test LLM request was aborted.', 'AbortError');
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal === undefined || signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('HumanInk persisted humanize and review workflow', () => {
  it('preserves metadata, exposes deterministic diff, and stores a readable review report', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-humanize-review-'));
    roots.push(dataDir);
    const { definitions, requests, dispose } = createHarness(dataDir);
    const { projectId, draftTask, draftVersionId } = await createDraft(definitions);

    const { task: humanizeTask } = await humanizeDraft(definitions, projectId, draftVersionId);
    expect(humanizeTask.status).toBe('succeeded');
    const humanizeResult = humanizeTask.result as {
      readonly output: typeof modelOutputs.humanize;
      readonly diff: {
        readonly granularity: string;
        readonly hasChanges: boolean;
        readonly changes: readonly unknown[];
      };
      readonly protectedFieldValidation: {
        readonly valid: boolean;
        readonly violations: readonly unknown[];
      };
    };
    expect(humanizeResult.diff).toMatchObject({
      granularity: 'sentence',
      hasChanges: true,
    });
    expect(humanizeResult.diff.changes).not.toEqual(modelOutputs.humanize.changes);
    expect(humanizeResult.protectedFieldValidation).toEqual({
      valid: true,
      violations: [],
    });

    const humanizeRequest = requests.find((request) => request.task === 'humanize');
    expect(humanizeRequest?.input).toMatchObject({
      protectedFields: ['社区咖啡店'],
      sourceRefs: ['source://coffee-case'],
    });

    const reviewQueued = parseResult(await definitions.get('humanink-review')!.handler({
      rawInput: JSON.stringify({
        projectId,
        versionId: humanizeTask.contentVersionId,
      }),
    }));
    const reviewTask = await waitForTask(definitions, String(reviewQueued.taskId));
    expect(reviewTask.status).toBe('succeeded');
    const reviewResult = reviewTask.result as {
      readonly output: typeof modelOutputs.review;
    };
    expect(reviewResult.output).toEqual(modelOutputs.review);

    const reviewRequest = requests.find((request) => request.task === 'review');
    expect(reviewRequest?.input).toMatchObject({
      protectedFields: ['社区咖啡店'],
      sourceRefs: ['source://coffee-case'],
    });
    expect(reviewRequest?.system).toContain('中文内容发布前复核编辑');
    expect(reviewRequest?.system).not.toMatch(/\?{4,}/u);

    const exported = await definitions.get('humanink-export')!.handler({
      rawInput: String(humanizeTask.contentVersionId),
    });
    expect(exported).toEqual({
      kind: 'success',
      text: `# ${modelOutputs.humanize.title}\n\n${modelOutputs.humanize.body}\n`,
    });

    const versions = readJsonl<StoredVersionRecord>(join(dataDir, 'versions.jsonl'));
    const humanizedVersion = versions.find((version) => version.kind === 'humanized');
    const reviewVersion = versions.find((version) => version.kind === 'review');
    expect(humanizedVersion).toMatchObject({
      parentVersionId: draftTask.contentVersionId,
      protectedFields: ['社区咖啡店'],
      sourceRefs: ['source://coffee-case'],
    });
    expect(reviewVersion).toMatchObject({
      parentVersionId: humanizeTask.contentVersionId,
      protectedFields: ['社区咖啡店'],
      sourceRefs: ['source://coffee-case'],
    });
    expect(reviewVersion?.content.body).toContain('# 发布前复核报告');
    expect(reviewVersion?.content.body).toContain('**结论：** 通过');
    expect(reviewVersion?.content.body).toContain('## 摘要');
    expect(reviewVersion?.content.body).toContain(modelOutputs.review.summary);
    expect(reviewVersion?.content.body).not.toMatch(/\?{4,}/u);

    for (const file of ['projects.jsonl', 'versions.jsonl', 'tasks.jsonl']) {
      const path = join(dataDir, file);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8').trim()).not.toBe('');
    }

    dispose();
    expect(definitions.size).toBe(0);
  });

  it('fails humanization without creating a version when the model removes a protected field', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-protected-field-'));
    roots.push(dataDir);
    const { definitions, dispose } = createHarness(dataDir, (request) => (
      request.task === 'humanize' ? humanizeWithoutProtectedField : modelOutputs[request.task]
    ));
    const { projectId, draftVersionId } = await createDraft(definitions);

    const { taskId, task } = await humanizeDraft(definitions, projectId, draftVersionId);
    expect(task).toMatchObject({
      id: taskId,
      status: 'failed',
      errorCode: 'HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED',
    });
    expect(task).not.toHaveProperty('contentVersionId');

    const versions = readJsonl<StoredVersionRecord>(join(dataDir, 'versions.jsonl'));
    expect(versions.filter((version) => version.kind === 'humanized')).toHaveLength(0);
    expect(latestTaskRecord(dataDir, taskId)).toMatchObject({
      id: taskId,
      status: 'failed',
      errorCode: 'HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED',
    });

    const exportedDraft = await definitions.get('humanink-export')!.handler({
      rawInput: draftVersionId,
    });
    expect(exportedDraft).toEqual({
      kind: 'success',
      text: `# ${modelOutputs.draft.title}\n\n${modelOutputs.draft.body}\n`,
    });

    dispose();
  });

  it('fails review without creating a report when the model returns invalid JSON', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-review-invalid-'));
    roots.push(dataDir);
    const { definitions, dispose } = createHarness(dataDir, (request) => (
      request.task === 'review' ? '{"verdict":' : modelOutputs[request.task]
    ));
    const { projectId, draftVersionId } = await createDraft(definitions);
    const { task: humanizeTask } = await humanizeDraft(definitions, projectId, draftVersionId);
    expect(humanizeTask.status).toBe('succeeded');
    const humanizedVersionId = String(humanizeTask.contentVersionId);

    const reviewQueued = parseResult(await definitions.get('humanink-review')!.handler({
      rawInput: JSON.stringify({ projectId, versionId: humanizedVersionId }),
    }));
    const reviewTaskId = String(reviewQueued.taskId);
    const reviewTask = await waitForTask(definitions, reviewTaskId);
    expect(reviewTask).toMatchObject({
      id: reviewTaskId,
      status: 'failed',
      errorCode: 'LLM_INVALID_RESPONSE',
    });
    expect(reviewTask).not.toHaveProperty('contentVersionId');

    const versions = readJsonl<StoredVersionRecord>(join(dataDir, 'versions.jsonl'));
    expect(versions.filter((version) => version.kind === 'review')).toHaveLength(0);
    expect(latestTaskRecord(dataDir, reviewTaskId)).toMatchObject({
      id: reviewTaskId,
      status: 'failed',
      errorCode: 'LLM_INVALID_RESPONSE',
    });

    const exportedHumanized = await definitions.get('humanink-export')!.handler({
      rawInput: humanizedVersionId,
    });
    expect(exportedHumanized).toEqual({
      kind: 'success',
      text: `# ${modelOutputs.humanize.title}\n\n${modelOutputs.humanize.body}\n`,
    });

    dispose();
  });

  it('cancels a humanize request after the LLM stream starts without creating a version', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'humanink-humanize-cancel-'));
    roots.push(dataDir);
    const humanizeStarted = deferred();
    const { definitions, dispose } = createHarness(dataDir, async (request, signal) => {
      if (request.task !== 'humanize') {
        return modelOutputs[request.task];
      }
      humanizeStarted.resolve();
      return waitForAbort(signal);
    });
    const { projectId, draftVersionId } = await createDraft(definitions);

    const queued = parseResult(await definitions.get('humanink-humanize')!.handler({
      rawInput: JSON.stringify({ projectId, versionId: draftVersionId }),
    }));
    const taskId = String(queued.taskId);
    await humanizeStarted.promise;
    parseResult(await definitions.get('humanink-cancel')!.handler({ rawInput: taskId }));

    const task = await waitForTask(definitions, taskId);
    expect(task).toMatchObject({
      id: taskId,
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
    });
    expect(task).not.toHaveProperty('contentVersionId');
    expect(readJsonl<StoredVersionRecord>(join(dataDir, 'versions.jsonl'))
      .filter((version) => version.kind === 'humanized')).toHaveLength(0);
    expect(latestTaskRecord(dataDir, taskId)).toMatchObject({
      id: taskId,
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
    });

    dispose();
  });
});
