import {
  cancelGeminiAdsBatchTask,
  createGeminiAdsBatchTask,
  getGeminiAdsBatchTask,
} from '../gemini-ads-batch';

export async function startGeminiAdsBatchSkill(input: {
  runs: Array<{ browserInstanceId: string; prompt: string; browserWsUrl?: string }>;
  workflowId?: string;
  promptVarName?: string;
  maxConcurrency?: number;
  autoCloseTab?: boolean;
}) {
  return createGeminiAdsBatchTask(input);
}

export function queryGeminiAdsBatchSkill(taskId: string) {
  return getGeminiAdsBatchTask(taskId);
}

export function cancelGeminiAdsBatchSkill(taskId: string) {
  return cancelGeminiAdsBatchTask(taskId);
}

