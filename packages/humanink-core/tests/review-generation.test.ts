import { describe, expect, it } from 'vitest';
import { ContentProjectService } from '../src/project/content-project-service.js';
import { InMemoryContentRepository } from '../src/repository/in-memory-content-repository.js';
import type { LlmProvider, LlmRequest } from '../src/ports/llm-provider.js';
import type { ContentVersionKind } from '../src/versioning/content-version.js';
import {
  ReviewUseCase,
  type ReviewInput,
  type ReviewOutput,
} from '../src/review/index.js';

const source = {
  title: '社区咖啡店如何留下熟客',
  body: '一家街角咖啡店想通过稳定体验和邻里关系，减少对低价促销的依赖。',
};

const articleBody = [
  '在当今竞争激烈的市场环境中，稳定体验很重要，也要做好服务。',
  '某店复购率提升 30%。店主告诉我，手冲售价 28 元，顾客反馈需确认。',
  '文章存在结构断层，突然跳到结论；翻译腔和排比让表达显得生硬。',
  '“可能会带来增长”属于推测，手机号 13800138000 涉及隐私。',
].join('\n\n');

const validOutput: ReviewOutput = {
  verdict: 'needs_revision',
  summary: '标题承诺基本兑现，但数据来源和模板化表达仍需处理。',
  findings: [
    {
      category: 'title_alignment',
      severity: 'info',
      excerpt: '留下熟客',
      message: '正文已覆盖稳定体验和邻里关系。',
    },
    {
      category: 'unsupported_claim',
      severity: 'error',
      excerpt: '复购率提升 30%',
      message: '该数字没有对应来源。',
      suggestion: '补充来源，或改为不带具体比例的描述。',
    },
    {
      category: 'template_language',
      severity: 'warning',
      excerpt: '在当今竞争激烈的市场环境中',
      message: '表达模板化且没有提供信息。',
      suggestion: '直接进入社区咖啡店的具体场景。',
    },
    {
      category: 'protected_field',
      severity: 'error',
      excerpt: '手冲售价 28 元',
      message: '保护字段需要保持原样。',
    },
    {
      category: 'manual_confirmation',
      severity: 'warning',
      excerpt: '店主告诉我',
      message: '该个人经历需要用户确认。',
    },
  ],
};

function createDependencies() {
  let idSequence = 0;
  let timeSequence = 0;
  const factoryDependencies = {
    idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
    clock: () => new Date(`2026-09-01T00:00:${String(++timeSequence).padStart(2, '0')}.000Z`),
  };
  const repository = new InMemoryContentRepository(factoryDependencies);
  const projectService = new ContentProjectService(repository, factoryDependencies);
  return { repository, projectService };
}

function fakeProvider(value: unknown, onRequest?: (request: LlmRequest) => void): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      onRequest?.(request);
      return {
        value: value as T,
        providerRequestId: 'review-request-1',
        model: 'fake-review-model',
        usage: { inputTokens: 120, outputTokens: 80 },
      };
    },
  };
}

async function createTargetVersion() {
  const dependencies = createDependencies();
  const created = await dependencies.projectService.createProject({
    title: source.title,
    source,
  });
  const articleVersion = await dependencies.projectService.createDerivedVersion({
    projectId: created.project.id,
    parentVersionId: created.sourceVersion.id,
    kind: 'draft',
    content: {
      title: source.title,
      body: articleBody,
    },
    protectedFields: [' 手冲售价 28 元 '],
    sourceRefs: [' 访谈记录-1 ', '经营数据-1'],
    createdBy: 'llm',
  });
  return { ...dependencies, ...created, articleVersion };
}

function createUseCase(
  repository: InMemoryContentRepository,
  projectService: ContentProjectService,
  llmProvider: LlmProvider,
): ReviewUseCase {
  return new ReviewUseCase({ repository, projectService, llmProvider });
}

function cloneOutput(): ReviewOutput {
  return JSON.parse(JSON.stringify(validOutput)) as ReviewOutput;
}

const unsupportedKinds = [
  'topic',
  'title',
  'brief',
  'outline',
  'review',
  'restored',
] as const satisfies readonly ContentVersionKind[];

describe('ReviewUseCase', () => {
  it('normalizes metadata, expands the prompt, and stores a readable Markdown report', async () => {
    const requests: LlmRequest[] = [];
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(validOutput, (request) => requests.push(request)),
    );
    const signal = new AbortController().signal;

    const result = await useCase.execute({
      projectId: project.id,
      versionId: articleVersion.id,
      focus: '优先检查标题兑现、数据来源和保护字段。',
      protectedFields: ['手冲售价 28 元', ' 顾客反馈需确认 '],
      sourceRefs: ['经营数据-1', ' 审校备注-1 '],
    }, { signal, operationId: 'review-operation-1' });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      task: 'review',
      promptTemplateVersion: 'review.zh.v2',
      signal,
      operationId: 'review-operation-1',
      input: {
        projectId: project.id,
        versionId: articleVersion.id,
        title: articleVersion.content.title,
        body: articleVersion.content.body,
        focus: '优先检查标题兑现、数据来源和保护字段。',
        protectedFields: ['手冲售价 28 元', '顾客反馈需确认'],
        sourceRefs: ['访谈记录-1', '经营数据-1', '审校备注-1'],
      },
    });
    for (const category of ['structure', 'style', 'speculation', 'privacy']) {
      expect(requests[0]?.outputSchema).toContain(category);
    }
    for (const keyword of ['结构断层', '结尾', '翻译腔', '排比', '推测', '隐私']) {
      expect(requests[0]?.system).toContain(keyword);
    }

    expect(result.output).toEqual(validOutput);
    expect(result.version).toMatchObject({
      kind: 'review',
      parentVersionId: articleVersion.id,
      protectedFields: ['手冲售价 28 元', '顾客反馈需确认'],
      sourceRefs: ['访谈记录-1', '经营数据-1', '审校备注-1'],
      promptTemplateVersion: 'review.zh.v2',
      createdBy: 'llm',
      userConfirmed: false,
    });
    expect(result.version.content.body).toContain('# 发布前复核报告');
    expect(result.version.content.body).toContain('**结论：** 需要修订');
    expect(result.version.content.body).toContain('## 问题清单');
    expect(result.version.content.body).toContain('复购率提升 30%');
    expect(result.version.content.body.trimStart()).not.toMatch(/^\{/u);
    expect(() => JSON.parse(result.version.content.body)).toThrow();
    expect(await repository.getVersion(result.version.id)).toEqual(result.version);
  });

  it('accepts pass with only informational findings and renders the pass verdict', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const output: ReviewOutput = {
      verdict: 'pass',
      summary: '未发现阻塞发布的问题。',
      findings: [{
        category: 'title_alignment',
        severity: 'info',
        excerpt: '留下熟客',
        message: '标题已经兑现。',
      }],
    };
    const useCase = createUseCase(repository, projectService, fakeProvider(output));

    const result = await useCase.execute({ projectId: project.id, versionId: articleVersion.id });

    expect(result.output).toEqual(output);
    expect(result.version.protectedFields).toEqual(['手冲售价 28 元']);
    expect(result.version.sourceRefs).toEqual(['访谈记录-1', '经营数据-1']);
    expect(result.version.content.body).toContain('**结论：** 通过');
  });

  it('accepts normalized excerpts and all extended categories', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const output: ReviewOutput = {
      verdict: 'needs_revision',
      summary: '结构、风格、推测标记和隐私仍需处理。',
      findings: [
        { category: 'structure', severity: 'warning', excerpt: '结构 断层', message: '段落之间缺少过渡。' },
        { category: 'style', severity: 'warning', excerpt: '翻译腔、和排比', message: '句式不够自然。' },
        { category: 'speculation', severity: 'warning', excerpt: '可能会带来增长', message: '需要标记为推测。' },
        { category: 'privacy', severity: 'error', excerpt: '手机号：13800138000', message: '需要删除或脱敏。' },
      ],
    };
    const useCase = createUseCase(repository, projectService, fakeProvider(output));

    const result = await useCase.execute({ projectId: project.id, versionId: articleVersion.id });

    expect(result.output).toEqual(output);
    expect(result.version.content.body).toContain('结构问题');
    expect(result.version.content.body).toContain('隐私风险');
  });

  it('forces needs_revision and adds deterministic errors for missing protected fields', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const providerOutput: ReviewOutput = {
      verdict: 'pass',
      summary: '模型未发现问题。',
      findings: [],
    };
    const useCase = createUseCase(repository, projectService, fakeProvider(providerOutput));

    const result = await useCase.execute({
      projectId: project.id,
      versionId: articleVersion.id,
      protectedFields: [' 不可删除的信息 '],
    });

    expect(result.output.verdict).toBe('needs_revision');
    expect(result.output.findings).toContainEqual({
      category: 'protected_field',
      severity: 'error',
      excerpt: '不可删除的信息',
      message: '保护字段“不可删除的信息”未在标题或正文中找到。',
      suggestion: '恢复该保护字段，或由用户明确确认是否允许删除。',
    });
    expect(result.version.content.body).toContain('不可删除的信息');
    expect(result.version.content.body).toContain('需要修订');
  });

  it('accepts a model protected-field finding whose excerpt is the deterministically missing field', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const modelFinding = {
      category: 'protected_field',
      severity: 'error',
      excerpt: '不可删除的信息',
      message: '保护字段未出现在文章中。',
      suggestion: '恢复该保护字段。',
    } as const;
    const providerOutput: ReviewOutput = {
      verdict: 'needs_revision',
      summary: '发现保护字段缺失。',
      findings: [modelFinding],
    };
    const useCase = createUseCase(repository, projectService, fakeProvider(providerOutput));

    const result = await useCase.execute({
      projectId: project.id,
      versionId: articleVersion.id,
      protectedFields: [' 不可删除的信息 '],
    });

    expect(result.output.findings).toContainEqual(modelFinding);
    expect(result.output.verdict).toBe('needs_revision');
    expect(result.version.content.body).toContain('不可删除的信息');
  });

  it.each(unsupportedKinds)('rejects %s before calling the model', async (kind) => {
    const dependencies = createDependencies();
    const created = await dependencies.projectService.createProject({ title: source.title, source });
    const target = await dependencies.projectService.createDerivedVersion({
      projectId: created.project.id,
      parentVersionId: created.sourceVersion.id,
      kind,
      content: { title: `${kind} 内容`, body: '结构化或非文章内容' },
      createdBy: 'llm',
    });
    let calls = 0;
    const useCase = createUseCase(
      dependencies.repository,
      dependencies.projectService,
      fakeProvider(validOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: created.project.id,
      versionId: target.id,
    })).rejects.toThrow('source, draft, or humanized');

    expect(calls).toBe(0);
    expect(await dependencies.repository.listVersions(created.project.id)).toHaveLength(2);
  });

  it.each([
    ['protectedFields', { protectedFields: ['   '] }],
    ['sourceRefs', { sourceRefs: ['有效来源', '\t'] }],
  ] satisfies readonly [string, Partial<ReviewInput>][])('validates %s before calling the model', async (_label, metadata) => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    let calls = 0;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(validOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: project.id,
      versionId: articleVersion.id,
      ...metadata,
    })).rejects.toThrow('must be a non-empty string');

    expect(calls).toBe(0);
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });

  it('validates inherited metadata before calling the model', async () => {
    const dependencies = createDependencies();
    const created = await dependencies.projectService.createProject({ title: source.title, source });
    const target = await dependencies.projectService.createDerivedVersion({
      projectId: created.project.id,
      parentVersionId: created.sourceVersion.id,
      kind: 'draft',
      content: source,
      protectedFields: ['   '],
      createdBy: 'llm',
    });
    let calls = 0;
    const useCase = createUseCase(
      dependencies.repository,
      dependencies.projectService,
      fakeProvider(validOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: created.project.id,
      versionId: target.id,
    })).rejects.toThrow('protectedFields[0] must be a non-empty string');
    expect(calls).toBe(0);
  });

  it('validates target existence and project ownership before calling the model', async () => {
    const dependencies = createDependencies();
    const first = await dependencies.projectService.createProject({ title: '项目一', source });
    const second = await dependencies.projectService.createProject({ title: '项目二', source });
    let calls = 0;
    const useCase = createUseCase(
      dependencies.repository,
      dependencies.projectService,
      fakeProvider(validOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: second.project.id,
      versionId: first.sourceVersion.id,
    })).rejects.toThrow();
    await expect(useCase.execute({
      projectId: second.project.id,
      versionId: 'missing-version',
    })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it.each([
    ['non-object value', 'not-json'],
    ['extra top-level field', { ...cloneOutput(), score: 88 }],
    ['invalid verdict', { ...cloneOutput(), verdict: 'approved' }],
    ['empty summary', { ...cloneOutput(), summary: '   ' }],
    ['non-array findings', { ...cloneOutput(), findings: {} }],
    ['invalid category', { ...cloneOutput(), findings: [{ ...cloneOutput().findings[0], category: 'legal' }] }],
    ['invalid severity', { ...cloneOutput(), findings: [{ ...cloneOutput().findings[0], severity: 'critical' }] }],
    ['missing finding field', { ...cloneOutput(), findings: [{ category: 'clarity', severity: 'warning', excerpt: '做好服务' }] }],
    ['extra finding field', { ...cloneOutput(), findings: [{ ...cloneOutput().findings[0], confidence: 0.9 }] }],
    ['empty suggestion', { ...cloneOutput(), findings: [{ ...cloneOutput().findings[0], suggestion: '   ' }] }],
    ['pass with warning', {
      verdict: 'pass', summary: '存在问题。', findings: [{ category: 'clarity', severity: 'warning', excerpt: '做好服务', message: '表述抽象。' }],
    }],
    ['needs_revision with no finding', { verdict: 'needs_revision', summary: '需要修改。', findings: [] }],
    ['needs_revision with info only', {
      verdict: 'needs_revision', summary: '需要修改。', findings: [{ category: 'title_alignment', severity: 'info', excerpt: '留下熟客', message: '标题已经兑现。' }],
    }],
    ['unlocatable excerpt', {
      verdict: 'needs_revision', summary: '需要修改。', findings: [{ category: 'clarity', severity: 'warning', excerpt: '正文中不存在的片段', message: '无法定位。' }],
    }],
  ])('rejects %s without saving', async (_label, responseValue) => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const useCase = createUseCase(repository, projectService, fakeProvider(responseValue));

    await expect(useCase.execute({ projectId: project.id, versionId: articleVersion.id })).rejects.toThrow();
    expect(await repository.listVersions(project.id)).toHaveLength(2);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(articleVersion.id);
  });

  it('does not save when the provider fails', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const useCase = createUseCase(repository, projectService, {
      async generate() {
        throw new Error('provider unavailable');
      },
    });

    await expect(useCase.execute({ projectId: project.id, versionId: articleVersion.id }))
      .rejects.toThrow('provider unavailable');
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });

  it('does not call the provider when already cancelled', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(validOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute(
      { projectId: project.id, versionId: articleVersion.id },
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });

  it('does not save when cancelled after the provider response', async () => {
    const { repository, projectService, project, articleVersion } = await createTargetVersion();
    const controller = new AbortController();
    const useCase = createUseCase(repository, projectService, {
      async generate<T>() {
        controller.abort();
        return { value: validOutput as T };
      },
    });

    await expect(useCase.execute(
      { projectId: project.id, versionId: articleVersion.id },
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });
});