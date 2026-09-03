import { describe, expect, it, vi } from 'vitest';
import { HUMANINK_TOOL_NAMES, registerHumanInkTools, type HumanInkToolDefinition } from '../src/tools/register.js';
import { HUMANINK_WORKBENCH_SKILL, registerHumanInkWorkbenchSkill } from '../src/skills/workbench-skill.js';
import { humanInkLibraryPromptText, registerHumanInkLibraryPrompt } from '../src/prompts/library-prompt.js';

function service() {
  const task = { id: 'task-1', projectId: 'project-1', operationId: 'operation-1', type: 'title' as const, status: 'queued' as const };
  return {
    listContents: vi.fn(async () => []),
    getContent: vi.fn(async () => null),
    createContent: vi.fn(async () => ({ project: { id: 'project-1' }, sourceVersion: { id: 'version-1' } } as never)),
    saveVersion: vi.fn(async () => ({ id: 'version-2' } as never)),
    startAction: vi.fn(async () => task),
    getTask: vi.fn(async () => task),
    cancelTask: vi.fn(async () => true),
    getSettings: vi.fn(async () => ({ libraryRoot: 'E:/content', writingProfile: '自然、具体' })),
    setLibraryRoot: vi.fn(async (libraryRoot: string) => ({ libraryRoot, writingProfile: '自然、具体' })),
    setWritingProfile: vi.fn(async (writingProfile: string) => ({ libraryRoot: 'E:/content', writingProfile })),
    getCapabilities: vi.fn(async () => ({ core: { state: 'ready' as const }, storage: { state: 'ready' as const }, contentLibrary: { state: 'ready' as const }, llm: { state: 'ready' as const }, remote: { state: 'ready' as const }, credentials: { state: 'unsupported' as const } })),
    getRevision: vi.fn(async () => 1),
  };
}

function registry() {
  const definitions = new Map<string, HumanInkToolDefinition>();
  const disposed: string[] = [];
  return {
    definitions,
    disposed,
    ctx: { tools: { register(definition: HumanInkToolDefinition) { definitions.set(definition.name, definition); return () => disposed.push(definition.name); } } },
  };
}

describe('HumanInk agent integration', () => {
  it('registers the complete MVP tool set and disposes in reverse order', () => {
    const target = registry();
    const dispose = registerHumanInkTools(target.ctx, service());
    expect([...target.definitions.keys()]).toEqual(HUMANINK_TOOL_NAMES);
    expect(HUMANINK_TOOL_NAMES).toEqual([
      'humanink_guide', 'humanink_setup', 'humanink_list_contents', 'humanink_get_content',
      'humanink_create_content', 'humanink_generate_titles', 'humanink_write_draft',
      'humanink_rewrite_content', 'humanink_humanize_content', 'humanink_review_content',
      'humanink_get_task_status',
    ]);
    expect(JSON.stringify([...target.definitions.values()])).not.toMatch(/api[_-]?key|secret|token/i);
    dispose();
    expect(target.disposed).toEqual([...HUMANINK_TOOL_NAMES].reverse());
  });

  it('previews setup changes before applying the exact confirmed values', async () => {
    const app = service();
    const target = registry();
    registerHumanInkTools(target.ctx, app);
    const setup = target.definitions.get('humanink_setup')!;
    const preview = await setup.execute({ libraryRoot: 'E:/new', writingProfile: '克制' }, { signal: new AbortController().signal });
    expect(preview).toMatchObject({ applied: false, proposed: { libraryRoot: 'E:/new', writingProfile: '克制' } });
    expect(app.setLibraryRoot).not.toHaveBeenCalled();
    expect(app.setWritingProfile).not.toHaveBeenCalled();
    const applied = await setup.execute({ apply: true, libraryRoot: 'E:/new', writingProfile: '克制' }, { signal: new AbortController().signal });
    expect(applied).toMatchObject({ applied: true, settings: { libraryRoot: 'E:/new', writingProfile: '克制' } });
    expect(app.setLibraryRoot).toHaveBeenCalledWith('E:/new', expect.any(AbortSignal));
    expect(app.setWritingProfile).toHaveBeenCalledWith('克制', expect.any(AbortSignal));
  });

  it('reports asynchronous writing as started and requires status polling', async () => {
    const target = registry();
    registerHumanInkTools(target.ctx, service());
    const result = await target.definitions.get('humanink_generate_titles')!.execute(
      { contentId: 'project-1', sourceVersionId: 'version-1' },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ status: 'started', taskId: 'task-1', next: 'humanink_get_task_status' });
    expect(JSON.stringify(result)).not.toContain('completed');
  });

  it('registers a model-visible skill that forbids plaintext credentials and false completion claims', () => {
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);
    expect(registerHumanInkWorkbenchSkill({ skills: { register } })).toBe(dispose);
    expect(register).toHaveBeenCalledWith(HUMANINK_WORKBENCH_SKILL);
    expect(HUMANINK_WORKBENCH_SKILL.name).toBe('humanink-workbench');
    expect(HUMANINK_WORKBENCH_SKILL.content).toContain('humanink_guide');
    expect(HUMANINK_WORKBENCH_SKILL.content).toContain('apply=false');
    expect(HUMANINK_WORKBENCH_SKILL.content).toContain('不要让用户在对话中发送 API Key');
    expect(HUMANINK_WORKBENCH_SKILL.content).toContain('任务已启动');
    expect(HUMANINK_WORKBENCH_SKILL.content).toContain('新版本');
  });

  it('keeps the system prompt compact and excludes article bodies and credentials', () => {
    const text = humanInkLibraryPromptText({
      libraryRoot: 'E:/content', writingProfile: '自然、具体', selectedContent: { id: 'project-1', title: '文章标题', stage: 'draft', versionId: 'version-3' }, task: { id: 'task-1', status: 'running' },
    });
    expect(text).toContain('E:/content');
    expect(text).toContain('project-1');
    expect(text).toContain('version-3');
    expect(text).toContain('自然、具体');
    expect(text.length).toBeLessThan(1600);
    expect(text).not.toMatch(/api[_-]?key|bearer|secret/i);
    expect(text).not.toContain('正文全文');
    const section = vi.fn(() => vi.fn());
    registerHumanInkLibraryPrompt({ systemPrompt: { section } }, () => ({ libraryRoot: 'E:/content', writingProfile: '' }));
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ name: 'humanink:library', order: 120, text: expect.any(Function) }));
  });
});
