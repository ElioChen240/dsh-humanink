import type {
  BriefGenerationInput,
  CreateProjectWithSourceRequest,
  DraftGenerationInput,
  HumanizeRewriteInput,
  OutlineGenerationInput,
  ReviewInput,
  TitleGenerationInput,
} from '@humanink/core';

export class CommandInputError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'CommandInputError';
  }
}

function invalidJson(): CommandInputError {
  return new CommandInputError('INVALID_INPUT', '输入格式错误，请提供有效的 JSON 对象。');
}

function invalidField(field: string): never {
  throw new CommandInputError('INVALID_INPUT', `输入字段无效：${field}。`);
}

function assertKnownKeys(object: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(object).some((key) => !allowed.has(key))) {
    throw new CommandInputError('INVALID_INPUT', '输入包含不支持的字段。');
  }
}

function requiredString(
  object: Record<string, unknown>,
  key: string,
  options: { readonly allowEmpty?: boolean; readonly preserveWhitespace?: boolean } = {},
): string {
  const value = object[key];
  if (typeof value !== 'string') {
    return invalidField(key);
  }
  const normalized = options.preserveWhitespace === true ? value : value.trim();
  if (options.allowEmpty !== true && normalized.trim().length === 0) {
    return invalidField(key);
  }
  return normalized;
}

function optionalString(object: Record<string, unknown>, key: string): string | undefined {
  if (!(key in object)) {
    return undefined;
  }
  return requiredString(object, key);
}

function optionalStringList(object: Record<string, unknown>, key: string): readonly string[] | undefined {
  if (!(key in object)) {
    return undefined;
  }
  const value = object[key];
  if (!Array.isArray(value)) {
    return invalidField(key);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return invalidField(`${key}[${index}]`);
    }
    return item.trim();
  });
}

function optionalObject(
  object: Record<string, unknown>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!(key in object)) {
    return undefined;
  }
  const value = object[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidField(key);
  }
  return value as Record<string, unknown>;
}

function writingMetadata(object: Record<string, unknown>): {
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
} {
  const protectedFields = optionalStringList(object, 'protectedFields');
  const sourceRefs = optionalStringList(object, 'sourceRefs');
  return {
    ...(protectedFields === undefined ? {} : { protectedFields }),
    ...(sourceRefs === undefined ? {} : { sourceRefs }),
  };
}

export function parseJsonObject(rawInput: string): Record<string, unknown> {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    throw invalidJson();
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    throw invalidJson();
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidJson();
  }
  return value as Record<string, unknown>;
}

export function parseCreateProjectInput(object: Record<string, unknown>): CreateProjectWithSourceRequest {
  assertKnownKeys(object, ['title', 'source', 'creatorProfileId', 'metadata']);
  const sourceValue = object.source;
  if (typeof sourceValue !== 'object' || sourceValue === null || Array.isArray(sourceValue)) {
    return invalidField('source');
  }
  const source = sourceValue as Record<string, unknown>;
  assertKnownKeys(source, ['format', 'title', 'body']);
  const format = source.format;
  if (format !== undefined && format !== 'markdown') {
    return invalidField('source.format');
  }
  const creatorProfileId = optionalString(object, 'creatorProfileId');
  const metadata = optionalObject(object, 'metadata');
  return {
    title: requiredString(object, 'title'),
    source: {
      ...(format === undefined ? {} : { format }),
      title: requiredString(source, 'title'),
      body: requiredString(source, 'body', { allowEmpty: true, preserveWhitespace: true }),
    },
    ...(creatorProfileId === undefined ? {} : { creatorProfileId }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function parseTitleGenerationInput(object: Record<string, unknown>): TitleGenerationInput {
  assertKnownKeys(object, ['projectId', 'sourceVersionId', 'brief', 'audience', 'count']);
  const brief = optionalString(object, 'brief');
  const audience = optionalString(object, 'audience');
  const count = object.count;
  if (count !== undefined && (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10)) {
    return invalidField('count');
  }
  return {
    projectId: requiredString(object, 'projectId'),
    sourceVersionId: requiredString(object, 'sourceVersionId'),
    ...(brief === undefined ? {} : { brief }),
    ...(audience === undefined ? {} : { audience }),
    ...(count === undefined ? {} : { count }),
  };
}

export function parseBriefGenerationInput(object: Record<string, unknown>): BriefGenerationInput {
  assertKnownKeys(object, [
    'projectId',
    'sourceVersionId',
    'audience',
    'selectedTitle',
    'objective',
    'angle',
    'constraints',
    'protectedFields',
    'sourceRefs',
  ]);
  const audience = optionalString(object, 'audience');
  const selectedTitle = optionalString(object, 'selectedTitle');
  const objective = optionalString(object, 'objective');
  const angle = optionalString(object, 'angle');
  const constraints = optionalString(object, 'constraints');
  return {
    projectId: requiredString(object, 'projectId'),
    sourceVersionId: requiredString(object, 'sourceVersionId'),
    ...(audience === undefined ? {} : { audience }),
    ...(selectedTitle === undefined ? {} : { selectedTitle }),
    ...(objective === undefined ? {} : { objective }),
    ...(angle === undefined ? {} : { angle }),
    ...(constraints === undefined ? {} : { constraints }),
    ...writingMetadata(object),
  };
}

export function parseOutlineGenerationInput(object: Record<string, unknown>): OutlineGenerationInput {
  assertKnownKeys(object, [
    'projectId',
    'briefVersionId',
    'extraDirection',
    'protectedFields',
    'sourceRefs',
  ]);
  const extraDirection = optionalString(object, 'extraDirection');
  return {
    projectId: requiredString(object, 'projectId'),
    briefVersionId: requiredString(object, 'briefVersionId'),
    ...(extraDirection === undefined ? {} : { extraDirection }),
    ...writingMetadata(object),
  };
}

export function parseDraftGenerationInput(object: Record<string, unknown>): DraftGenerationInput {
  assertKnownKeys(object, [
    'projectId',
    'briefVersionId',
    'outlineVersionId',
    'tone',
    'length',
    'protectedFields',
    'sourceRefs',
  ]);
  const tone = optionalString(object, 'tone');
  const length = object.length;
  if (length !== undefined && length !== 'short' && length !== 'medium' && length !== 'long') {
    return invalidField('length');
  }
  return {
    projectId: requiredString(object, 'projectId'),
    briefVersionId: requiredString(object, 'briefVersionId'),
    outlineVersionId: requiredString(object, 'outlineVersionId'),
    ...(tone === undefined ? {} : { tone }),
    ...(length === undefined ? {} : { length }),
    ...writingMetadata(object),
  };
}

export function parseHumanizeRewriteInput(object: Record<string, unknown>): HumanizeRewriteInput {
  assertKnownKeys(object, [
    'projectId',
    'versionId',
    'direction',
    'protectedFields',
    'sourceRefs',
  ]);
  const direction = optionalString(object, 'direction');
  return {
    projectId: requiredString(object, 'projectId'),
    versionId: requiredString(object, 'versionId'),
    ...(direction === undefined ? {} : { direction }),
    ...writingMetadata(object),
  };
}

export function parseReviewInput(object: Record<string, unknown>): ReviewInput {
  assertKnownKeys(object, [
    'projectId',
    'versionId',
    'focus',
    'protectedFields',
    'sourceRefs',
  ]);
  const focus = optionalString(object, 'focus');
  return {
    projectId: requiredString(object, 'projectId'),
    versionId: requiredString(object, 'versionId'),
    ...(focus === undefined ? {} : { focus }),
    ...writingMetadata(object),
  };
}

export function parseIdentifier(
  rawInput: string,
  property: 'taskId' | 'versionId',
): string {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    throw new CommandInputError('INVALID_INPUT', `请输入有效的 ${property}。`);
  }

  if (!trimmed.startsWith('{')) {
    return trimmed;
  }

  const object = parseJsonObject(trimmed);
  assertKnownKeys(object, [property]);
  return requiredString(object, property);
}
