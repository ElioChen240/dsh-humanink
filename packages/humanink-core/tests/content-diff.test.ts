import { describe, expect, it } from 'vitest';
import {
  diffMarkdownContent,
  validateProtectedFields,
  type ContentDiffChange,
} from '../src/diff/index.js';

function beforeSide(changes: readonly ContentDiffChange[]): string {
  return changes.map((change) => {
    switch (change.type) {
      case 'added':
        return '';
      case 'modified':
        return change.before;
      case 'removed':
      case 'unchanged':
        return change.value;
    }
  }).join('');
}

function afterSide(changes: readonly ContentDiffChange[]): string {
  return changes.map((change) => {
    switch (change.type) {
      case 'removed':
        return '';
      case 'modified':
        return change.after;
      case 'added':
      case 'unchanged':
        return change.value;
    }
  }).join('');
}

describe('diffMarkdownContent', () => {
  it('returns an unchanged paragraph diff for identical Markdown', () => {
    const markdown = '# 标题\n\n第一段。\n\n第二段。\n';

    const result = diffMarkdownContent(markdown, markdown);

    expect(result).toEqual({
      granularity: 'paragraph',
      hasChanges: false,
      changes: [{ type: 'unchanged', value: markdown }],
    });
  });

  it('reports modified, removed, added and unchanged blocks without losing text', () => {
    const before = [
      '# 标题',
      '',
      '保留段。',
      '',
      '旧版本段。',
      '',
      '中间锚点。',
      '',
      '删除段。',
      '',
      '尾部保留。',
    ].join('\n');
    const after = [
      '# 标题',
      '',
      '保留段。',
      '',
      '新版本段。',
      '',
      '中间锚点。',
      '',
      '尾部保留。',
      '',
      '新增段。',
    ].join('\n');

    const result = diffMarkdownContent(before, after);

    expect(result.hasChanges).toBe(true);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unchanged',
        value: expect.stringContaining('# 标题'),
      }),
      { type: 'modified', before: '旧版本段。', after: '新版本段。' },
      { type: 'removed', value: '删除段。\n\n' },
      { type: 'added', value: '\n\n新增段。' },
    ]));
    expect(beforeSide(result.changes)).toBe(before);
    expect(afterSide(result.changes)).toBe(after);
  });

  it('normalizes line endings while preserving Chinese punctuation and blank-line runs deterministically', () => {
    const before = '第一段。\r\n\r\n第二段！\r\n';
    const after = '第一段。\n\n\n第二段！\n';

    const first = diffMarkdownContent(before, after);
    const second = diffMarkdownContent(before, after);

    expect(first).toEqual(second);
    expect(beforeSide(first.changes)).toBe('第一段。\n\n第二段！\n');
    expect(afterSide(first.changes)).toBe(after);
    expect(first.changes).toContainEqual({
      type: 'modified',
      before: '\n\n',
      after: '\n\n\n',
    });
  });

  it('keeps adjacent sentence modifications as separate before and after pairs', () => {
    const result = diffMarkdownContent(
      '第一句旧表达。第二句旧表达。结尾保留。',
      '第一句新表达。第二句新表达。结尾保留。',
      { granularity: 'sentence' },
    );

    expect(result.changes).toEqual([
      { type: 'modified', before: '第一句旧表达。', after: '第一句新表达。' },
      { type: 'modified', before: '第二句旧表达。', after: '第二句新表达。' },
      { type: 'unchanged', value: '结尾保留。' },
    ]);
  });
  it('supports sentence-level Chinese Markdown diff with punctuation attached to its sentence', () => {
    const before = '## 做法\n先记录事实。再调整表达！\n最后人工确认？';
    const after = '## 做法\n先记录事实。再把表达写具体！\n最后人工确认？';

    const result = diffMarkdownContent(before, after, { granularity: 'sentence' });

    expect(result.granularity).toBe('sentence');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unchanged',
        value: expect.stringContaining('先记录事实。'),
      }),
    ]));
    expect(result.changes).toContainEqual({
      type: 'modified',
      before: '再调整表达！',
      after: '再把表达写具体！',
    });
    expect(beforeSide(result.changes)).toBe(before);
    expect(afterSide(result.changes)).toBe(after);
  });
});

describe('validateProtectedFields', () => {
  it('passes when every protected value remains exact, even if it moves', () => {
    const result = validateProtectedFields(
      '负责人是陈墨。发布日期是 2026 年 9 月 1 日。',
      '发布日期是 2026 年 9 月 1 日。负责人是陈墨。',
      ['负责人是陈墨', '2026 年 9 月 1 日'],
    );

    expect(result).toEqual({ valid: true, violations: [] });
  });

  it('reports a changed protected value with before and after context', () => {
    const result = validateProtectedFields(
      '年度复购率为 37%，统计周期截至 2026 年 8 月。',
      '年度复购率为 42%，统计周期截至 2026 年 8 月。',
      ['复购率为 37%', '2026 年 8 月'],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      {
        field: '复购率为 37%',
        type: 'changed',
        before: '年度复购率为 37%，统计周期截至 2026 年 8 月。',
        after: '年度复购率为 42%，统计周期截至 2026 年 8 月。',
        message: '保护字段“复购率为 37%”已被修改。',
      },
    ]);
  });

  it('reports silently removed protected content as missing', () => {
    const result = validateProtectedFields(
      '负责人是陈墨。\n\n官网：https://humanink.example.com',
      '官网：https://humanink.example.com',
      ['负责人是陈墨'],
    );

    expect(result).toEqual({
      valid: false,
      violations: [{
        field: '负责人是陈墨',
        type: 'missing',
        before: '负责人是陈墨。',
        message: '保护字段“负责人是陈墨”在改写后缺失。',
      }],
    });
  });

  it('keeps full-sentence protected-field context bounded when the field includes punctuation', () => {
    const result = validateProtectedFields(
      '负责人是陈墨。下一句保留。',
      '下一句保留。',
      ['负责人是陈墨。'],
    );

    expect(result.violations).toEqual([expect.objectContaining({
      field: '负责人是陈墨。',
      type: 'missing',
      before: '负责人是陈墨。',
    })]);
  });
  it('reports invalid protection metadata and de-duplicates repeated fields', () => {
    const result = validateProtectedFields(
      '正文没有该值。',
      '正文没有该值。',
      ['未出现在原文的事实', '未出现在原文的事实'],
    );

    expect(result).toEqual({
      valid: false,
      violations: [{
        field: '未出现在原文的事实',
        type: 'source_missing',
        message: '保护字段“未出现在原文的事实”未出现在原文中。',
      }],
    });
  });

  it('rejects empty protected field definitions instead of silently ignoring them', () => {
    expect(() => validateProtectedFields('原文', '改写', ['  '])).toThrow(
      'protectedFields[0] must be a non-empty string',
    );
  });
});
