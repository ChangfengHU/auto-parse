/**
 * Workflow CRUD — Supabase REST API（不可用时回退 lib/rpa/workflows/<id>.json）
 */
import fs from 'fs';
import path from 'path';
import type { WorkflowDef } from './types';
import { normalizeDouyinPublishWorkflow } from './workflows/douyin-publish';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

function headers(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

const TABLE = 'rpa_workflows';
const GEMINI_FORCE_AUTO_ENTER_WORKFLOW_IDS = new Set<string>([
  '4a163587-6e5e-4176-8178-0915f0429ee0',
  'a8d3b8e1-427c-4b78-b896-afbe35ed026c',
]);

function isLikelyGeminiSendClick(node: WorkflowDef['nodes'][number] | undefined) {
  if (!node || node.type !== 'click') return false;
  const params = (node.params ?? {}) as Record<string, unknown>;
  const text = String(params.text ?? '').toLowerCase();
  const selector = String(params.selector ?? '').toLowerCase();
  return (
    text.includes('send') ||
    text.includes('submit') ||
    text.includes('发送') ||
    text.includes('提交') ||
    selector.includes('send') ||
    selector.includes('submit') ||
    selector.includes('发送') ||
    selector.includes('提交')
  );
}

/** 从 text_input 之后向前找第一个「发送」类点击（不要求紧邻，避免 DB 里顺序错乱时规范化失效） */
function findNextGeminiSendClick(
  nodes: WorkflowDef['nodes'],
  textInputIndex: number
): { node: WorkflowDef['nodes'][number]; index: number } | null {
  for (let i = textInputIndex + 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (isLikelyGeminiSendClick(n)) return { node: n, index: i };
  }
  return null;
}

function findFirstImageExtractAfterIndex(
  nodes: WorkflowDef['nodes'],
  textInputIndex: number
): number {
  for (let i = textInputIndex + 1; i < nodes.length; i++) {
    const t = nodes[i].type;
    if (
      t === 'extract_image_download' ||
      t === 'extract_image_clipboard' ||
      t === 'extract_image'
    ) {
      return i;
    }
  }
  return -1;
}

function normalizeGeminiAutoEnterWorkflow(workflow: WorkflowDef): WorkflowDef {
  if (!GEMINI_FORCE_AUTO_ENTER_WORKFLOW_IDS.has(workflow.id)) return workflow;

  let mutated = false;
  const nodes = workflow.nodes.map((node, index) => {
    if (node.type === 'click') {
      const params = { ...(node.params as Record<string, unknown>) };
      const selector = String(params.selector ?? '');
      const text = String(params.text ?? '').toLowerCase();
      const likelySend =
        text.includes('send') ||
        text.includes('submit') ||
        text.includes('发送') ||
        text.includes('提交') ||
        selector.toLowerCase().includes('send') ||
        selector.toLowerCase().includes('发送');

      if (likelySend && selector) {
        const hasSubmit = /submit/i.test(selector);
        if (!hasSubmit) {
          params.selector = `${selector}, button[aria-label="Submit"], button[aria-label*="Submit" i]`;
          mutated = true;
          return { ...node, params };
        }
      }
      return node;
    }

    if (node.type !== 'text_input') return node;
    const sendAfter = findNextGeminiSendClick(workflow.nodes, index);
    const params = { ...(node.params as Record<string, unknown>) };
    let changed = false;

    if (!sendAfter) {
      if (params.autoEnter !== true) {
        params.autoEnter = true;
        changed = true;
      }
      // 仅未指定时默认 type；显式 fill 保留（与页面调试单步注入的节点一致，避免「配置整段填入却逐字输入」）
      if (params.inputMode === undefined) {
        params.inputMode = 'type';
        changed = true;
      }
      if (params.delay === undefined) {
        params.delay = 15;
        changed = true;
      }
      if (changed) {
        mutated = true;
        console.warn(
          '[wf-workflow] Gemini text_input 后未找到「发送」类 click，已强制 autoEnter=true；请检查节点顺序（应在生图/提取前插入 Send 点击）',
          { workflowId: workflow.id }
        );
      }
      return changed ? { ...node, params } : node;
    }

    const extractAfter = findFirstImageExtractAfterIndex(workflow.nodes, index);
    if (
      extractAfter !== -1 &&
      sendAfter.index > extractAfter
    ) {
      console.warn(
        '[wf-workflow] Gemini：「发送」click 排在「图片提取」节点之后，运行时会先执行提取而无法先提交提示词生图。请将 Send 点击移到 text_input 与提取节点之间并取消禁用。',
        {
          workflowId: workflow.id,
          textInputIndex: index,
          sendClickIndex: sendAfter.index,
          extractNodeIndex: extractAfter,
          sendDisabled: !!sendAfter.node.disabled,
        }
      );
    }

    const sendClickDisabled = !!sendAfter.node.disabled;
    if (!sendClickDisabled) {
      // 下一步会点「发送」时关闭自动回车，避免 Enter 与点击连发两次
      if (params.autoEnter !== false) {
        params.autoEnter = false;
        changed = true;
      }
    } else if (params.autoEnter !== true) {
      // 「发送」点击节点被禁用时仍靠键盘提交
      params.autoEnter = true;
      changed = true;
    }
    if (params.inputMode === undefined) {
      params.inputMode = 'type';
      changed = true;
    }
    if (params.delay === undefined) {
      params.delay = 15;
      changed = true;
    }

    if (!changed) return node;
    mutated = true;
    return { ...node, params };
  });

  return mutated ? { ...workflow, nodes } : workflow;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowDef['nodes'];
  vars: WorkflowDef['vars'];
  created_at: string;
  updated_at: string;
}

function rowToDef(row: WorkflowRow): WorkflowDef {
  return normalizeGeminiAutoEnterWorkflow(normalizeDouyinPublishWorkflow({
    id: row.id,
    name: row.name,
    description: row.description,
    nodes: row.nodes,
    vars: row.vars,
  }));
}

const LOCAL_WORKFLOW_DIR = path.join(process.cwd(), 'lib', 'rpa', 'workflows');

/** 开发/离线：与仓库中 JSON 同名 id 的工作流 */
export function loadWorkflowFromLocalFile(id: string): WorkflowDef | null {
  try {
    const fp = path.join(LOCAL_WORKFLOW_DIR, `${id}.json`);
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as WorkflowDef;
    return normalizeGeminiAutoEnterWorkflow(normalizeDouyinPublishWorkflow(raw));
  } catch (e) {
    console.warn('[workflow-db] 读取本地工作流失败', id, e);
    return null;
  }
}

function formatFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  if ('cause' in e && e.cause instanceof Error) {
    parts.push(e.cause.message);
  }
  return parts.join(' · ');
}

export async function listWorkflows(): Promise<WorkflowRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=created_at.asc`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getWorkflow(id: string): Promise<WorkflowDef | null> {
  const local = () => loadWorkflowFromLocalFile(id);

  if (!SUPABASE_URL.trim()) {
    return local();
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error(await res.text());
    const rows: WorkflowRow[] = await res.json();
    if (rows[0]) return rowToDef(rows[0]);
    const fallback = local();
    if (fallback) {
      console.warn('[workflow-db] Supabase 无此 id，已使用本地', id);
      return fallback;
    }
    return null;
  } catch (e) {
    const fallback = local();
    if (fallback) {
      console.warn(
        '[workflow-db] Supabase 请求失败，已使用本地工作流',
        id,
        formatFetchError(e)
      );
      return fallback;
    }
    throw new Error(
      `无法从 Supabase 拉取工作流（且无本地 lib/rpa/workflows/${id}.json）：${formatFetchError(e)}。请检查 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 与网络。`
    );
  }
}

export async function createWorkflow(def: Omit<WorkflowDef, 'id'> & { id?: string }): Promise<WorkflowDef> {
  const payload = {
    id: def.id ?? crypto.randomUUID(),
    name: def.name,
    description: def.description ?? '',
    nodes: def.nodes,
    vars: def.vars,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const rows: WorkflowRow[] = await res.json();
  return rowToDef(rows[0]);
}

export async function updateWorkflow(id: string, patch: Partial<Omit<WorkflowDef, 'id'>>): Promise<WorkflowDef> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const rows: WorkflowRow[] = await res.json();
  return rowToDef(rows[0]);
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: headers() }
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function copyWorkflow(id: string): Promise<WorkflowDef> {
  const src = await getWorkflow(id);
  if (!src) throw new Error(`工作流 ${id} 不存在`);
  return createWorkflow({ ...src, id: crypto.randomUUID(), name: `${src.name} (副本)` });
}

/** 首次使用时，确保 workflows 表存在（通过 rpc exec_sql 若有权限） */
export async function ensureTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      nodes JSONB NOT NULL DEFAULT '[]',
      vars JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  // 尝试 rpc，失败则忽略（表可能已存在）
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ sql }),
  }).catch(() => {});
}
