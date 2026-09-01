import { describe, expect, it, vi } from 'vitest';
import {
  registerHumanInkCommands,
  type HarnessCommandDefinition,
  type HarnessCommandRegistryLike,
} from '../src/commands/index.js';
import { TaskRuntime } from '../src/runtime/task-runtime.js';

function createRegistry() {
  const definitions = new Map<string, HarnessCommandDefinition>();
  const disposed: string[] = [];
  const registry: HarnessCommandRegistryLike = {
    register(definition) {
      definitions.set(definition.name, definition);
      return () => disposed.push(definition.name);
    },
  };
  return { definitions, disposed, registry };
}

function parseJsonResult(result: { readonly text?: string }): Record<string, unknown> {
  expect(result.text).toBeDefined();
  return JSON.parse(result.text!) as Record<string, unknown>;
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    createProject: vi.fn(),
    generateTitles: vi.fn(),
    generateBrief: vi.fn(),
    generateOutline: vi.fn(),
    generateDraft: vi.fn(),
    humanizeContent: vi.fn(),
    reviewContent: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    exportVersion: vi.fn(),
    ...overrides,
  };
}

describe('HumanInk Harness commands', () => {
  it('registers the complete command set with official-compatible names', () => {
    const { definitions, disposed, registry } = createRegistry();

    const dispose = registerHumanInkCommands(registry, application());

    expect([...definitions.keys()]).toEqual([
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
    ]);
    for (const definition of definitions.values()) {
      expect(definition.name).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(definition.input?.hint).toBeTruthy();
      expect(typeof definition.handler).toBe('function');
    }

    expect(typeof dispose).toBe('function');
    dispose();
    expect(disposed).toEqual([...definitions.keys()].reverse());
  });

  it('maps project creation and all generation commands to HumanInkApplication', async () => {
    const createProject = vi.fn().mockResolvedValue({
      project: { id: 'project_1' },
      sourceVersion: { id: 'version_source' },
    });
    const generateTitles = vi.fn().mockReturnValue({ id: 'task_title', status: 'queued' });
    const generateBrief = vi.fn().mockReturnValue({ id: 'task_brief', status: 'queued' });
    const generateOutline = vi.fn().mockReturnValue({ id: 'task_outline', status: 'queued' });
    const generateDraft = vi.fn().mockReturnValue({ id: 'task_draft', status: 'queued' });
    const humanizeContent = vi.fn().mockReturnValue({ id: 'task_humanize', status: 'queued' });
    const reviewContent = vi.fn().mockReturnValue({ id: 'task_review', status: 'queued' });
    const app = application({
      createProject,
      generateTitles,
      generateBrief,
      generateOutline,
      generateDraft,
      humanizeContent,
      reviewContent,
    });
    const { definitions, registry } = createRegistry();
    registerHumanInkCommands(registry, app);
    const signal = new AbortController().signal;

    const created = await definitions.get('humanink-create')!.handler({
      rawInput: JSON.stringify({
        title: '社区咖啡店如何留下熟客',
        source: { title: '原始标题', body: '原始正文' },
      }),
      signal,
    });
    const title = await definitions.get('humanink-title')!.handler({
      rawInput: '{"projectId":"project_1","sourceVersionId":"version_source","count":5}',
      signal,
    });
    const brief = await definitions.get('humanink-brief')!.handler({
      rawInput: '{"projectId":"project_1","sourceVersionId":"version_source"}',
      signal,
    });
    const outline = await definitions.get('humanink-outline')!.handler({
      rawInput: '{"projectId":"project_1","briefVersionId":"version_brief"}',
      signal,
    });
    const draft = await definitions.get('humanink-draft')!.handler({
      rawInput: '{"projectId":"project_1","briefVersionId":"version_brief","outlineVersionId":"version_outline"}',
      signal,
    });
    const humanized = await definitions.get('humanink-humanize')!.handler({
      rawInput: '{"projectId":"project_1","versionId":"version_draft","direction":"更自然具体","protectedFields":["品牌名"],"sourceRefs":["source://1"]}',
      signal,
    });
    const reviewed = await definitions.get('humanink-review')!.handler({
      rawInput: '{"projectId":"project_1","versionId":"version_humanized","focus":"核对事实","protectedFields":["品牌名"],"sourceRefs":["source://1"]}',
      signal,
    });

    expect(created.kind).toBe('success');
    expect(parseJsonResult(created)).toEqual({ projectId: 'project_1', sourceVersionId: 'version_source' });
    expect(createProject).toHaveBeenCalledWith({
      title: '社区咖啡店如何留下熟客',
      source: { title: '原始标题', body: '原始正文' },
    });
    expect(generateTitles).toHaveBeenCalledWith(
      { projectId: 'project_1', sourceVersionId: 'version_source', count: 5 },
      signal,
    );
    expect(generateBrief).toHaveBeenCalledWith(
      { projectId: 'project_1', sourceVersionId: 'version_source' },
      signal,
    );
    expect(generateOutline).toHaveBeenCalledWith(
      { projectId: 'project_1', briefVersionId: 'version_brief' },
      signal,
    );
    expect(generateDraft).toHaveBeenCalledWith(
      { projectId: 'project_1', briefVersionId: 'version_brief', outlineVersionId: 'version_outline' },
      signal,
    );
    expect(humanizeContent).toHaveBeenCalledWith(
      {
        projectId: 'project_1',
        versionId: 'version_draft',
        direction: '更自然具体',
        protectedFields: ['品牌名'],
        sourceRefs: ['source://1'],
      },
      signal,
    );
    expect(reviewContent).toHaveBeenCalledWith(
      {
        projectId: 'project_1',
        versionId: 'version_humanized',
        focus: '核对事实',
        protectedFields: ['品牌名'],
        sourceRefs: ['source://1'],
      },
      signal,
    );
    expect(parseJsonResult(title)).toEqual({ taskId: 'task_title', status: 'queued' });
    expect(parseJsonResult(brief)).toEqual({ taskId: 'task_brief', status: 'queued' });
    expect(parseJsonResult(outline)).toEqual({ taskId: 'task_outline', status: 'queued' });
    expect(parseJsonResult(draft)).toEqual({ taskId: 'task_draft', status: 'queued' });
    expect(parseJsonResult(humanized)).toEqual({ taskId: 'task_humanize', status: 'queued' });
    expect(parseJsonResult(reviewed)).toEqual({ taskId: 'task_review', status: 'queued' });
  });

  it('validates and narrows command fields before calling HumanInkApplication', async () => {
    const { definitions, registry } = createRegistry();
    const app = application();
    registerHumanInkCommands(registry, app);
    const cases = [
      ['humanink-create', '{"title":"标题","source":{"title":"原文","body":42}}', app.createProject],
      ['humanink-title', '{"projectId":"project_1","count":11}', app.generateTitles],
      ['humanink-brief', '{"projectId":"project_1","sourceVersionId":"source_1","protectedFields":[1]}', app.generateBrief],
      ['humanink-outline', '{"projectId":"project_1","briefVersionId":"brief_1","extraDirection":42}', app.generateOutline],
      ['humanink-draft', '{"projectId":"project_1","briefVersionId":"brief_1","outlineVersionId":"outline_1","length":"huge"}', app.generateDraft],
      ['humanink-humanize', '{"projectId":"project_1","versionId":42}', app.humanizeContent],
      ['humanink-review', '{"projectId":"project_1","versionId":"version_1","unknown":true}', app.reviewContent],
    ] as const;

    for (const [name, rawInput, method] of cases) {
      const result = await definitions.get(name)!.handler({ rawInput });
      expect(result.kind).toBe('error');
      expect(parseJsonResult(result)).toMatchObject({ code: 'INVALID_INPUT' });
      expect(method).not.toHaveBeenCalled();
    }
  });
  it('returns a safe structured error for invalid JSON without leaking a stack', async () => {
    const { definitions, registry } = createRegistry();
    const app = application();
    registerHumanInkCommands(registry, app);

    const result = await definitions.get('humanink-title')!.handler({ rawInput: '{not-json' });

    expect(result.kind).toBe('error');
    expect(parseJsonResult(result)).toEqual({
      code: 'INVALID_INPUT',
      message: '输入格式错误，请提供有效的 JSON 对象。',
    });
    expect(result.text).not.toContain('stack');
    expect(app.generateTitles).not.toHaveBeenCalled();
  });

  it('queries tasks and returns a backward-compatible cancellation-request snapshot for repeated cancel commands', async () => {
    const runtime = new TaskRuntime({
      idFactory: (prefix) => `${prefix}_command_cancel`,
      clock: () => new Date('2026-09-01T02:00:00.000Z'),
    });
    let releaseOperation: (() => void) | undefined;
    const operationRelease = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const task = runtime.start(
      { projectId: 'project_1', type: 'draft' },
      async ({ signal }) => {
        await operationRelease;
        if (signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return { ok: true };
      },
    );
    await runtime.waitForStatus(task.id, 'running');

    const getTask = vi.fn((taskId: string) => runtime.get(taskId));
    const cancelTask = vi.fn((taskId: string) => runtime.cancel(taskId));
    const { definitions, registry } = createRegistry();
    registerHumanInkCommands(registry, application({ getTask, cancelTask }));

    const queried = await definitions.get('humanink-task')!.handler({ rawInput: task.id });
    const cancelled = await definitions.get('humanink-cancel')!.handler({
      rawInput: JSON.stringify({ taskId: task.id }),
    });
    const repeated = await definitions.get('humanink-cancel')!.handler({ rawInput: task.id });

    expect(queried.kind).toBe('success');
    expect(parseJsonResult(queried)).toMatchObject({ id: task.id, status: 'running' });
    expect(cancelTask).toHaveBeenCalledTimes(2);
    expect(cancelled.kind).toBe('success');
    expect(parseJsonResult(cancelled)).toMatchObject({
      id: task.id,
      status: 'running',
      cancellationRequested: true,
      cancelAccepted: true,
      cancelRequestedAt: '2026-09-01T02:00:00.000Z',
    });
    expect(repeated.kind).toBe('success');
    expect(parseJsonResult(repeated)).toMatchObject({
      id: task.id,
      status: 'running',
      cancellationRequested: true,
      cancelAccepted: true,
    });

    releaseOperation?.();
    await expect(runtime.waitForTerminal(task.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('exports Markdown with a short version id and hides application errors', async () => {
    const exportVersion = vi.fn()
      .mockResolvedValueOnce('# 标题\n\n正文\n')
      .mockRejectedValueOnce(new Error('Content version not found: secret-version'));
    const { definitions, registry } = createRegistry();
    registerHumanInkCommands(registry, application({ exportVersion }));

    const exported = await definitions.get('humanink-export')!.handler({ rawInput: 'version_1' });
    const failed = await definitions.get('humanink-export')!.handler({
      rawInput: '{"versionId":"missing"}',
    });

    expect(exportVersion).toHaveBeenNthCalledWith(1, 'version_1');
    expect(exportVersion).toHaveBeenNthCalledWith(2, 'missing');
    expect(exported).toEqual({ kind: 'success', text: '# 标题\n\n正文\n' });
    expect(failed.kind).toBe('error');
    expect(parseJsonResult(failed)).toEqual({
      code: 'COMMAND_FAILED',
      message: '命令执行失败，请检查输入或资源状态后重试。',
    });
    expect(failed.text).not.toContain('secret-version');
    expect(failed.text).not.toContain('Error');
  });
});
