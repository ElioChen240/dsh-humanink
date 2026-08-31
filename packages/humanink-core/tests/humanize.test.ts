import { describe, expect, it } from 'vitest';
import {
  analyzeChineseTemplate,
  type HumanizeFinding,
  type HumanizeMode,
} from '../src/humanize/analyze-chinese-template.js';

const diagnosticText = [
  '在当今快速变化的时代，企业需要不断创新。',
  '首先，我们要明确方向；其次，我们要统一行动；此外，我们还要持续优化；最后，我们要实现目标。',
  '赋能业务，打造生态，助力增长。',
  '显然，这种方式非常重要。',
  '综上所述，未来值得期待。',
].join('\n');

function findingByRule(findings: HumanizeFinding[], ruleId: string) {
  return findings.find((finding) => finding.ruleId === ruleId);
}

describe('analyzeChineseTemplate', () => {
  it('reports the MVP Chinese template patterns with actionable diagnostics', () => {
    const result = analyzeChineseTemplate(diagnosticText, 'standard');

    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        'generic-opening',
        'over-summary',
        'promotional-vagueness',
        'mechanical-connectors',
        'unsupported-judgment',
      ]),
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'generic-opening',
          severity: 'high',
          matchedText: expect.stringContaining('在当今'),
          suggestion: expect.any(String),
          message: expect.any(String),
        }),
        expect.objectContaining({
          ruleId: 'promotional-vagueness',
          matchedText: expect.stringMatching(/赋能|打造|助力/),
        }),
      ]),
    );
    expect(result.summary.total).toBe(result.findings.length);
    expect(result.summary.high).toBeGreaterThan(0);
    expect(result.summary.medium).toBeGreaterThan(0);
  });

  it('reports only high-severity findings in light mode', () => {
    const result = analyzeChineseTemplate(diagnosticText, 'light');

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((finding) => finding.severity === 'high')).toBe(true);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(['generic-opening', 'unsupported-judgment']),
    );
    expect(result.findings.map((finding) => finding.ruleId)).not.toEqual(
      expect.arrayContaining(['over-summary', 'promotional-vagueness', 'mechanical-connectors']),
    );
  });

  it('reports every supported severity in deep mode and is deterministic', () => {
    const first = analyzeChineseTemplate(diagnosticText, 'deep');
    const second = analyzeChineseTemplate(diagnosticText, 'deep');

    expect(first).toEqual(second);
    expect(first.findings.length).toBeGreaterThanOrEqual(5);
    expect(first.summary.total).toBe(first.findings.length);
    expect(first.summary.mode).toBe('deep');
  });

  it('does not treat the word AI as a finding by itself', () => {
    const result = analyzeChineseTemplate(
      '这篇文章介绍了 AI 在客服团队中的具体应用，团队每周处理 1200 条咨询。',
      'deep',
    );

    expect(result.findings).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it.each<HumanizeMode>(['light', 'standard', 'deep'])('returns no findings for concrete prose in %s mode', (mode) => {
    const result = analyzeChineseTemplate(
      '小林在周三把订单导出为 CSV，并在下午三点前修复了两个重复记录。',
      mode,
    );

    expect(result.findings).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('keeps each finding as a diagnosis instead of rewriting the source text', () => {
    const text = '在当今社会，我们需要关注这个问题。';
    const result = analyzeChineseTemplate(text, 'deep');

    expect(text).toBe('在当今社会，我们需要关注这个问题。');
    expect(findingByRule(result.findings, 'generic-opening')).toEqual(
      expect.objectContaining({
        matchedText: expect.any(String),
        suggestion: expect.any(String),
      }),
    );
    expect(result).not.toHaveProperty('rewrittenText');
  });
});
