import {
  diffMarkdownContent,
  normalizeMarkdownLineEndings,
  type ContentDiffChange,
} from './content-diff.js';

export type ProtectedFieldViolationType = 'changed' | 'missing' | 'source_missing';

export interface ProtectedFieldViolation {
  readonly field: string;
  readonly type: ProtectedFieldViolationType;
  readonly before?: string;
  readonly after?: string;
  readonly message: string;
}

export interface ProtectedFieldValidationResult {
  readonly valid: boolean;
  readonly violations: readonly ProtectedFieldViolation[];
}

function beforeValue(change: ContentDiffChange): string | undefined {
  switch (change.type) {
    case 'modified':
      return change.before;
    case 'removed':
    case 'unchanged':
      return change.value;
    case 'added':
      return undefined;
  }
}

function compactContext(value: string): string {
  return value.replace(/^\s+|\s+$/gu, '');
}

function isSentenceBoundary(character: string): boolean {
  return character === '\n' || ['。', '！', '？', '；', '!', '?'].includes(character);
}

function endsAtSentenceBoundary(value: string): boolean {
  const closingCharacters = new Set(['”', '’', '"', "'", '）', ')', '》', '】', '」', '』']);
  let index = value.length - 1;
  while (index >= 0) {
    const character = value[index]!;
    if (/\s/u.test(character) || closingCharacters.has(character)) {
      index -= 1;
      continue;
    }
    return isSentenceBoundary(character);
  }
  return false;
}

function findSourceContext(source: string, field: string): string {
  const fieldStart = source.indexOf(field);
  if (fieldStart < 0) {
    return field;
  }

  let contextStart = fieldStart;
  while (contextStart > 0 && !isSentenceBoundary(source[contextStart - 1]!)) {
    contextStart -= 1;
  }

  let contextEnd = fieldStart + field.length;
  if (!endsAtSentenceBoundary(field)) {
    while (contextEnd < source.length) {
      const character = source[contextEnd]!;
      contextEnd += 1;
      if (isSentenceBoundary(character)) {
        break;
      }
    }
  }

  return compactContext(source.slice(contextStart, contextEnd));
}

function findFieldChange(changes: readonly ContentDiffChange[], field: string): ContentDiffChange | undefined {
  return changes.find((change) => beforeValue(change)?.includes(field));
}

export function validateProtectedFields(
  before: string,
  after: string,
  protectedFields: readonly string[],
): ProtectedFieldValidationResult {
  const normalizedBefore = normalizeMarkdownLineEndings(before);
  const normalizedAfter = normalizeMarkdownLineEndings(after);
  const uniqueFields: string[] = [];
  const seenFields = new Set<string>();

  protectedFields.forEach((field, index) => {
    const normalizedField = normalizeMarkdownLineEndings(field);
    if (normalizedField.trim().length === 0) {
      throw new TypeError(`protectedFields[${index}] must be a non-empty string`);
    }
    if (!seenFields.has(normalizedField)) {
      seenFields.add(normalizedField);
      uniqueFields.push(normalizedField);
    }
  });

  const sentenceDiff = diffMarkdownContent(normalizedBefore, normalizedAfter, {
    granularity: 'sentence',
  });
  const violations: ProtectedFieldViolation[] = [];

  for (const field of uniqueFields) {
    if (!normalizedBefore.includes(field)) {
      violations.push({
        field,
        type: 'source_missing',
        message: `保护字段“${field}”未出现在原文中。`,
      });
      continue;
    }
    if (normalizedAfter.includes(field)) {
      continue;
    }

    const change = findFieldChange(sentenceDiff.changes, field);
    if (change?.type === 'modified') {
      violations.push({
        field,
        type: 'changed',
        before: compactContext(change.before),
        after: compactContext(change.after),
        message: `保护字段“${field}”已被修改。`,
      });
      continue;
    }

    violations.push({
      field,
      type: 'missing',
      before: findSourceContext(normalizedBefore, field),
      message: `保护字段“${field}”在改写后缺失。`,
    });
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}