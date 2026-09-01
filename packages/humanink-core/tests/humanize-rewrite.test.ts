import { describe, expect, it, vi } from 'vitest';
import { ContentProjectService } from '../src/project/content-project-service.js';
import { InMemoryContentRepository } from '../src/repository/in-memory-content-repository.js';
import type { LlmProvider, LlmRequest } from '../src/ports/llm-provider.js';
import type { ContentVersion, ContentVersionKind } from '../src/versioning/content-version.js';
import {
  HumanizeProtectedFieldValidationError,
  HumanizeRewriteUseCase,
  type HumanizeRewriteOutput,
  type HumanizeRewriteResult,
} from '../src/humanize/humanize-rewrite.js';

const source = {
  title: '社区咖啡店如何留下熟客',
  body: '社区咖啡店每天 8:00 开门，店员也会记得常客少糖。首先，我们要提升服务。其次，我们要打造有温度的社区空间。综上所述，未来值得期待。',
};

const humanizeOutput: HumanizeRewriteOutput = {
  title: '社区咖啡店留住熟客，先把这三件小事做好',
  body: '社区咖啡店每天 8:00 开门，店员也会记得常客少糖。\n\n熟客再来，不一定是因为折扣更大。\n\n比起口号，出品保持稳定，更容易让人下次还愿意进门。',
  changes: [
    {
      before: '首先，我们要提升服务。',
      after: '熟客再来，不一定是因为折扣更大。',
      reason: '删除机械连接词，用具体场景直接进入主题。',
    },
  ],
  questions: ['“出品保持稳定”是否有内部标准可以补充？'],
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
  value: unknown,
  onRequest?: (request: LlmRequest) => void,
): LlmProvider {
  return {
    async generate<T>(request: LlmRequest) {
      onRequest?.(request);
      return {
        value: value as T,
        providerRequestId: 'humanize-request-1',
        model: 'fake-humanize-model',
        usage: { inputTokens: 120, outputTokens: 240 },
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

async function createArticleVersion(
  projectService: ContentProjectService,
  projectId: string,
  parentVersionId: string,
  kind: Extract<ContentVersionKind, 'draft' | 'humanized'>,
): Promise<ContentVersion> {
  return projectService.createDerivedVersion({
    projectId,
    parentVersionId,
    kind,
    content: {
      format: 'markdown',
      title: source.title,
      body: source.body,
    },
    protectedFields: ['少糖', '每天 8:00 开门'],
    sourceRefs: ['interview-note-1', 'shop-handbook-2'],
    createdBy: kind === 'draft' ? 'llm' : 'user',
    userConfirmed: kind === 'humanized',
  });
}

function createUseCase(
  repository: InMemoryContentRepository,
  projectService: ContentProjectService,
  provider: LlmProvider,
): HumanizeRewriteUseCase {
  return new HumanizeRewriteUseCase({
    repository,
    projectService,
    llmProvider: provider,
  });
}

describe('HumanizeRewriteUseCase', () => {
  it('rewrites an article into a new humanized Markdown version and preserves lineage and metadata', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const draftVersion = await createArticleVersion(
      projectService,
      project.id,
      sourceVersion.id,
      'draft',
    );
    const originalDraft = await repository.getVersion(draftVersion.id);
    let request: LlmRequest | undefined;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(
        {
          title: `  ${humanizeOutput.title}  `,
          body: `\n${humanizeOutput.body}\n`,
          changes: humanizeOutput.changes,
          questions: humanizeOutput.questions,
        },
        (received) => { request = received; },
      ),
    );
    const signal = new AbortController().signal;

    const result: HumanizeRewriteResult = await useCase.execute(
      {
        projectId: project.id,
        versionId: draftVersion.id,
        direction: '尽量保留原段落顺序',
        protectedFields: ['少糖', '社区咖啡店'],
        sourceRefs: ['interview-note-1', 'owner-confirmation-3'],
      },
      { signal, operationId: 'humanize-operation-1' },
    );

    expect(request).toMatchObject({
      task: 'humanize',
      promptTemplateVersion: 'humanize.zh.v1',
      outputSchema: expect.stringContaining('changes'),
      signal,
      operationId: 'humanize-operation-1',
    });
    expect(JSON.parse(request?.outputSchema ?? '{}')).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body', 'changes', 'questions'],
    });
    expect(request?.input).toEqual({
      projectId: project.id,
      versionId: draftVersion.id,
      versionKind: 'draft',
      direction: '尽量保留原段落顺序',
      title: source.title,
      body: source.body,
      protectedFields: ['少糖', '每天 8:00 开门', '社区咖啡店'],
      sourceRefs: ['interview-note-1', 'shop-handbook-2', 'owner-confirmation-3'],
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      projectId: project.id,
      parentVersionId: draftVersion.id,
      output: humanizeOutput,
      diff: {
        granularity: 'sentence',
        hasChanges: true,
      },
      protectedFieldValidation: {
        valid: true,
        violations: [],
      },
    });
    expect(result.diff.changes).toContainEqual({
      type: 'modified',
      before: `# ${source.title}`,
      after: `# ${humanizeOutput.title}`,
    });
    expect(result.diff.changes.some((change) => (
      change.type === 'unchanged'
      && change.value.includes('社区咖啡店每天 8:00 开门，店员也会记得常客少糖。')
    ))).toBe(true);
    expect(result.diff.changes).not.toEqual(humanizeOutput.changes);
    expect(result.version).toMatchObject({
      projectId: project.id,
      kind: 'humanized',
      parentVersionId: draftVersion.id,
      createdBy: 'llm',
      userConfirmed: false,
      protectedFields: ['少糖', '每天 8:00 开门', '社区咖啡店'],
      sourceRefs: ['interview-note-1', 'shop-handbook-2', 'owner-confirmation-3'],
      promptTemplateVersion: 'humanize.zh.v1',
      modelInfo: {
        model: 'fake-humanize-model',
        providerRequestId: 'humanize-request-1',
        usage: { inputTokens: 120, outputTokens: 240 },
      },
      content: {
        format: 'markdown',
        title: humanizeOutput.title,
        body: humanizeOutput.body,
      },
    });
    expect(await repository.getVersion(draftVersion.id)).toEqual(originalDraft);
    expect((await repository.listVersions(project.id))).toHaveLength(3);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(result.version.id);
  });

  it.each(['source', 'humanized'] as const)('accepts a %s article version as input', async (kind) => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const inputVersion = kind === 'source'
      ? sourceVersion
      : await createArticleVersion(projectService, project.id, sourceVersion.id, 'humanized');
    const useCase = createUseCase(repository, projectService, fakeProvider(humanizeOutput));

    const result = await useCase.execute({
      projectId: project.id,
      versionId: inputVersion.id,
    });

    expect(result.parentVersionId).toBe(inputVersion.id);
    expect(result.version.kind).toBe('humanized');
    expect(result.version.parentVersionId).toBe(inputVersion.id);
    expect(result.version.protectedFields).toEqual(inputVersion.protectedFields);
    expect(result.version.sourceRefs).toEqual(inputVersion.sourceRefs);
  });

  it('normalizes and deduplicates inherited and input metadata before calling the provider', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const inputVersion = await projectService.createDerivedVersion({
      projectId: project.id,
      parentVersionId: sourceVersion.id,
      kind: 'draft',
      content: source,
      protectedFields: [' 少糖 ', '少糖', ' 每天 8:00 开门 '],
      sourceRefs: [' interview-note-1 ', 'interview-note-1'],
      createdBy: 'llm',
    });
    let request: LlmRequest | undefined;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(humanizeOutput, (received) => { request = received; }),
    );

    const result = await useCase.execute({
      projectId: project.id,
      versionId: inputVersion.id,
      protectedFields: [' 社区咖啡店 ', '少糖'],
      sourceRefs: [' owner-confirmation-3 ', 'interview-note-1'],
    });

    expect(request?.input).toMatchObject({
      protectedFields: ['少糖', '每天 8:00 开门', '社区咖啡店'],
      sourceRefs: ['interview-note-1', 'owner-confirmation-3'],
    });
    expect(result.version.protectedFields).toEqual(['少糖', '每天 8:00 开门', '社区咖啡店']);
    expect(result.version.sourceRefs).toEqual(['interview-note-1', 'owner-confirmation-3']);
  });

  it.each([
    ['protectedFields', { protectedFields: ['   '] }],
    ['sourceRefs', { sourceRefs: ['\t'] }],
  ] as const)('validates inherited %s before calling the provider', async (field, metadata) => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const inputVersion = await projectService.createDerivedVersion({
      projectId: project.id,
      parentVersionId: sourceVersion.id,
      kind: 'draft',
      content: source,
      ...metadata,
      createdBy: 'llm',
    });
    let calls = 0;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(humanizeOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: project.id,
      versionId: inputVersion.id,
    })).rejects.toThrow(`${field}[0] must be a non-empty string`);

    expect(calls).toBe(0);
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });

  it.each([
    ['protectedFields', { protectedFields: ['   '] }],
    ['sourceRefs', { sourceRefs: ['\t'] }],
  ] as const)('validates input %s before calling the provider', async (field, metadata) => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    let calls = 0;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(humanizeOutput, () => { calls += 1; }),
    );

    await expect(useCase.execute({
      projectId: project.id,
      versionId: sourceVersion.id,
      ...metadata,
    })).rejects.toThrow(`${field}[0] must be a non-empty string`);

    expect(calls).toBe(0);
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it.each([
    {
      label: 'changed',
      expectedProviderCalls: 1,
      protectedField: source.title,
      response: {
        ...humanizeOutput,
        title: '社区咖啡店怎样留下熟客',
        body: source.body,
        changes: [{
          before: source.title,
          after: '社区咖啡店怎样留下熟客',
          reason: '调整标题表达。',
        }],
        questions: [],
      },
    },
    {
      label: 'missing',
      expectedProviderCalls: 1,
      protectedField: '综上所述，未来值得期待。',
      response: {
        ...humanizeOutput,
        title: source.title,
        body: source.body.replace('综上所述，未来值得期待。', ''),
        changes: [{
          before: '综上所述，未来值得期待。',
          after: '删除',
          reason: '删除空泛结尾。',
        }],
        questions: [],
      },
    },
    {
      label: 'source_missing',
      expectedProviderCalls: 0,
      protectedField: '营业执照编号 123',
      response: {
        ...humanizeOutput,
        title: source.title,
        body: source.body,
        changes: [],
        questions: [],
      },
    },
  ])('blocks a $label protected-field violation before creating a version', async ({
    label,
    expectedProviderCalls,
    protectedField,
    response,
  }) => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const createDerivedVersion = vi.spyOn(projectService, 'createDerivedVersion');
    let providerCalls = 0;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(response, () => { providerCalls += 1; }),
    );

    let caught: unknown;
    try {
      await useCase.execute({
        projectId: project.id,
        versionId: sourceVersion.id,
        protectedFields: [protectedField],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HumanizeProtectedFieldValidationError);
    expect(caught).toMatchObject({
      code: 'HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED',
      validation: {
        valid: false,
        violations: [
          expect.objectContaining({
            field: protectedField,
            type: label,
          }),
        ],
      },
    });
    expect(providerCalls).toBe(expectedProviderCalls);
    expect(createDerivedVersion).not.toHaveBeenCalled();
    expect(await repository.listVersions(project.id)).toHaveLength(1);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(sourceVersion.id);
  });

  it('rejects a version from another project before calling the provider', async () => {
    const dependencies = createDependencies();
    const first = await dependencies.projectService.createProject({ title: '项目一', source });
    const second = await dependencies.projectService.createProject({ title: '项目二', source });
    let called = false;
    const useCase = createUseCase(
      dependencies.repository,
      dependencies.projectService,
      fakeProvider(humanizeOutput, () => { called = true; }),
    );

    await expect(useCase.execute({
      projectId: second.project.id,
      versionId: first.sourceVersion.id,
    })).rejects.toThrow();

    expect(called).toBe(false);
    expect(await dependencies.repository.listVersions(second.project.id)).toHaveLength(1);
  });

  it('rejects non-article version kinds before calling the provider', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const titleVersion = await projectService.createDerivedVersion({
      projectId: project.id,
      parentVersionId: sourceVersion.id,
      kind: 'title',
      content: { title: '标题候选', body: '[]' },
      createdBy: 'llm',
    });
    let called = false;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(humanizeOutput, () => { called = true; }),
    );

    await expect(useCase.execute({
      projectId: project.id,
      versionId: titleVersion.id,
    })).rejects.toThrow('draft, source, or humanized');

    expect(called).toBe(false);
    expect(await repository.listVersions(project.id)).toHaveLength(2);
  });

  it.each([
    ['malformed JSON text', '{not-valid-json'],
    ['missing questions', { title: '标题', body: '正文', changes: [] }],
    ['unknown top-level field', { ...humanizeOutput, extra: true }],
    ['invalid change shape', {
      ...humanizeOutput,
      changes: [{ before: '原句', after: '新句' }],
    }],
    ['invalid questions', { ...humanizeOutput, questions: '待确认' }],
  ])('rejects %s without saving a version', async (_label, response) => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const useCase = createUseCase(repository, projectService, fakeProvider(response));

    await expect(useCase.execute({
      projectId: project.id,
      versionId: sourceVersion.id,
    })).rejects.toThrow();

    expect(await repository.listVersions(project.id)).toHaveLength(1);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(sourceVersion.id);
  });

  it('does not save a version when the provider fails', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const useCase = createUseCase(repository, projectService, {
      async generate() {
        throw new Error('provider unavailable');
      },
    });

    await expect(useCase.execute({
      projectId: project.id,
      versionId: sourceVersion.id,
    })).rejects.toThrow('provider unavailable');

    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('does not call the provider or save when already cancelled', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const useCase = createUseCase(
      repository,
      projectService,
      fakeProvider(humanizeOutput, () => { called = true; }),
    );

    await expect(useCase.execute({
      projectId: project.id,
      versionId: sourceVersion.id,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(called).toBe(false);
    expect(await repository.listVersions(project.id)).toHaveLength(1);
  });

  it('does not save when cancellation arrives after the provider response', async () => {
    const { repository, projectService, project, sourceVersion } = await createProject();
    const controller = new AbortController();
    const useCase = createUseCase(repository, projectService, {
      async generate<T>() {
        controller.abort();
        return { value: humanizeOutput as T };
      },
    });

    await expect(useCase.execute({
      projectId: project.id,
      versionId: sourceVersion.id,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(await repository.listVersions(project.id)).toHaveLength(1);
    expect((await repository.getProject(project.id))?.currentVersionId).toBe(sourceVersion.id);
  });
});
