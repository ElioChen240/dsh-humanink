import { describe, expect, it } from 'vitest';
import {
  BriefGenerationUseCase,
  ContentProjectService,
  DraftGenerationUseCase,
  InMemoryContentRepository,
  OutlineGenerationUseCase,
  TitleGenerationUseCase,
  type LlmProvider,
  type LlmRequest,
} from '@humanink/core';
import { HumanInkApplication } from '../src/runtime/humanink-application.js';
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
};

function provider(): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      return { value: responses[request.task] as T, model: 'fake-mvp' };
    },
  };
}

function createApplication() {
  let id = 0;
  let second = 0;
  const dependencies = {
    idFactory: (prefix: string) => `${prefix}_${++id}`,
    clock: () => new Date(`2026-09-01T00:00:${String(++second).padStart(2, '0')}.000Z`),
  };
  const repository = new InMemoryContentRepository(dependencies);
  const projectService = new ContentProjectService(repository, dependencies);
  const llmProvider = provider();
  return new HumanInkApplication({
    repository,
    projectService,
    taskRuntime: new TaskRuntime(dependencies),
    titleUseCase: new TitleGenerationUseCase({ repository, projectService, llmProvider }),
    briefUseCase: new BriefGenerationUseCase({ repository, projectService, llmProvider }),
    outlineUseCase: new OutlineGenerationUseCase({ repository, projectService, llmProvider }),
    draftUseCase: new DraftGenerationUseCase({ repository, projectService, llmProvider }),
  });
}

async function wait(application: HumanInkApplication, taskId: string) {
  const task = await application.waitForTask(taskId);
  expect(task.status).toBe('succeeded');
  return task;
}

describe('HumanInkApplication', () => {
  it('creates a project and runs the title-to-draft MVP workflow as tracked tasks', async () => {
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

    expect(title.contentVersionId).toBeDefined();
    expect(draft.contentVersionId).toBeDefined();
    expect(application.getTask(draftTask.id)).toEqual(draft);
    expect(application.listTasks(created.project.id)).toHaveLength(4);
    expect((await application.getProject(created.project.id))?.currentVersionId).toBe(draft.contentVersionId);
    expect(await application.exportVersion(draft.contentVersionId!)).toContain('# 社区咖啡店留住熟客，靠的不是打折');
  });

  it('rejects an export request for a missing version', async () => {
    const application = createApplication();
    await expect(application.exportVersion('missing')).rejects.toThrow('Content version not found');
  });
});
