export interface TopicCandidate {
  id: string;
  title: string;
  source: string;
  sourceName: string;
  url?: string;
  hotValue?: number;
  rank: number;
  timestamp?: number;
  hotScore: number; // 0-100
  trendScore: number; // 0-100
  discussScore: number; // 0-100
  actionabilityScore: number; // 0-100
  timelinessScore: number; // 0-100
}

export interface TopicScored extends TopicCandidate {
  score: number;
  reason: string;
  expected: {
    exposure: number;
    plays: number;
    fans: number;
  };
}

export interface TopicEvaluatorContext {
  goal: string;
}

export interface TopicEvaluatorPlugin {
  id: string;
  version: string;
  label: string;
  score: (candidates: TopicCandidate[], ctx: TopicEvaluatorContext) => TopicScored[];
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function estimateExpected(score: number) {
  const exposure = Math.round(12_000 + score * 2_300);
  const plays = Math.round(exposure * (0.2 + score / 500));
  const fans = Math.round(30 + score * 2.2);
  return { exposure, plays, fans };
}

function rankWithWeights(
  candidates: TopicCandidate[],
  weights: { hot: number; trend: number; discuss: number; actionability: number; timeliness: number }
) {
  return candidates.map((candidate) => {
    const score = clampScore(
      candidate.hotScore * weights.hot +
        candidate.trendScore * weights.trend +
        candidate.discussScore * weights.discuss +
        candidate.actionabilityScore * weights.actionability +
        candidate.timelinessScore * weights.timeliness
    );

    const reason = [
      `热度 ${candidate.hotScore.toFixed(1)}`,
      `增速 ${candidate.trendScore.toFixed(1)}`,
      `讨论度 ${candidate.discussScore.toFixed(1)}`,
      `可执行 ${candidate.actionabilityScore.toFixed(1)}`,
      `时效 ${candidate.timelinessScore.toFixed(1)}`,
    ].join(' / ');

    return {
      ...candidate,
      score,
      reason,
      expected: estimateExpected(score),
    };
  });
}

const hotnessV1: TopicEvaluatorPlugin = {
  id: 'hotness-v1',
  version: '1.0.0',
  label: '热度优先',
  score(candidates) {
    return rankWithWeights(candidates, {
      hot: 0.35,
      trend: 0.3,
      discuss: 0.2,
      actionability: 0.1,
      timeliness: 0.05,
    });
  },
};

const growthV1: TopicEvaluatorPlugin = {
  id: 'growth-v1',
  version: '1.0.0',
  label: '涨粉优先',
  score(candidates) {
    return rankWithWeights(candidates, {
      hot: 0.2,
      trend: 0.2,
      discuss: 0.3,
      actionability: 0.2,
      timeliness: 0.1,
    });
  },
};

export const TOPIC_EVALUATORS: Record<string, TopicEvaluatorPlugin> = {
  [hotnessV1.id]: hotnessV1,
  [growthV1.id]: growthV1,
};

export function pickEvaluator(explicitId: string | undefined, goal: string): TopicEvaluatorPlugin {
  const id = (explicitId || '').trim().toLowerCase();
  if (id && TOPIC_EVALUATORS[id]) return TOPIC_EVALUATORS[id];

  const g = goal.toLowerCase();
  if (g.includes('涨粉') || g.includes('粉丝')) return growthV1;
  return hotnessV1;
}

