import type { WorkflowDef } from '../types';

export const topicPickerDailyHotWorkflow: WorkflowDef = {
  id: 'topic-picker-dailyhot',
  name: '今日选题 Agent（DailyHot）',
  description: '先拉取 DailyHot 热点并输出健康检查，再由 LLM 直接过滤选择 3-5 个高价值选题',
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
        llmSystemPrompt:
          '你是内容选题总监。基于候选热点，按目标筛选最值得做的 3-5 个选题，优先考虑曝光潜力、播放潜力、涨粉潜力。必须输出严格 JSON。',
        llmUserPromptTemplate:
          '任务目标：{{goal}}\n输出数量：{{count}}\n\n候选数据（JSON）：\n{{candidatesJson}}\n\n请仅输出 JSON，结构为：{"selected":[{"rank":1,"title":"","source":"","sourceName":"","score":0-100,"reason":"","expected":{"exposure":0,"plays":0,"fans":0},"url":""}],"summary":"","discarded":[{"title":"","reason":""}]}\n要求：selected 按优先级排序，尽量覆盖多个来源。',
        llmCandidateLimit: 80,
        outputVar: 'topicIdeas',
        outputDetailVar: 'topicIdeasDetail',
      },
    },
  ],
};
