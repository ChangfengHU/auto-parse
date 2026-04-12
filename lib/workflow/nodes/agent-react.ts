import type { Page } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import type { AgentReactParams, NodeResult, WorkflowContext } from '../types';
import { getAgentTool, listAgentTools } from '../agent-tools/registry';
import { registerTopicAgentTools } from '../agent-tools/topic-tools';

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type LlmProvider = 'openai' | 'gemini' | 'qianwen' | 'deepseek';

function parseToolNames(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      // fallback
    }
  }
  return text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => vars[key] ?? '');
}

function parseJsonObject<T>(raw: string): T {
  const text = raw.trim();
  const obj = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    : text;
  return JSON.parse(obj) as T;
}

function extractFirstJsonObject(raw: string): string | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseAgentDecision(raw: string): { action?: string; tool?: string; input?: unknown; output?: unknown } | null {
  try {
    return parseJsonObject(raw) as { action?: string; tool?: string; input?: unknown; output?: unknown };
  } catch {
    const firstJson = extractFirstJsonObject(raw);
    if (!firstJson) return null;
    try {
      return JSON.parse(firstJson) as { action?: string; tool?: string; input?: unknown; output?: unknown };
    } catch {
      return null;
    }
  }
}

function extractAssistantContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };
  const first = data.choices?.[0]?.message?.content;
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    return first
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function resolveLlmConfig(params: AgentReactParams, ctx: WorkflowContext) {
  const readSecretFromFile = (key: string) => {
    const file = '/root/.config/openclaw/secrets.env';
    if (!existsSync(file)) return '';
    const text = readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith(`${key}=`)) continue;
      return trimmed.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return '';
  };

  const providerRaw = String(params.llmProvider ?? ctx.vars.agentLlmProvider ?? process.env.TOPIC_AGENT_PROVIDER ?? 'auto')
    .trim()
    .toLowerCase();
  const provider: LlmProvider =
    providerRaw === 'gemini' || providerRaw === 'qianwen' || providerRaw === 'deepseek' || providerRaw === 'openai'
      ? providerRaw
      : providerRaw === 'auto'
        ? 'qianwen'
        : 'openai';

  const defaultModelByProvider: Record<LlmProvider, string> = {
    openai: 'gpt-4.1',
    gemini: 'gemini-2.5-flash',
    qianwen: 'qwen-plus',
    deepseek: 'deepseek-chat',
  };
  const defaultBaseUrlByProvider: Record<LlmProvider, string> = {
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    qianwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    deepseek: 'https://api.deepseek.com/v1',
  };
  const defaultKeyEnvByProvider: Record<LlmProvider, string> = {
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    qianwen: 'QWEN_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };

  const model = String(params.llmModel ?? ctx.vars.agentLlmModel ?? process.env.TOPIC_AGENT_MODEL ?? defaultModelByProvider[provider]).trim();
  const openaiBase = provider === 'openai' ? process.env.OPENAI_BASE_URL : undefined;
  const baseUrl = String(
    params.llmBaseUrl ??
      ctx.vars.agentLlmBaseUrl ??
      process.env.TOPIC_AGENT_BASE_URL ??
      openaiBase ??
      defaultBaseUrlByProvider[provider]
  ).replace(/\/+$/, '');
  const keyEnv = String(
    params.llmApiKeyEnv ??
      ctx.vars.agentLlmApiKeyEnv ??
      process.env.TOPIC_AGENT_API_KEY_ENV ??
      defaultKeyEnvByProvider[provider]
  ).trim();
  const envKey = keyEnv ? process.env[keyEnv] : undefined;
  const apiKey =
    String(params.llmApiKey ?? '').trim() ||
    String(ctx.vars.agentLlmApiKey ?? '').trim() ||
    String(envKey ?? '').trim() ||
    String(process.env.TOPIC_AGENT_API_KEY ?? '').trim() ||
    String(process.env.OPENAI_API_KEY ?? '').trim() ||
    String(process.env.GEMINI_API_KEY ?? '').trim() ||
    String(process.env.QWEN_API_KEY ?? '').trim() ||
    String(process.env.DEEPSEEK_API_KEY ?? '').trim() ||
    readSecretFromFile(keyEnv || 'OPENAI_API_KEY') ||
    readSecretFromFile('TOPIC_AGENT_API_KEY') ||
    readSecretFromFile('OPENAI_API_KEY') ||
    readSecretFromFile('GEMINI_API_KEY') ||
    readSecretFromFile('QWEN_API_KEY') ||
    readSecretFromFile('DEEPSEEK_API_KEY');
  const temperatureRaw = Number(params.llmTemperature ?? 0.2);
  const temperature = Number.isFinite(temperatureRaw) ? Math.max(0, Math.min(1, temperatureRaw)) : 0.2;

  if (!apiKey) throw new Error(`缺少 ${keyEnv}（或节点参数 llmApiKey）`);
  return { provider, model, baseUrl, apiKey, temperature };
}

async function callLlmOpenAICompatible(
  config: { model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  const endpoint = `${config.baseUrl}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        messages,
      }),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = cause instanceof Error ? cause.message : String(cause ?? '');
    throw new Error(`LLM 网络请求失败（${endpoint}）：${error instanceof Error ? error.message : String(error)}${detail ? ` | cause=${detail}` : ''}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }
  const payload = JSON.parse(text) as unknown;
  const content = extractAssistantContent(payload);
  if (!content) throw new Error('LLM 未返回可解析内容');
  return content;
}

async function callLlmGemini(
  config: { model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  const systemInstruction = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '请输出 JSON。' }] });
  }

  const endpoint = `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        contents,
        generationConfig: { temperature: config.temperature },
      }),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = cause instanceof Error ? cause.message : String(cause ?? '');
    throw new Error(`Gemini 网络请求失败（${endpoint}）：${error instanceof Error ? error.message : String(error)}${detail ? ` | cause=${detail}` : ''}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }
  const payload = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const output =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || '';
  if (!output) throw new Error('Gemini 未返回可解析内容');
  return output;
}

async function callLlm(
  config: { provider: LlmProvider; model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  if (config.provider === 'gemini') return callLlmGemini(config, messages);
  return callLlmOpenAICompatible(config, messages);
}

function buildProtocolPrompt(args: {
  tools: Array<{ name: string; description: string; inputSchema?: string }>;
  responseSchema: string;
  maxTurns: number;
}) {
  return [
    '你是一个可调用工具的 ReAct Agent。',
    `你最多可思考并行动 ${args.maxTurns} 轮，每轮只能输出一个 JSON 对象，禁止输出任何额外文本。`,
    '当你需要调用工具时，输出：',
    '{"action":"tool_call","tool":"工具名","input":{...}}',
    '当你要结束时，输出：',
    `{"action":"final","output":<严格符合下方 schema 的 JSON>}`,
    `最终 output schema：${args.responseSchema}`,
    `可用工具：${JSON.stringify(args.tools, null, 2)}`,
  ].join('\n');
}

export async function executeAgentReact(
  _page: Page,
  params: AgentReactParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  registerTopicAgentTools();
  const aliasParams = params as AgentReactParams & {
    llmSystemPrompt?: string;
    llmUserPromptTemplate?: string;
  };
  const systemPrompt = String(params.systemPrompt ?? aliasParams.llmSystemPrompt ?? '').trim() || '你是一个严谨的工作流 Agent。';
  const userPromptTemplate = String(params.userPromptTemplate ?? aliasParams.llmUserPromptTemplate ?? '').trim() || '{{goal}}';
  const toolNames = parseToolNames(params.tools);
  const maxTurnsRaw = Number(params.maxTurns ?? 4);
  const maxTurns = Number.isFinite(maxTurnsRaw) ? Math.max(1, Math.min(12, Math.floor(maxTurnsRaw))) : 4;
  const responseSchema = String(params.responseSchema ?? '').trim() || '{"type":"object"}';
  const outputField = String(params.outputField ?? '').trim();
  const outputVar = String(params.outputVar ?? 'agentResult').trim() || 'agentResult';
  const outputDetailVar = String(params.outputDetailVar ?? 'agentDetail').trim() || 'agentDetail';
  const tools = listAgentTools(toolNames);
  const missingTools = toolNames.filter((name) => !getAgentTool(name));
  if (missingTools.length > 0) {
    throw new Error(`未注册工具：${missingTools.join(', ')}`);
  }
  const llmConfig = resolveLlmConfig(params, ctx);
  const userPrompt = renderTemplate(userPromptTemplate, ctx.vars);
  const protocolPrompt = buildProtocolPrompt({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    responseSchema,
    maxTurns,
  });

  log.push(`🧠 Agent：${llmConfig.provider}/${llmConfig.model} @ ${llmConfig.baseUrl}`);
  log.push(`🛠️ 工具：${tools.map((tool) => tool.name).join(', ') || '无'}`);
  const messages: LlmMessage[] = [
    { role: 'system', content: `${systemPrompt}\n\n${protocolPrompt}` },
    { role: 'user', content: userPrompt },
  ];
  const trace: Array<{ turn: number; action: string; tool?: string; input?: unknown; output?: unknown }> = [];
  const toolOutputs: Record<string, unknown> = {};

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    log.push(`🔁 Agent 回合 ${turn}/${maxTurns}`);
    const raw = await callLlm(llmConfig, messages);
    messages.push({ role: 'assistant', content: raw });

    const decision = parseAgentDecision(raw);
    if (!decision) {
      log.push('⚠️ Agent 返回了非法 JSON，已请求模型按协议重试');
      messages.push({
        role: 'user',
        content:
          '你上一条输出不是合法 JSON。请立刻重发且只返回一个合法 JSON 对象，不要 markdown、不要解释、不要多余文本。格式只能是 {"action":"tool_call",...} 或 {"action":"final",...}。',
      });
      continue;
    }

    if (decision.action === 'tool_call') {
      const toolName = String(decision.tool ?? '').trim();
      const tool = getAgentTool(toolName);
      if (!tool) throw new Error(`Agent 请求未知工具：${toolName || '(empty)'}`);
      let toolResult: unknown;
      try {
        toolResult = await tool.execute(decision.input ?? {}, ctx);
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        const detail = cause instanceof Error ? cause.message : String(cause ?? '');
        throw new Error(`工具调用失败（${toolName}）：${error instanceof Error ? error.message : String(error)}${detail ? ` | cause=${detail}` : ''}`);
      }
      toolOutputs[toolName] = toolResult;
      trace.push({ turn, action: 'tool_call', tool: toolName, input: decision.input ?? {}, output: toolResult });
      log.push(`🔧 调用工具：${toolName}`);
      messages.push({
        role: 'user',
        content: `工具 ${toolName} 返回：\n${JSON.stringify(toolResult, null, 2)}\n请继续，仍然只输出 JSON。`,
      });
      continue;
    }

    if (decision.action === 'final') {
      const finalOutput = decision.output;
      const primaryOutput =
        outputField && finalOutput && typeof finalOutput === 'object' && outputField in (finalOutput as Record<string, unknown>)
          ? (finalOutput as Record<string, unknown>)[outputField]
          : finalOutput;
      trace.push({ turn, action: 'final', output: finalOutput });
      const detail = {
        llm: { provider: llmConfig.provider, model: llmConfig.model, baseUrl: llmConfig.baseUrl },
        tools: tools.map((tool) => tool.name),
        maxTurns,
        prompts: { system: systemPrompt, userTemplate: userPromptTemplate, renderedUser: userPrompt, responseSchema },
        fetch: (toolOutputs['dailyhot.fetch_topics'] as { fetch?: unknown } | undefined)?.fetch,
        toolOutputs,
        trace,
        generatedAt: new Date().toISOString(),
      };
      ctx.vars[outputVar] = JSON.stringify(primaryOutput);
      ctx.vars[outputDetailVar] = JSON.stringify(detail);
      log.push(`✅ Agent 产出完成`);
      return {
        success: true,
        log,
        output: {
          [outputVar]: primaryOutput,
          [outputDetailVar]: detail,
        },
      };
    }

    throw new Error(`Agent action 无效：${String(decision.action ?? '')}`);
  }

  throw new Error(`Agent 超过最大回合数（${maxTurns}）仍未输出 final`);
}
