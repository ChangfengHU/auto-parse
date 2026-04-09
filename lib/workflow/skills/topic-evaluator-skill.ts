import type { TopicCandidate } from '../topic-evaluators';
import { pickEvaluator } from '../topic-evaluators';

export function evaluateTopicCandidates(input: {
  candidates: TopicCandidate[];
  goal: string;
  evaluatorId?: string;
}) {
  const evaluator = pickEvaluator(input.evaluatorId, input.goal);
  const scored = evaluator
    .score(input.candidates, { goal: input.goal })
    .sort((a, b) => b.score - a.score);

  return {
    evaluator: {
      id: evaluator.id,
      version: evaluator.version,
      label: evaluator.label,
    },
    scored,
  };
}

