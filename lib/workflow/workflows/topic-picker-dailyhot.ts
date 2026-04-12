import type { WorkflowDef } from '../types';

export const topicPickerDailyHotWorkflow: WorkflowDef = {
  id: 'topic-picker-dailyhot',
  name: '今日选题 Agent（DailyHot）',
  description: '基于 ReAct Agent + DailyHot skill 自动拉取候选并筛选高价值选题',
  vars: ['goal', 'count', 'sources'],
  nodes: [
    {
      type: 'agent_react',
      label: '获取今日高价值选题',
      params: {
        systemPrompt:
          '你是内容选题总监。你必须基于工具返回的数据做决策，不得臆造候选。最终必须输出严格 JSON。',
        userPromptTemplate:
          '任务目标：{{goal}}\n输出数量：{{count}}\n来源列表(JSON)：{{sources}}\n\n工作步骤要求：\n1) 调用 dailyhot.fetch_topics，baseUrl 固定使用 https://dailyhotapi-hazel.vercel.app，perSourceLimit 设为 20\n2) 仅基于返回 candidates 做语义筛选，优先满足任务目标关键词；若目标要求某主题（如学生/美国/日本），selected 必须与主题强相关\n3) 如果强相关候选不足，允许返回少于 count，并在 discarded/summary 说明原因\n4) 最后输出 {"action":"final","output":...}\n\nfinal.output 结构必须为：{"selected":[{"rank":1,"title":"","source":"","sourceName":"","score":0-100,"reason":"","expected":{"exposure":0,"plays":0,"fans":0},"url":""}],"summary":"","discarded":[{"title":"","reason":""}]}\n并且 selected 必须按优先级排序。',
        llmProvider: 'qianwen',
        llmModel: 'qwen-turbo',
        llmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        llmApiKeyEnv: 'QWEN_API_KEY',
        llmTemperature: 0.2,
        tools: ['dailyhot.fetch_topics'],
        maxTurns: 8,
        responseSchema:
          '{"type":"object","properties":{"selected":{"type":"array"},"summary":{"type":"string"},"discarded":{"type":"array"}},"required":["selected","summary","discarded"]}',
        outputField: 'selected',
        outputVar: 'topicIdeas',
        outputDetailVar: 'topicIdeasDetail',
      },
    },
  ],
};
