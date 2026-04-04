/**
 * Workflow CRUD — Supabase REST API
 */
import type { WorkflowDef } from './types';
import { normalizeDouyinPublishWorkflow } from './workflows/douyin-publish';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

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
  return normalizeDouyinPublishWorkflow({
    id: row.id,
    name: row.name,
    description: row.description,
    nodes: row.nodes,
    vars: row.vars,
  });
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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(await res.text());
  const rows: WorkflowRow[] = await res.json();
  return rows[0] ? rowToDef(rows[0]) : null;
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
