import type { WorkflowDef } from '../types';

export const topicPickerDailyHotWorkflow: WorkflowDef = {
  id: 'topic-picker-dailyhot',
  name: '今日选题 Agent（DailyHot）',
  description: '调用 DailyHotApi 热榜并通过评估器筛选 3-5 个高价值选题',
  vars: ['goal', 'count', 'sources'],
  nodes: [
    {
      type: 'topic_picker_agent',
      label: '获取今日高价值选题',
      params: {
        goal: '{{goal}}',
        count: '{{count}}',
        sources: '{{sources}}',
        baseUrl: 'https://dailyhotapi-hazel.vercel.app',
        perSourceLimit: 20,
        evaluatorId: 'hotness-v1',
        llmProvider: 'qianwen',
        llmModel: 'qwen-turbo',
        llmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        llmApiKeyEnv: 'QWEN_API_KEY',
        llmTemperature: 0.2,
        outputVar: 'topicIdeas',
        outputDetailVar: 'topicIdeasDetail',
      },
    },
  ],
};
