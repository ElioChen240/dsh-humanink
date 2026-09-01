export type ContentDiffGranularity = 'paragraph' | 'sentence';

export interface ContentDiffOptions {
  readonly granularity?: ContentDiffGranularity;
}

export interface UnchangedContentDiffChange {
  readonly type: 'unchanged';
  readonly value: string;
}

export interface AddedContentDiffChange {
  readonly type: 'added';
  readonly value: string;
}

export interface RemovedContentDiffChange {
  readonly type: 'removed';
  readonly value: string;
}

export interface ModifiedContentDiffChange {
  readonly type: 'modified';
  readonly before: string;
  readonly after: string;
}

export type ContentDiffChange =
  | UnchangedContentDiffChange
  | AddedContentDiffChange
  | RemovedContentDiffChange
  | ModifiedContentDiffChange;

export interface ContentDiffResult {
  readonly granularity: ContentDiffGranularity;
  readonly hasChanges: boolean;
  readonly changes: readonly ContentDiffChange[];
}

interface PendingDiffHunk {
  readonly removed: string[];
  readonly added: string[];
}

const paragraphSeparator = /(\n(?:[\t ]*\n)+)/u;
const sentenceEndings = new Set(['。', '！', '？', '；', '!', '?']);
const closingPunctuation = new Set(['”', '’', '"', "'", '）', ')', '》', '】', '」', '』']);

export function normalizeMarkdownLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/gu, '\n');
}

function splitParagraphs(markdown: string): string[] {
  if (markdown.length === 0) {
    return [];
  }
  return markdown.split(paragraphSeparator).filter((part) => part.length > 0);
}

function isBlankLineRun(value: string): boolean {
  return value.includes('\n') && value.trim().length === 0;
}

function splitSentenceBlock(block: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  let index = 0;

  while (index < block.length) {
    const character = block[index];
    if (character === '\n') {
      sentences.push(block.slice(start, index + 1));
      start = index + 1;
      index += 1;
      continue;
    }

    if (character !== undefined && sentenceEndings.has(character)) {
      let end = index + 1;
      while (end < block.length) {
        const next = block[end];
        if (next === undefined || !closingPunctuation.has(next)) {
          break;
        }
        end += 1;
      }
      while (end < block.length && (block[end] === ' ' || block[end] === '\t')) {
        end += 1;
      }
      sentences.push(block.slice(start, end));
      start = end;
      index = end;
      continue;
    }

    index += 1;
  }

  if (start < block.length) {
    sentences.push(block.slice(start));
  }

  return sentences.filter((sentence) => sentence.length > 0);
}

function tokenize(markdown: string, granularity: ContentDiffGranularity): string[] {
  const paragraphs = splitParagraphs(markdown);
  if (granularity === 'paragraph') {
    return paragraphs;
  }

  return paragraphs.flatMap((paragraph) => (
    isBlankLineRun(paragraph) ? [paragraph] : splitSentenceBlock(paragraph)
  ));
}

function buildLongestCommonSubsequenceMatrix(before: readonly string[], after: readonly string[]): Uint32Array[] {
  const matrix = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const row = matrix[beforeIndex]!;
    const nextRow = matrix[beforeIndex + 1]!;
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (before[beforeIndex] === after[afterIndex]) {
        row[afterIndex] = (nextRow[afterIndex + 1] ?? 0) + 1;
      } else {
        row[afterIndex] = Math.max(
          nextRow[afterIndex] ?? 0,
          row[afterIndex + 1] ?? 0,
        );
      }
    }
  }

  return matrix;
}

function appendChange(changes: ContentDiffChange[], change: ContentDiffChange): void {
  const previous = changes.at(-1);

  switch (change.type) {
    case 'unchanged':
      if (previous?.type === 'unchanged') {
        changes[changes.length - 1] = { type: 'unchanged', value: previous.value + change.value };
      } else {
        changes.push(change);
      }
      return;
    case 'added':
      if (previous?.type === 'added') {
        changes[changes.length - 1] = { type: 'added', value: previous.value + change.value };
      } else {
        changes.push(change);
      }
      return;
    case 'removed':
      if (previous?.type === 'removed') {
        changes[changes.length - 1] = { type: 'removed', value: previous.value + change.value };
      } else {
        changes.push(change);
      }
      return;
    case 'modified':
      changes.push(change);
  }
}
function flushHunk(changes: ContentDiffChange[], hunk: PendingDiffHunk): void {
  const modifiedCount = Math.min(hunk.removed.length, hunk.added.length);
  for (let index = 0; index < modifiedCount; index += 1) {
    appendChange(changes, {
      type: 'modified',
      before: hunk.removed[index]!,
      after: hunk.added[index]!,
    });
  }
  for (let index = modifiedCount; index < hunk.removed.length; index += 1) {
    appendChange(changes, { type: 'removed', value: hunk.removed[index]! });
  }
  for (let index = modifiedCount; index < hunk.added.length; index += 1) {
    appendChange(changes, { type: 'added', value: hunk.added[index]! });
  }
  hunk.removed.length = 0;
  hunk.added.length = 0;
}

export function diffMarkdownContent(
  before: string,
  after: string,
  options: ContentDiffOptions = {},
): ContentDiffResult {
  const granularity = options.granularity ?? 'paragraph';
  const beforeTokens = tokenize(normalizeMarkdownLineEndings(before), granularity);
  const afterTokens = tokenize(normalizeMarkdownLineEndings(after), granularity);
  const matrix = buildLongestCommonSubsequenceMatrix(beforeTokens, afterTokens);
  const changes: ContentDiffChange[] = [];
  const hunk: PendingDiffHunk = { removed: [], added: [] };
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeTokens.length || afterIndex < afterTokens.length) {
    const beforeToken = beforeTokens[beforeIndex];
    const afterToken = afterTokens[afterIndex];

    if (beforeToken !== undefined && afterToken !== undefined && beforeToken === afterToken) {
      flushHunk(changes, hunk);
      appendChange(changes, { type: 'unchanged', value: beforeToken });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (beforeToken !== undefined && (
      afterToken === undefined
      || (matrix[beforeIndex + 1]?.[afterIndex] ?? 0) >= (matrix[beforeIndex]?.[afterIndex + 1] ?? 0)
    )) {
      hunk.removed.push(beforeToken);
      beforeIndex += 1;
      continue;
    }

    if (afterToken !== undefined) {
      hunk.added.push(afterToken);
      afterIndex += 1;
    }
  }

  flushHunk(changes, hunk);
  return {
    granularity,
    hasChanges: changes.some((change) => change.type !== 'unchanged'),
    changes,
  };
}