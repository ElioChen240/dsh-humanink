import type { LlmRequest } from '../ports/llm-provider.js';
import type { TextContentInput } from '../versioning/content-version.js';
import {
  abortIfNeeded,
  buildModelInfo,
  createRequest,
  modelRequestSchema,
  nonEmptyString,
  objectWithExactKeys,
  parseStoredJson,
  requireProjectVersion,
  resolveSignal,
  stringList,
  type WritingExecutionOptions,
  type WritingUseCaseDependencies,
  type WritingVersionMetadataInput,
  type WritingVersionResult,
} from './contracts.js';
import type { ContentRepository } from '../repository/content-repository.js';
import type { ContentProjectService } from '../project/content-project-service.js';

export interface BriefOutput {
  readonly title: string;
  readonly audience: string;
  readonly objective: string;
  readonly angle: string;
  readonly keyPoints: readonly string[];
  readonly questions: readonly string[];
}

export interface BriefGenerationInput extends WritingVersionMetadataInput {
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly audience?: string;
  readonly selectedTitle?: string;
  readonly objective?: string;
  readonly angle?: string;
  readonly constraints?: string;
}

export type BriefGenerationResult = WritingVersionResult<BriefOutput>;

const promptTemplateVersion = 'brief.zh.v1';
const outputSchema = modelRequestSchema(
  ['title', 'audience', 'objective', 'angle', 'keyPoints', 'questions'],
  {
    title: { type: 'string' },
    audience: { type: 'string' },
    objective: { type: 'string' },
    angle: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
  },
);

function validateBrief(value: unknown): BriefOutput {
  const object = objectWithExactKeys(
    value,
    ['title', 'audience', 'objective', 'angle', 'keyPoints', 'questions'],
    'brief output',
  );
  return {
    title: nonEmptyString(object.title, 'brief.title'),
    audience: nonEmptyString(object.audience, 'brief.audience'),
    objective: nonEmptyString(object.objective, 'brief.objective'),
    angle: nonEmptyString(object.angle, 'brief.angle'),
    keyPoints: stringList(object.keyPoints, 'brief.keyPoints'),
    questions: stringList(object.questions, 'brief.questions'),
  };
}

function createBriefRequest(
  input: BriefGenerationInput,
  sourceTitle: string,
  sourceText: string,
  signal: AbortSignal,
  options: WritingExecutionOptions,
): LlmRequest {
  return createRequest({
    task: 'brief',
    promptTemplateVersion,
    system: '你是 HumanInk 的中文内容策划编辑。只根据输入材料生成结构化内容简报，不补写未知事实。',
    input: {
      projectId: input.projectId,
      sourceVersionId: input.sourceVersionId,
      sourceTitle,
      sourceText,
      ...(input.audience === undefined ? {} : { audience: input.audience }),
      ...(input.selectedTitle === undefined ? {} : { selectedTitle: input.selectedTitle }),
      ...(input.objective === undefined ? {} : { objective: input.objective }),
      ...(input.angle === undefined ? {} : { angle: input.angle }),
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
      ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
    },
    outputSchema,
  }, options, signal);
}

export class BriefGenerationUseCase {
  constructor(private readonly dependencies: WritingUseCaseDependencies) {}

  async execute(input: BriefGenerationInput, options: WritingExecutionOptions = {}): Promise<BriefGenerationResult> {
    const signal = resolveSignal(options.signal);
    abortIfNeeded(signal);
    const sourceVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.sourceVersionId,
      'Source',
    );
    const response = await this.dependencies.llmProvider.generate<unknown>(
      createBriefRequest(input, sourceVersion.content.title, sourceVersion.content.body, signal, options),
    );
    abortIfNeeded(signal);
    const output = validateBrief(response.value);
    abortIfNeeded(signal);
    const content: TextContentInput = {
      title: output.title,
      body: JSON.stringify(output),
    };
    const version = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.sourceVersionId,
      kind: 'brief',
      content,
      createdBy: 'llm',
      ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
      ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
      promptTemplateVersion,
      modelInfo: buildModelInfo(response),
      userConfirmed: false,
    });
    return {
      status: 'succeeded',
      projectId: input.projectId,
      parentVersionId: input.sourceVersionId,
      version,
      output,
    };
  }
}

export type { ContentRepository, ContentProjectService };
export { parseStoredJson };
