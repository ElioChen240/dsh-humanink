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
  type WritingExecutionOptions,
  type WritingUseCaseDependencies,
  type WritingVersionMetadataInput,
  type WritingVersionResult,
} from './contracts.js';
import type { BriefOutput } from './brief-generation.js';
import type { OutlineOutput } from './outline-generation.js';

export interface DraftOutput {
  readonly title: string;
  readonly body: string;
}

export interface DraftGenerationInput extends WritingVersionMetadataInput {
  readonly projectId: string;
  readonly briefVersionId: string;
  readonly outlineVersionId: string;
  readonly tone?: string;
  readonly length?: 'short' | 'medium' | 'long';
}

export type DraftGenerationResult = WritingVersionResult<DraftOutput>;

const promptTemplateVersion = 'draft.zh.v1';
const outputSchema = modelRequestSchema(
  ['title', 'body'],
  {
    title: { type: 'string' },
    body: { type: 'string' },
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
    keyPoints: Array.isArray(object.keyPoints)
      ? object.keyPoints.map((item, index) => nonEmptyString(item, `brief.keyPoints[${index}]`))
      : (() => { throw new TypeError('brief.keyPoints must be an array of strings'); })(),
    questions: Array.isArray(object.questions)
      ? object.questions.map((item, index) => nonEmptyString(item, `brief.questions[${index}]`))
      : (() => { throw new TypeError('brief.questions must be an array of strings'); })(),
  };
}

function validateOutlineInput(value: unknown): OutlineOutput {
  const object = objectWithExactKeys(value, ['title', 'sections', 'ending'], 'outline version');
  if (!Array.isArray(object.sections) || object.sections.length === 0) {
    throw new TypeError('outline.sections must contain at least one section');
  }
  return {
    title: nonEmptyString(object.title, 'outline.title'),
    sections: object.sections.map((section, index) => {
      const item = objectWithExactKeys(section, ['heading', 'purpose', 'keyPoints'], `outline.sections[${index}]`);
      if (!Array.isArray(item.keyPoints)) {
        throw new TypeError(`outline.sections[${index}].keyPoints must be an array of strings`);
      }
      return {
        heading: nonEmptyString(item.heading, `outline.sections[${index}].heading`),
        purpose: nonEmptyString(item.purpose, `outline.sections[${index}].purpose`),
        keyPoints: item.keyPoints.map((point, pointIndex) => nonEmptyString(point, `outline.sections[${index}].keyPoints[${pointIndex}]`)),
      };
    }),
    ending: nonEmptyString(object.ending, 'outline.ending'),
  };
}

function validateDraft(value: unknown): DraftOutput {
  const object = objectWithExactKeys(value, ['title', 'body'], 'draft output');
  return {
    title: nonEmptyString(object.title, 'draft.title'),
    body: nonEmptyString(object.body, 'draft.body'),
  };
}

export class DraftGenerationUseCase {
  constructor(private readonly dependencies: WritingUseCaseDependencies) {}

  async execute(input: DraftGenerationInput, options: WritingExecutionOptions = {}): Promise<DraftGenerationResult> {
    const signal = resolveSignal(options.signal);
    abortIfNeeded(signal);
    const briefVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.briefVersionId,
      'Brief',
    );
    const outlineVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.outlineVersionId,
      'Outline',
    );
    const brief = validateBriefInput(parseStoredJson<unknown>(briefVersion, 'Brief'));
    const outline = validateOutlineInput(parseStoredJson<unknown>(outlineVersion, 'Outline'));
    const request: LlmRequest = createRequest({
      task: 'draft',
      promptTemplateVersion,
      system: '你是 HumanInk 的中文文章作者。根据简报和大纲写出有具体内容、不过度承诺的 Markdown 文章。',
      input: {
        projectId: input.projectId,
        briefVersionId: input.briefVersionId,
        outlineVersionId: input.outlineVersionId,
        brief,
        outline,
        ...(input.tone === undefined ? {} : { tone: input.tone }),
        ...(input.length === undefined ? {} : { length: input.length }),
        ...(input.protectedFields === undefined ? {} : { protectedFields: input.protectedFields }),
        ...(input.sourceRefs === undefined ? {} : { sourceRefs: input.sourceRefs }),
      },
      outputSchema,
    }, options, signal);
    const response = await this.dependencies.llmProvider.generate<unknown>(request);
    abortIfNeeded(signal);
    const output = validateDraft(response.value);
    abortIfNeeded(signal);
    const content: TextContentInput = {
      format: 'markdown',
      title: output.title,
      body: output.body,
    };
    const version = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.outlineVersionId,
      kind: 'draft',
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
      parentVersionId: input.outlineVersionId,
      version,
      output,
    };
  }
}
