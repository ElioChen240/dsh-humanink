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
  requireVersionKind,
  resolveSignal,
  stringList,
  type WritingExecutionOptions,
  type WritingUseCaseDependencies,
  type WritingVersionMetadataInput,
  type WritingVersionResult,
} from './contracts.js';
import type { BriefOutput } from './brief-generation.js';

export interface OutlineSection {
  readonly heading: string;
  readonly purpose: string;
  readonly keyPoints: readonly string[];
}

export interface OutlineOutput {
  readonly title: string;
  readonly sections: readonly OutlineSection[];
  readonly ending: string;
}

export interface OutlineGenerationInput extends WritingVersionMetadataInput {
  readonly projectId: string;
  readonly briefVersionId: string;
  readonly extraDirection?: string;
}

export type OutlineGenerationResult = WritingVersionResult<OutlineOutput>;

const promptTemplateVersion = 'outline.zh.v1';
const outputSchema = modelRequestSchema(
  ['title', 'sections', 'ending'],
  {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'purpose', 'keyPoints'],
        properties: {
          heading: { type: 'string' },
          purpose: { type: 'string' },
          keyPoints: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    ending: { type: 'string' },
  },
);

function validateBriefInput(value: unknown): BriefOutput {
  const object = objectWithExactKeys(
    value,
    ['title', 'audience', 'objective', 'angle', 'keyPoints', 'questions'],
    'brief version',
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

function validateOutline(value: unknown): OutlineOutput {
  const object = objectWithExactKeys(value, ['title', 'sections', 'ending'], 'outline output');
  if (!Array.isArray(object.sections) || object.sections.length === 0) {
    throw new TypeError('outline.sections must contain at least one section');
  }
  const sections = object.sections.map((section, index) => {
    const item = objectWithExactKeys(section, ['heading', 'purpose', 'keyPoints'], `outline.sections[${index}]`);
    return {
      heading: nonEmptyString(item.heading, `outline.sections[${index}].heading`),
      purpose: nonEmptyString(item.purpose, `outline.sections[${index}].purpose`),
      keyPoints: stringList(item.keyPoints, `outline.sections[${index}].keyPoints`),
    };
  });
  return {
    title: nonEmptyString(object.title, 'outline.title'),
    sections,
    ending: nonEmptyString(object.ending, 'outline.ending'),
  };
}

export class OutlineGenerationUseCase {
  constructor(private readonly dependencies: WritingUseCaseDependencies) {}

  async execute(input: OutlineGenerationInput, options: WritingExecutionOptions = {}): Promise<OutlineGenerationResult> {
    const signal = resolveSignal(options.signal);
    abortIfNeeded(signal);
    const briefVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.briefVersionId,
      'Brief',
    );
    requireVersionKind(briefVersion, 'brief', 'Brief');
    const brief = validateBriefInput(parseStoredJson<unknown>(briefVersion, 'Brief'));
    const request: LlmRequest = createRequest({
      task: 'outline',
      promptTemplateVersion,
      system: '你是 HumanInk 的中文文章结构编辑。只根据已确认的内容简报组织可编辑大纲。',
      input: {
        projectId: input.projectId,
        briefVersionId: input.briefVersionId,
        brief,
        ...(input.extraDirection === undefined ? {} : { extraDirection: input.extraDirection }),
        ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
        ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
      },
      outputSchema,
    }, options, signal);
    const response = await this.dependencies.llmProvider.generate<unknown>(request);
    abortIfNeeded(signal);
    const output = validateOutline(response.value);
    abortIfNeeded(signal);
    const content: TextContentInput = {
      title: output.title,
      body: JSON.stringify(output),
    };
    const version = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.briefVersionId,
      kind: 'outline',
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
      parentVersionId: input.briefVersionId,
      version,
      output,
    };
  }
}
