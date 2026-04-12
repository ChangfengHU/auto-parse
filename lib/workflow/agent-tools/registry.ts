import type { WorkflowContext } from '../types';

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema?: string;
  execute: (input: unknown, ctx: WorkflowContext) => Promise<unknown>;
}

const REGISTRY = new Map<string, AgentToolDefinition>();

export function registerAgentTool(def: AgentToolDefinition): void {
  const key = def.name.trim();
  if (!key) {
    throw new Error('工具注册失败：name 不能为空');
  }
  REGISTRY.set(key, { ...def, name: key });
}

export function getAgentTool(name: string): AgentToolDefinition | undefined {
  return REGISTRY.get(name.trim());
}

export function listAgentTools(names?: string[]): AgentToolDefinition[] {
  if (!names || names.length === 0) {
    return Array.from(REGISTRY.values());
  }
  return names
    .map((name) => getAgentTool(name))
    .filter((tool): tool is AgentToolDefinition => Boolean(tool));
}

registerAgentTool({
  name: 'workflow.list_vars',
  description: '返回当前工作流可用变量名和变量值快照。',
  inputSchema: '{"type":"object","properties":{},"additionalProperties":false}',
  async execute(_input, ctx) {
    return {
      vars: ctx.vars,
      outputs: ctx.outputs,
    };
  },
});

registerAgentTool({
  name: 'workflow.get_var',
  description: '读取单个变量值。输入: {"name":"变量名"}',
  inputSchema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
  async execute(input, ctx) {
    const payload = (input && typeof input === 'object' ? input : {}) as { name?: unknown };
    const name = String(payload.name ?? '').trim();
    if (!name) {
      throw new Error('workflow.get_var 缺少 name');
    }
    return { name, value: ctx.vars[name] ?? null };
  },
});
