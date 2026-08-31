export type HumanizeMode = 'light' | 'standard' | 'deep';

export type HumanizeSeverity = 'low' | 'medium' | 'high';

export interface HumanizeFinding {
  ruleId: string;
  severity: HumanizeSeverity;
  message: string;
  matchedText: string;
  suggestion: string;
}

export interface HumanizeSummary {
  mode: HumanizeMode;
  total: number;
  high: number;
  medium: number;
  low: number;
}

export interface HumanizeAnalysis {
  findings: HumanizeFinding[];
  summary: HumanizeSummary;
}

type IndexedFinding = HumanizeFinding & {
  start: number;
  ruleOrder: number;
};

type IndexedMatch = {
  start: number;
  end: number;
  text: string;
};

const severityRank: Record<HumanizeSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const minimumSeverityByMode: Record<HumanizeMode, HumanizeSeverity> = {
  light: 'high',
  standard: 'medium',
  deep: 'low',
};

const genericOpeningPatterns = [
  /在当今(?:这个)?(?:快速变化的)?(?:时代|社会|世界)/g,
  /在当今(?=[，,。；;：:])/g,
];

const overSummaryPattern = /综上所述|总而言之|总的来说|由此可见/g;
const promotionalVaguenessPattern = /赋能|打造|助力|引领|全面提升|持续深化|加速推进/g;
const unsupportedJudgmentPattern = /(?:显然|众所周知|不难发现|毋庸置疑|可以看出)(?:[，,：:]\s*)?(?:这一点|这种方式|这个问题|未来|大家)?/g;
const mechanicalConnectorPattern = /首先|其次|再次|最后|此外|与此同时|因此|总之|一方面|另一方面/g;

function collectMatches(pattern: RegExp, text: string): IndexedMatch[] {
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: match[0],
  }));
}

function collectMatchesFromPatterns(patterns: RegExp[], text: string): IndexedMatch[] {
  const matches = patterns.flatMap((pattern) => collectMatches(pattern, text));
  const unique = new Map<string, IndexedMatch>();

  for (const match of matches) {
    unique.set(`${match.start}:${match.end}`, match);
  }

  return Array.from(unique.values()).sort((left, right) => left.start - right.start);
}

function createFinding(
  ruleId: string,
  severity: HumanizeSeverity,
  message: string,
  matchedText: string,
  suggestion: string,
  start: number,
  ruleOrder: number,
): IndexedFinding {
  return {
    ruleId,
    severity,
    message,
    matchedText,
    suggestion,
    start,
    ruleOrder,
  };
}

function findMechanicalConnectorClusters(text: string): IndexedMatch[] {
  const matches = collectMatches(mechanicalConnectorPattern, text);
  const clusters: IndexedMatch[] = [];
  let cluster: IndexedMatch[] = [];

  const flushCluster = () => {
    if (cluster.length >= 3) {
      const first = cluster[0];
      const last = cluster[cluster.length - 1];

      if (first && last) {
        clusters.push({
          start: first.start,
          end: last.end,
          text: text.slice(first.start, last.end),
        });
      }
    }
    cluster = [];
  };

  for (const match of matches) {
    const previous = cluster.at(-1);
    if (!previous) {
      cluster = [match];
      continue;
    }

    const between = text.slice(previous.end, match.start);
    const isSameClause = !/[。！？\n]/u.test(between) && between.length <= 30;

    if (isSameClause) {
      cluster.push(match);
    } else {
      flushCluster();
      cluster = [match];
    }
  }

  flushCluster();
  return clusters;
}

function isHumanizeMode(value: unknown): value is HumanizeMode {
  return value === 'light' || value === 'standard' || value === 'deep';
}

function shouldReport(severity: HumanizeSeverity, mode: HumanizeMode): boolean {
  return severityRank[severity] >= severityRank[minimumSeverityByMode[mode]];
}

export function analyzeChineseTemplate(text: string, mode: HumanizeMode): HumanizeAnalysis {
  if (!isHumanizeMode(mode)) {
    throw new RangeError(`Unsupported HumanizeMode: ${String(mode)}`);
  }

  const findings: IndexedFinding[] = [];

  for (const match of collectMatchesFromPatterns(genericOpeningPatterns, text)) {
    findings.push(
      createFinding(
        'generic-opening',
        'high',
        '开场使用了泛化的时代或社会背景，信息密度较低。',
        match.text,
        '直接交代具体人物、场景、时间或正在讨论的问题，减少套话式铺垫。',
        match.start,
        0,
      ),
    );
  }

  for (const match of collectMatches(overSummaryPattern, text)) {
    findings.push(
      createFinding(
        'over-summary',
        'medium',
        '结尾使用了常见的总结套语，可能让收束显得机械。',
        match.text,
        '用一个具体结论、行动建议或仍待解决的限制来收束，而不是只重复总结信号。',
        match.start,
        1,
      ),
    );
  }

  for (const match of collectMatches(promotionalVaguenessPattern, text)) {
    findings.push(
      createFinding(
        'promotional-vagueness',
        'medium',
        '出现了宣传式抽象动词，尚未说明谁做了什么以及产生了什么结果。',
        match.text,
        '补充明确主体、动作对象和可验证结果；必要时用具体动词替换宣传口号。',
        match.start,
        2,
      ),
    );
  }

  for (const match of findMechanicalConnectorClusters(text)) {
    findings.push(
      createFinding(
        'mechanical-connectors',
        'medium',
        '同一段落或句群中连接词连续堆叠，结构信号可能盖过了真实内容。',
        match.text,
        '只保留必要的逻辑连接，并让每一步由具体事实、例子或因果关系承接。',
        match.start,
        3,
      ),
    );
  }

  for (const match of collectMatches(unsupportedJudgmentPattern, text)) {
    findings.push(
      createFinding(
        'unsupported-judgment',
        'high',
        '判断缺少明确主体、事实或依据，读者难以核验这句话。',
        match.text,
        '指出具体主体和依据，例如数据、观察对象、时间范围或可复核的例子。',
        match.start,
        4,
      ),
    );
  }

  const reportedFindings = findings
    .filter((finding) => shouldReport(finding.severity, mode))
    .sort((left, right) => left.start - right.start || left.ruleOrder - right.ruleOrder);

  const publicFindings = reportedFindings.map(({ start: _start, ruleOrder: _ruleOrder, ...finding }) => finding);
  const summary: HumanizeSummary = {
    mode,
    total: publicFindings.length,
    high: publicFindings.filter((finding) => finding.severity === 'high').length,
    medium: publicFindings.filter((finding) => finding.severity === 'medium').length,
    low: publicFindings.filter((finding) => finding.severity === 'low').length,
  };

  return { findings: publicFindings, summary };
}

export default analyzeChineseTemplate;
