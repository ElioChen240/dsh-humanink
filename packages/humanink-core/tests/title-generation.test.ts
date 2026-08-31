import { describe, expect, it } from 'vitest';
import { ContentProjectService } from '../src/project/content-project-service.js';
import { InMemoryContentRepository } from '../src/repository/in-memory-content-repository.js';
import type { LlmProvider, LlmRequest } from '../src/ports/llm-provider.js';
import {
  TitleGenerationUseCase,
  type TitleCandidate,
  type TitleGenerationResult,
} from '../src/index.js';

const source = {
  title: '原始文章标题',
  body: '这是一段需要生成标题的原始文章正文。',
};

function createDependencies() {
  let idSequence = 0;
  let timeSequence = 0;
  const factoryDependencies = {
    idFactory: (prefix: string) => `${prefix}_${++idSequence}`,
    clock: () => new Date(`2026-09-01T00:00:0${++timeSequence}.000Z`),
  };
  const repository = new InMemoryContentRepository(factoryDependencies);
  const projectService = new ContentProjectService(repository, factoryDependencies);
  return { factoryDependencies, repository, projectService };
}

function fakeProvider(value: unknown, onRequest?: (request: LlmRequest) => void): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      onRequest?.(request);
      return { value: value as T, providerRequestId: 'provider-request-1', model: 'fake-model' };
    },
  };
}

async function createUseCase(value: unknown, onRequest?: (request: LlmRequest) => void) {
  const dependencies = createDependencies();
  const created = await dependencies.projectService.createProject({
    title: '测试项目',
    source,
  });
  const useCase = new TitleGenerationUseCase({
    repository: dependencies.repository,
    projectService: dependencies.projectService,
    llmProvider: fakeProvider(value, onRequest),
  });
  return { ...dependencies, ...created, useCase };
}

const validCandidates: readonly TitleCandidate[] = [
  {
    title: '  更具体的文章标题  ',
    strategy: 'specificity',
    reason: '直接表达文章解决的问题',
    riskFlags: ['generic'],
  },
  {
    title: '让读者一眼看懂的标题',
    strategy: 'clarity',
    reason: '突出读者收益',
    riskFlags: [],
  },
];

describe('title generation use case', () => {
  it('reads the source, requests structured candidates, and saves a title version', async () => {
    let request: LlmRequest | undefined;
    const { repository, projectService, project, sourceVersion, useCase } = await createUseCase(
      validCandidates,
      (receivedRequest) => {
        request = receivedRequest;
      },
    );
    const signal = new AbortController().signal;

    const result: TitleGenerationResult = await useCase.execute(
      {
        projectId: project.id,
        sourceVersionId: sourceVersion.id,
        brief: '面向普通读者解释核心方法',
        audience: '普通读者',
        count: 2,
      },
      { signal, operationId: 'title-operation-1' },
    );

    expect(request).toMatchObject({
      task: 'title',
      system: expect.any(String),
      promptTemplateVersion: expect.any(String),
      outputSchema: expect.stringContaining('title'),
      signal,
      operationId: 'title-operation-1',
    });
    expect(request?.input).toMatchObject({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
      sourceText: source.body,
      brief: '面向普通读者解释核心方法',
      audience: '普通读者',
      count: 2,
    });

    expect(result.status).toBe('succeeded');
    expect(result.projectId).toBe(project.id);
    expect(result.sourceVersionId).toBe(sourceVersion.id);
    expect(result.versionId).toBe(result.contentVersionId);
    expect(result.candidates[0]?.title).toBe('更具体的文章标题');

    const saved = await repository.getVersion(result.versionId);
    expect(saved).toMatchObject({
      projectId: project.id,
      kind: 'title',
      parentVersionId: sourceVersion.id,
      createdBy: 'llm',
      promptTemplateVersion: expect.any(String),
      modelInfo: expect.objectContaining({
        model: 'fake-model',
        providerRequestId: 'provider-request-1',
      }),
    });
    expect(saved?.content.format).toBe('markdown');
    expect(JSON.parse(saved?.content.body ?? '')).toEqual([
      { ...validCandidates[0], title: '更具体的文章标题' },
      validCandidates[1],
    ]);
    expect((await repository.listVersions(project.id))).toHaveLength(2);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(result.versionId);
    expect(await projectService.createDerivedVersion).toBeTypeOf('function');
  });

  it('does not save a successful version when the model fails', async () => {
    const dependencies = createDependencies();
    const { project, sourceVersion } = await dependencies.projectService.createProject({
      title: '测试项目',
      source,
    });
    const llmProvider: LlmProvider = {
      async generate() {
        throw new Error('provider unavailable');
      },
    };
    const useCase = new TitleGenerationUseCase({
      repository: dependencies.repository,
      projectService: dependencies.projectService,
      llmProvider,
    });

    await expect(
      useCase.execute({ projectId: project.id, sourceVersionId: sourceVersion.id }),
    ).rejects.toThrow('provider unavailable');
    expect(await dependencies.repository.listVersions(project.id)).toHaveLength(1);
  });

  it('rejects an invalid model output without saving a version', async () => {
    const { repository, project, sourceVersion, useCase } = await createUseCase([
      {
        title: 42,
        strategy: 'specificity',
        reason: '不是合法的字符串标题',
        riskFlags: [],
      },
    ]);

    await expect(
      useCase.execute({ projectId: project.id, sourceVersionId: sourceVersion.id }),
    ).rejects.toThrow(/标题候选.*字符串/);
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('rejects a missing source version before calling the model', async () => {
    let called = false;
    const dependencies = createDependencies();
    const { project } = await dependencies.projectService.createProject({
      title: '测试项目',
      source,
    });
    const useCase = new TitleGenerationUseCase({
      repository: dependencies.repository,
      projectService: dependencies.projectService,
      llmProvider: fakeProvider(validCandidates, () => {
        called = true;
      }),
    });

    await expect(
      useCase.execute({ projectId: project.id, sourceVersionId: 'version_missing' }),
    ).rejects.toThrow('源版本不存在');
    expect(called).toBe(false);
    expect(await dependencies.repository.listVersions(project.id)).toHaveLength(1);
  });
  it('does not call the model when the source belongs to another project', async () => {
    let called = false;
    const dependencies = createDependencies();
    const first = await dependencies.projectService.createProject({ title: '项目一', source });
    const second = await dependencies.projectService.createProject({ title: '项目二', source });
    const useCase = new TitleGenerationUseCase({
      repository: dependencies.repository,
      projectService: dependencies.projectService,
      llmProvider: fakeProvider(validCandidates, () => {
        called = true;
      }),
    });

    await expect(useCase.execute({
      projectId: second.project.id,
      sourceVersionId: first.sourceVersion.id,
    })).rejects.toThrow('父版本不属于当前项目');
    expect(called).toBe(false);
    expect(await dependencies.repository.listVersions(second.project.id)).toHaveLength(1);
  });

  it('does not save when cancellation happens during output validation', async () => {
    const controller = new AbortController();
    const candidate = {
      get title() {
        controller.abort();
        return '可用标题';
      },
      strategy: 'clarity',
      reason: '突出读者收益',
      riskFlags: [],
    };
    const { repository, project, sourceVersion } = await createUseCase([candidate]);
    const useCase = new TitleGenerationUseCase({
      repository,
      projectService: new ContentProjectService(repository),
      llmProvider: fakeProvider([candidate]),
    });

    await expect(useCase.execute(
      { projectId: project.id, sourceVersionId: sourceVersion.id },
      { signal: controller.signal },
    )).rejects.toThrow('标题生成已取消');
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });
  it('does not save more candidates than requested', async () => {
    const { repository, project, sourceVersion, useCase } = await createUseCase([
      { title: '标题一', strategy: 'clarity', reason: '说明一', riskFlags: [] },
      { title: '标题二', strategy: 'clarity', reason: '说明二', riskFlags: [] },
    ]);

    await expect(
      useCase.execute({ projectId: project.id, sourceVersionId: sourceVersion.id, count: 1 }),
    ).rejects.toThrow('不能超过请求数量');
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('trims structured fields and rejects empty strategy or reason', async () => {
    const { repository, project, sourceVersion, useCase } = await createUseCase([
      {
        title: '  可用标题  ',
        strategy: '  clarity  ',
        reason: '  突出读者收益  ',
        riskFlags: ['  generic  '],
      },
    ]);

    const result = await useCase.execute({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
    });

    expect(result.candidates).toEqual([
      {
        title: '可用标题',
        strategy: 'clarity',
        reason: '突出读者收益',
        riskFlags: ['generic'],
      },
    ]);
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });

  it('rejects empty structured fields without saving a version', async () => {
    const { repository, project, sourceVersion, useCase } = await createUseCase([
      { title: '标题', strategy: ' ', reason: '说明', riskFlags: [] },
    ]);

    await expect(
      useCase.execute({ projectId: project.id, sourceVersionId: sourceVersion.id }),
    ).rejects.toThrow('strategy 不能为空');
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });
});
