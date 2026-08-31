import { describe, expect, it } from 'vitest';
import { ContentProjectService } from '../src/project/content-project-service.js';
import { InMemoryContentRepository } from '../src/repository/in-memory-content-repository.js';
import type { LlmProvider, LlmRequest } from '../src/ports/llm-provider.js';
import {
  BriefGenerationUseCase,
  DraftGenerationUseCase,
  OutlineGenerationUseCase,
  type BriefOutput,
  type DraftOutput,
  type OutlineOutput,
} from '../src/writing/index.js';

const source = {
  title: '社区咖啡店如何留下熟客',
  body: '一家街角咖啡店想通过稳定体验和邻里关系，减少对低价促销的依赖。',
};

const briefOutput: BriefOutput = {
  title: '社区咖啡店如何留下熟客',
  audience: '经营社区型咖啡店的店主',
  objective: '解释小店如何用稳定体验和关系经营提升复购',
  angle: '把留客拆成可观察的日常动作，而不是抽象的品牌口号',
  keyPoints: ['稳定出品', '记住顾客偏好', '建立邻里感'],
  questions: ['目前复购率如何衡量？'],
};

const outlineOutput: OutlineOutput = {
  title: '社区咖啡店如何留下熟客',
  sections: [
    {
      heading: '先把每一次体验做稳定',
      purpose: '说明稳定是复购的前提',
      keyPoints: ['产品标准', '服务节奏'],
    },
    {
      heading: '再让顾客感到被记住',
      purpose: '说明关系如何转化为留存',
      keyPoints: ['识别偏好', '自然互动'],
    },
  ],
  ending: '用三个低成本动作开始一周实验',
};

const draftOutput: DraftOutput = {
  title: '社区咖啡店如何留下熟客',
  body: '很多小店以为留住顾客要靠更大的折扣。\n\n但真正影响复购的，往往是每次到店都能获得的稳定体验。',
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
  return { repository, projectService };
}

function fakeProvider(
  responses: Partial<Record<LlmRequest['task'], unknown>>,
  onRequest?: (request: LlmRequest) => void,
): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      onRequest?.(request);
      if (!(request.task in responses)) {
        throw new Error(`missing response for ${request.task}`);
      }
      return {
        value: responses[request.task] as T,
        providerRequestId: `${request.task}-request-1`,
        model: 'fake-writing-model',
      };
    },
  };
}

async function createProject() {
  const dependencies = createDependencies();
  const created = await dependencies.projectService.createProject({
    title: source.title,
    source,
  });
  return { ...dependencies, ...created };
}

describe('writing core use cases', () => {
  it('generates a structured brief and preserves metadata and request contract', async () => {
    const requests: LlmRequest[] = [];
    const { repository, projectService, project, sourceVersion } = await createProject();
    const useCase = new BriefGenerationUseCase({
      repository,
      projectService,
      llmProvider: fakeProvider({ brief: briefOutput }, (request) => requests.push(request)),
    });

    const result = await useCase.execute(
      {
        projectId: project.id,
        sourceVersionId: sourceVersion.id,
        audience: '社区咖啡店店主',
        selectedTitle: '社区咖啡店留住熟客，靠的不是打折',
        protectedFields: ['复购率数据'],
        sourceRefs: ['user-note-1'],
      },
      { operationId: 'brief-op-1' },
    );

    expect(requests[0]).toMatchObject({
      task: 'brief',
      promptTemplateVersion: expect.any(String),
      outputSchema: expect.stringContaining('keyPoints'),
      signal: expect.any(AbortSignal),
      operationId: 'brief-op-1',
    });
    expect(requests[0]?.input).toMatchObject({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
      sourceTitle: source.title,
      sourceText: source.body,
      audience: '社区咖啡店店主',
      selectedTitle: '社区咖啡店留住熟客，靠的不是打折',
    });
    expect(result.version.parentVersionId).toBe(sourceVersion.id);
    expect(result.version.kind).toBe('brief');
    expect(result.version.protectedFields).toEqual(['复购率数据']);
    expect(result.version.sourceRefs).toEqual(['user-note-1']);
    expect(JSON.parse(result.version.content.body)).toEqual(briefOutput);
  });

  it('generates outline from a brief and draft from an outline, preserving the version chain', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const provider = fakeProvider({ brief: briefOutput, outline: outlineOutput, draft: draftOutput });
    const briefUseCase = new BriefGenerationUseCase({ repository, projectService, llmProvider: provider });
    const outlineUseCase = new OutlineGenerationUseCase({ repository, projectService, llmProvider: provider });
    const draftUseCase = new DraftGenerationUseCase({ repository, projectService, llmProvider: provider });

    const brief = await briefUseCase.execute({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
      sourceRefs: ['research-1'],
      protectedFields: ['事实 A'],
    });
    const outline = await outlineUseCase.execute({
      projectId: project.id,
      briefVersionId: brief.version.id,
      sourceRefs: ['research-1'],
      protectedFields: ['事实 A'],
    });
    const draft = await draftUseCase.execute({
      projectId: project.id,
      briefVersionId: brief.version.id,
      outlineVersionId: outline.version.id,
      sourceRefs: ['research-1'],
      protectedFields: ['事实 A'],
    }, { operationId: 'draft-op-1' });

    expect(outline.version.parentVersionId).toBe(brief.version.id);
    expect(draft.version.parentVersionId).toBe(outline.version.id);
    expect(draft.version.kind).toBe('draft');
    expect(draft.version.content).toEqual({
      format: 'markdown',
      title: draftOutput.title,
      body: draftOutput.body,
    });
    expect(draft.version.protectedFields).toEqual(['事实 A']);
    expect(draft.version.sourceRefs).toEqual(['research-1']);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(draft.version.id);
    expect(await repository.listVersions(project.id)).toHaveLength(4);
  });

  it('rejects an invalid structured response without saving a version', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const useCase = new BriefGenerationUseCase({
      repository,
      projectService,
      llmProvider: fakeProvider({ brief: { ...briefOutput, keyPoints: 'not-an-array' } }),
    });

    await expect(useCase.execute({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
    })).rejects.toThrow();
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('does not call the model or save when the source belongs to another project', async () => {
    const dependencies = createDependencies();
    const first = await dependencies.projectService.createProject({ title: '第一个项目', source });
    const second = await dependencies.projectService.createProject({ title: '第二个项目', source });
    let called = false;
    const useCase = new BriefGenerationUseCase({
      repository: dependencies.repository,
      projectService: dependencies.projectService,
      llmProvider: fakeProvider({ brief: briefOutput }, () => { called = true; }),
    });

    await expect(useCase.execute({
      projectId: second.project.id,
      sourceVersionId: first.sourceVersion.id,
    })).rejects.toThrow();
    expect(called).toBe(false);
    expect(await dependencies.repository.listVersions(second.project.id)).toHaveLength(1);
  });

  it('does not save when the provider fails or the operation is cancelled', async () => {
    const failed = await createProject();
    const failedUseCase = new BriefGenerationUseCase({
      repository: failed.repository,
      projectService: failed.projectService,
      llmProvider: {
        async generate() {
          throw new Error('provider unavailable');
        },
      },
    });
    await expect(failedUseCase.execute({
      projectId: failed.project.id,
      sourceVersionId: failed.sourceVersion.id,
    })).rejects.toThrow('provider unavailable');
    expect(await failed.repository.listVersions(failed.project.id)).toHaveLength(1);

    const cancelled = await createProject();
    const controller = new AbortController();
    controller.abort();
    const cancelledUseCase = new OutlineGenerationUseCase({
      repository: cancelled.repository,
      projectService: cancelled.projectService,
      llmProvider: fakeProvider({ outline: outlineOutput }),
    });
    await expect(cancelledUseCase.execute({
      projectId: cancelled.project.id,
      briefVersionId: cancelled.sourceVersion.id,
    }, { signal: controller.signal })).rejects.toThrow();
    expect(await cancelled.repository.listVersions(cancelled.project.id)).toHaveLength(1);
  });

  it('does not save when cancellation arrives after the provider response', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const controller = new AbortController();
    const useCase = new BriefGenerationUseCase({
      repository,
      projectService,
      llmProvider: {
        async generate<T>() {
          controller.abort();
          return { value: briefOutput as T };
        },
      },
    });

    await expect(useCase.execute({
      projectId: project.id,
      sourceVersionId: sourceVersion.id,
    }, { signal: controller.signal })).rejects.toThrow();
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('rejects a draft when either referenced writing version is from another project', async () => {
    const first = await createProject();
    const second = await createProject();
    const useCase = new DraftGenerationUseCase({
      repository: second.repository,
      projectService: second.projectService,
      llmProvider: fakeProvider({ draft: draftOutput }),
    });

    await expect(useCase.execute({
      projectId: second.project.id,
      briefVersionId: first.sourceVersion.id,
      outlineVersionId: second.sourceVersion.id,
    })).rejects.toThrow();
    expect(await second.repository.listVersions(second.project.id)).toHaveLength(1);
  });
});
