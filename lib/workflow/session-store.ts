/**
 * 工作流 Debug Session 存储
 * 使用 global 变量跨 Next.js 热重载保持实例
 */
import { randomUUID } from 'crypto';
import type { WorkflowSession } from './types';

declare global {
  var __workflowSessions: Map<string, WorkflowSession> | undefined;
  var __workflowSessionOperations: Set<string> | undefined;
}

/** One writer per live session, shared by UI and MCP. Acquire before any await. */
export function acquireSessionOperation(id: string): (() => void) | null {
  const locks = global.__workflowSessionOperations ??= new Set<string>();
  if (locks.has(id)) return null;
  locks.add(id);
  let released = false;
  return () => { if (!released) { released = true; locks.delete(id); } };
}

function store(): Map<string, WorkflowSession> {
  if (!global.__workflowSessions) {
    global.__workflowSessions = new Map();
  }
  return global.__workflowSessions;
}

export function createSession(
  partial: Omit<WorkflowSession, 'id' | 'createdAt' | 'history' | 'currentStep' | 'status' | 'initialVars'>
): WorkflowSession {
  const session: WorkflowSession = {
    ...partial,
    id: randomUUID(),
    initialVars: { ...(partial.vars ?? {}) },
    currentStep: 0,
    lastExecutedStep: null,
    status: 'paused',
    history: [],
    createdAt: Date.now(),
  };
  store().set(session.id, session);
  return session;
}

export function getSession(id: string): WorkflowSession | undefined {
  return store().get(id);
}

export function updateSession(id: string, patch: Partial<WorkflowSession>): WorkflowSession | undefined {
  const s = store().get(id);
  if (!s) return undefined;
  const updated = { ...s, ...patch };
  store().set(id, updated);
  return updated;
}

export function deleteSession(id: string): boolean {
  return store().delete(id);
}

export function listSessions(): WorkflowSession[] {
  return Array.from(store().values()).filter(s => !s._managedByMcp).map(s => ({ ...s, _page: undefined, _browser: undefined, _idleSim: undefined }));
}

export function listLiveSessions(): WorkflowSession[] {
  return Array.from(store().values());
}
