import { describe, expect, it } from 'vitest';
import {
  BriefGenerationUseCase,
  ContentProjectService,
  DraftGenerationUseCase,
  HumanizeRewriteUseCase,
  InMemoryContentRepository,
  OutlineGenerationUseCase,
  ReviewUseCase,
  TitleGenerationUseCase,
  type LlmProvider,
  type LlmRequest,
} from '@humanink/core';
import {
  HumanInkApplication,
  HumanInkCapabilityUnavailableError,
} from '../src/runtime/humanink-application.js';
import { TaskRuntime } from '../src/runtime/task-runtime.js';

const responses: Partial<Record<LlmRequest['task'], unknown>> = {
  title: [{
    title: '社区咖啡店留住熟客，靠的不是打折',
    strategy: '反常识',
    reason: '突出经营判断',
    riskFlags: [],
  }],
  brief: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    audience: '社区咖啡店店主',
    objective: '解释稳定体验如何带来复购',
    angle: '从日常动作切入',
    keyPoints: ['稳定出品', '记住偏好'],
    questions: ['如何衡量复购？'],
  },
  outline: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    sections: [{ heading: '先做稳定', purpose: '建立信任', keyPoints: ['标准'] }],
    ending: '从一周实验开始',
  },
  draft: {
    title: '社区咖啡店留住熟客，靠的不是打折',
    body: '很多小店先想到打折。\n\n但熟客更在意的是，每一次到店是否稳定。',
  },
  humanize: {
    title: '熟客不是打折换来的',
    body: '街角小店最容易先想到降价。\n\n可真正让人再来的，往往是咖啡入口的味道和上次一样。',
    changes: [{
      before: '很多小店先想到打折。',
      after: '街角小店最容易先想到降价。',
      reason: '改成更具体自然的表达',
    }],
    questions: [],
  },
  review: {
    verdict: 'pass',
    summary: '标题和正文一致，未发现阻塞发布的问题。',
    findings: [],
  },
};

function provider(): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      return { value: responses[request.task] as T, model: 'fake-mvp' };
    },
  };
}

function createApplicationDependencies() {
  let id = 0;
  let second = 0;
  const dependencies = {
    idFactory: (prefix: string) => `${prefix}_${++id}`,
    clock: () => new Date(`2026-08-31T00:00:${String(++second).padStart(2, '0')}.000Z`),
  };
  const repository = new InMemoryContentRepository(dependencies);
  const projectService = new ContentProjectService(repository, dependencies);
  const llmProvider = provider();
  return {
    repository,
    projectService,
    taskRuntime: new TaskRuntime(dependencies),
    titleUseCase: new TitleGenerationUseCase({ repository, projectService, llmProvider }),
    briefUseCase: new BriefGenerationUseCase({ repository, projectService, llmProvider }),
    outlineUseCase: new OutlineGenerationUseCase({ repository, projectService, llmProvider }),
    draftUseCase: new DraftGenerationUseCase({ repository, projectService, llmProvider }),
    humanizeUseCase: new HumanizeRewriteUseCase({ repository, projectService, llmProvider }),
    reviewUseCase: new ReviewUseCase({ repository, projectService, llmProvider }),
  };
}

function createApplication() {
  return new HumanInkApplication(createApplicationDependencies());
}

async function wait(application: HumanInkApplication, taskId: string) {
  const task = await application.waitForTask(taskId);
  expect(task.status).toBe('succeeded');
  return task;
}

describe('HumanInkApplication', () => {
  it('creates a project and runs the title-to-review workflow as tracked tasks', async () => {
    const application = createApplication();
    const created = await application.createProject({
      title: '社区咖啡店如何留下熟客',
      source: {
        title: '社区咖啡店如何留下熟客',
        body: '一家街角咖啡店想减少对低价促销的依赖。',
      },
    });

    const titleTask = application.generateTitles({
      projectId: created.project.id,
      sourceVersionId: created.sourceVersion.id,
      count: 1,
    });
    const title = await wait(application, titleTask.id);

    const briefTask = application.generateBrief({
      projectId: created.project.id,
      sourceVersionId: created.sourceVersion.id,
    });
    const brief = await wait(application, briefTask.id);

    const outlineTask = application.generateOutline({
      projectId: created.project.id,
      briefVersionId: brief.contentVersionId!,
    });
    const outline = await wait(application, outlineTask.id);

    const draftTask = application.generateDraft({
      projectId: created.project.id,
      briefVersionId: brief.contentVersionId!,
      outlineVersionId: outline.contentVersionId!,
    });
    const draft = await wait(application, draftTask.id);

    const humanizeTask = application.humanizeContent({
      projectId: created.project.id,
      versionId: draft.contentVersionId!,
      direction: '更自然具体',
    });
    const humanized = await wait(application, humanizeTask.id);

    const reviewTask = application.reviewContent({
      projectId: created.project.id,
      versionId: humanized.contentVersionId!,
    });
    const review = await wait(application, reviewTask.id);

    expect(title.contentVersionId).toBeDefined();
    expect(draft.contentVersionId).toBeDefined();
    expect(humanized.contentVersionId).toBeDefined();
    expect(review.contentVersionId).toBeDefined();
    expect(application.getTask(reviewTask.id)).toEqual(review);
    expect(application.listTasks(created.project.id)).toHaveLength(6);
    expect((await application.getProject(created.project.id))?.currentVersionId).toBe(review.contentVersionId);
    expect(await application.exportVersion(humanized.contentVersionId!)).toContain('# 熟客不是打折换来的');
  });

  it('keeps the 0.4 constructor usable without the new capabilities', async () => {
    const dependencies = createApplicationDependencies();
    const {
      humanizeUseCase: _humanizeUseCase,
      reviewUseCase: _reviewUseCase,
      ...legacyDependencies
    } = dependencies;
    const application = new HumanInkApplication(legacyDependencies);
    const created = await application.createProject({
      title: '兼容旧版构造',
      source: { title: '兼容旧版构造', body: '旧调用方仍然可以使用已有能力。' },
    });

    const titleTask = application.generateTitles({
      projectId: created.project.id,
      sourceVersionId: created.sourceVersion.id,
      count: 1,
    });
    const titleResult = await wait(application, titleTask.id);
    expect(titleResult.contentVersionId).toBeDefined();

    let humanizeError: unknown;
    try {
      application.humanizeContent({
        projectId: created.project.id,
        versionId: created.sourceVersion.id,
      });
    } catch (error) {
      humanizeError = error;
    }
    expect(humanizeError).toBeInstanceOf(HumanInkCapabilityUnavailableError);
    expect(humanizeError).toMatchObject({
      code: 'HUMANINK_CAPABILITY_UNAVAILABLE',
      capability: 'humanize',
      message: 'HumanInk capability is unavailable: humanize.',
    });

    let reviewError: unknown;
    try {
      application.reviewContent({
        projectId: created.project.id,
        versionId: created.sourceVersion.id,
      });
    } catch (error) {
      reviewError = error;
    }
    expect(reviewError).toBeInstanceOf(HumanInkCapabilityUnavailableError);
    expect(reviewError).toMatchObject({
      code: 'HUMANINK_CAPABILITY_UNAVAILABLE',
      capability: 'review',
      message: 'HumanInk capability is unavailable: review.',
    });
    expect(application.listTasks(created.project.id)).toHaveLength(1);
  });

  it('rejects an export request for a missing version', async () => {
    const application = createApplication();
    await expect(application.exportVersion('missing')).rejects.toThrow('Content version not found');
  });
});
