import type { LlmRequest } from '../ports/llm-provider.js';
import type {
  ContentVersion,
  ContentVersionKind,
  TextContentInput,
} from '../versioning/content-version.js';
import {
  abortIfNeeded,
  buildModelInfo,
  createRequest,
  modelRequestSchema,
  nonEmptyString,
  objectWithExactKeys,
  requireProjectVersion,
  resolveSignal,
  type WritingExecutionOptions,
  type WritingUseCaseDependencies,
  type WritingVersionMetadataInput,
  type WritingVersionResult,
} from '../writing/contracts.js';

export type ReviewVerdict = 'pass' | 'needs_revision';

export type ReviewFindingCategory =
  | 'title_alignment'
  | 'unsupported_claim'
  | 'template_language'
  | 'repetition'
  | 'clarity'
  | 'protected_field'
  | 'manual_confirmation'
  | 'structure'
  | 'style'
  | 'speculation'
  | 'privacy';

export type ReviewFindingSeverity = 'info' | 'warning' | 'error';

export interface ReviewFinding {
  readonly category: ReviewFindingCategory;
  readonly severity: ReviewFindingSeverity;
  readonly excerpt: string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface ReviewOutput {
  readonly verdict: ReviewVerdict;
  readonly summary: string;
  readonly findings: readonly ReviewFinding[];
}

export interface ReviewInput extends WritingVersionMetadataInput {
  readonly projectId: string;
  readonly versionId: string;
  readonly focus?: string;
}

export type ReviewResult = WritingVersionResult<ReviewOutput>;

const promptTemplateVersion = 'review.zh.v2';
const verdicts: readonly ReviewVerdict[] = ['pass', 'needs_revision'];
const categories: readonly ReviewFindingCategory[] = [
  'title_alignment',
  'unsupported_claim',
  'template_language',
  'repetition',
  'clarity',
  'protected_field',
  'manual_confirmation',
  'structure',
  'style',
  'speculation',
  'privacy',
];
const severities: readonly ReviewFindingSeverity[] = ['info', 'warning', 'error'];
const reviewTargetKinds = [
  'source',
  'draft',
  'humanized',
] as const satisfies readonly ContentVersionKind[];

const categoryLabels: Record<ReviewFindingCategory, string> = {
  title_alignment: '标题兑现',
  unsupported_claim: '事实依据',
  template_language: '模板化表达',
  repetition: '重复内容',
  clarity: '清晰度',
  protected_field: '保护字段',
  manual_confirmation: '人工确认',
  structure: '结构问题',
  style: '表达风格',
  speculation: '推测标记',
  privacy: '隐私风险',
};

const severityLabels: Record<ReviewFindingSeverity, string> = {
  info: '提示',
  warning: '警告',
  error: '错误',
};

const verdictLabels: Record<ReviewVerdict, string> = {
  pass: '通过',
  needs_revision: '需要修订',
};

const outputSchema = modelRequestSchema(
  ['verdict', 'summary', 'findings'],
  {
    verdict: { type: 'string', enum: verdicts },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'excerpt', 'message'],
        properties: {
          category: { type: 'string', enum: categories },
          severity: { type: 'string', enum: severities },
          excerpt: { type: 'string' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
);

function enumValue<T extends string>(
  value: unknown,
  supported: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !supported.includes(value as T)) {
    throw new TypeError(`${field} has an unsupported value`);
  }
  return value as T;
}

function validateFinding(value: unknown, index: number): ReviewFinding {
  const initial = objectWithExactKeys(
    value,
    value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'suggestion')
      ? ['category', 'severity', 'excerpt', 'message', 'suggestion']
      : ['category', 'severity', 'excerpt', 'message'],
    `review.findings[${index}]`,
  );

  const finding = {
    category: enumValue(initial.category, categories, `review.findings[${index}].category`),
    severity: enumValue(initial.severity, severities, `review.findings[${index}].severity`),
    excerpt: nonEmptyString(initial.excerpt, `review.findings[${index}].excerpt`),
    message: nonEmptyString(initial.message, `review.findings[${index}].message`),
  };
  if (!Object.prototype.hasOwnProperty.call(initial, 'suggestion')) {
    return finding;
  }
  return {
    ...finding,
    suggestion: nonEmptyString(initial.suggestion, `review.findings[${index}].suggestion`),
  };
}

function normalizeForLocation(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

function findMissingProtectedFields(
  title: string,
  body: string,
  protectedFields: readonly string[],
): readonly string[] {
  const article = `${title}\n\n${body}`;
  return protectedFields.filter((field) => !article.includes(field));
}

function validateFindingLocations(
  findings: readonly ReviewFinding[],
  title: string,
  body: string,
  protectedFields: readonly string[],
): void {
  const normalizedArticle = normalizeForLocation(`${title}\n\n${body}`);
  const normalizedMissingProtectedFields = new Set(
    findMissingProtectedFields(title, body, protectedFields).map(normalizeForLocation),
  );
  findings.forEach((finding, index) => {
    const normalizedExcerpt = normalizeForLocation(finding.excerpt);
    const reportsMissingProtectedField = finding.category === 'protected_field'
      && normalizedMissingProtectedFields.has(normalizedExcerpt);
    if (
      normalizedExcerpt.length === 0
      || (!reportsMissingProtectedField && !normalizedArticle.includes(normalizedExcerpt))
    ) {
      throw new TypeError(`review.findings[${index}].excerpt cannot be located in the article`);
    }
  });
}

function validateVerdictSemantics(
  verdict: ReviewVerdict,
  findings: readonly ReviewFinding[],
): void {
  const actionableFindings = findings.filter((finding) => finding.severity !== 'info');
  if (verdict === 'pass' && actionableFindings.length > 0) {
    throw new TypeError('review.verdict pass cannot include warning or error findings');
  }
  if (verdict === 'needs_revision' && actionableFindings.length === 0) {
    throw new TypeError('review.verdict needs_revision requires a warning or error finding');
  }
}

function validateReview(
  value: unknown,
  title: string,
  body: string,
  protectedFields: readonly string[],
): ReviewOutput {
  const object = objectWithExactKeys(value, ['verdict', 'summary', 'findings'], 'review output');
  if (!Array.isArray(object.findings)) {
    throw new TypeError('review.findings must be an array');
  }
  const output: ReviewOutput = {
    verdict: enumValue(object.verdict, verdicts, 'review.verdict'),
    summary: nonEmptyString(object.summary, 'review.summary'),
    findings: object.findings.map(validateFinding),
  };
  validateVerdictSemantics(output.verdict, output.findings);
  validateFindingLocations(output.findings, title, body, protectedFields);
  return output;
}

function mergeMetadata(
  inherited: readonly string[],
  additions: readonly string[] | undefined,
  field: 'protectedFields' | 'sourceRefs',
): readonly string[] {
  if (!Array.isArray(inherited)) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  if (additions !== undefined && !Array.isArray(additions)) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  const normalized = [...inherited, ...(additions ?? [])]
    .map((value, index) => nonEmptyString(value, `${field}[${index}]`));
  return [...new Set(normalized)];
}

function requireReviewTarget(version: ContentVersion): void {
  if (!reviewTargetKinds.includes(version.kind as typeof reviewTargetKinds[number])) {
    throw new TypeError('Review target version must have kind source, draft, or humanized');
  }
}

function appendMissingProtectedFieldFindings(
  output: ReviewOutput,
  title: string,
  body: string,
  protectedFields: readonly string[],
): ReviewOutput {
  const missingFields = findMissingProtectedFields(title, body, protectedFields);
  if (missingFields.length === 0) {
    return output;
  }
  const findings: ReviewFinding[] = missingFields.map((field) => ({
    category: 'protected_field',
    severity: 'error',
    excerpt: field,
    message: `保护字段“${field}”未在标题或正文中找到。`,
    suggestion: '恢复该保护字段，或由用户明确确认是否允许删除。',
  }));
  return {
    verdict: 'needs_revision',
    summary: output.summary,
    findings: [...output.findings, ...findings],
  };
}

function readableMarkdownText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

function renderFinding(finding: ReviewFinding, index: number): string {
  return [
    `### ${index + 1}. [${severityLabels[finding.severity]}] ${categoryLabels[finding.category]}`,
    '',
    `- **原文片段：** ${readableMarkdownText(finding.excerpt)}`,
    `- **说明：** ${readableMarkdownText(finding.message)}`,
    ...(finding.suggestion === undefined
      ? []
      : [`- **建议：** ${readableMarkdownText(finding.suggestion)}`]),
  ].join('\n');
}

function renderReviewMarkdown(output: ReviewOutput): string {
  const findings = output.findings.length === 0
    ? '未发现需要记录的问题。'
    : output.findings.map(renderFinding).join('\n\n');
  return [
    '# 发布前复核报告',
    '',
    `**结论：** ${verdictLabels[output.verdict]}`,
    '',
    '## 摘要',
    '',
    readableMarkdownText(output.summary),
    '',
    '## 问题清单',
    '',
    findings,
    '',
  ].join('\n');
}

function createReviewRequest(
  input: ReviewInput,
  title: string,
  body: string,
  protectedFields: readonly string[],
  sourceRefs: readonly string[],
  signal: AbortSignal,
  options: WritingExecutionOptions,
): LlmRequest {
  return createRequest({
    task: 'review',
    promptTemplateVersion,
    system: [
      '你是 HumanInk 的中文内容发布前复核编辑。',
      '检查标题兑现、无依据事实、模板化表达、重复、清晰度、保护字段和需人工确认的内容。',
      '检查结构断层、段落衔接、结尾突然或空泛，以及翻译腔、过度排比和不自然句式。',
      '检查推测性表达是否明确标记，并识别手机号、地址、身份信息等隐私风险。',
      '不要补写未知事实，不要把 AI 检测分数作为发布门槛，只返回符合约定结构的 JSON。',
    ].join('\n'),
    input: {
      projectId: input.projectId,
      versionId: input.versionId,
      title,
      body,
      ...(input.focus === undefined ? {} : { focus: input.focus }),
      protectedFields,
      sourceRefs,
    },
    outputSchema,
  }, options, signal);
}

export class ReviewUseCase {
  constructor(private readonly dependencies: WritingUseCaseDependencies) {}

  async execute(input: ReviewInput, options: WritingExecutionOptions = {}): Promise<ReviewResult> {
    const signal = resolveSignal(options.signal);
    abortIfNeeded(signal);
    const articleVersion = await requireProjectVersion(
      this.dependencies.repository,
      input.projectId,
      input.versionId,
      'Review target',
    );
    requireReviewTarget(articleVersion);
    const protectedFields = mergeMetadata(
      articleVersion.protectedFields,
      input.protectedFields,
      'protectedFields',
    );
    const sourceRefs = mergeMetadata(articleVersion.sourceRefs, input.sourceRefs, 'sourceRefs');
    const response = await this.dependencies.llmProvider.generate<unknown>(createReviewRequest(
      input,
      articleVersion.content.title,
      articleVersion.content.body,
      protectedFields,
      sourceRefs,
      signal,
      options,
    ));
    abortIfNeeded(signal);
    const modelOutput = validateReview(
      response.value,
      articleVersion.content.title,
      articleVersion.content.body,
      protectedFields,
    );
    const output = appendMissingProtectedFieldFindings(
      modelOutput,
      articleVersion.content.title,
      articleVersion.content.body,
      protectedFields,
    );
    abortIfNeeded(signal);
    const content: TextContentInput = {
      title: articleVersion.content.title,
      body: renderReviewMarkdown(output),
    };
    const version = await this.dependencies.projectService.createDerivedVersion({
      projectId: input.projectId,
      parentVersionId: input.versionId,
      kind: 'review',
      content,
      protectedFields,
      sourceRefs,
      promptTemplateVersion,
      modelInfo: buildModelInfo(response),
      createdBy: 'llm',
      userConfirmed: false,
    });
    return {
      status: 'succeeded',
      projectId: input.projectId,
      parentVersionId: input.versionId,
      version,
      output,
    };
  }
}