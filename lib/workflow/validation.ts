import { NODE_CATALOG } from './node-catalog';
import type { WorkflowDef } from './types';

export class WorkflowInputError extends Error { status = 400; }
export class WorkflowConflictError extends Error { status = 409; }
export const PROTECTED_WORKFLOW_IDS = new Set(['douyin-publish', '34f421be-f97c-498a-9c80-5214564abd1c']);
export function assertWorkflowMutable(id: string) {
  if (PROTECTED_WORKFLOW_IDS.has(id)) throw new WorkflowConflictError('protected_workflow_copy_first');
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
export function validateWorkflow(value: unknown): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['workflow must be an object'], warnings };
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) errors.push('name must contain 1–200 characters');
  if (value.description !== undefined && typeof value.description !== 'string') errors.push('description must be a string');
  if (!Array.isArray(value.vars) || value.vars.some(v => typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v))) errors.push('vars must be an array of safe variable names');
  if (Array.isArray(value.vars) && new Set(value.vars).size !== value.vars.length) errors.push('vars contains duplicates');
  if (!Array.isArray(value.nodes) || value.nodes.length > 200) errors.push('nodes must be an array with at most 200 nodes');
  else {
    const ids = new Set<string>();
    value.nodes.forEach((node, index) => {
      const label = `nodes[${index}]`;
      if (!isRecord(node)) { errors.push(`${label} must be an object`); return; }
      const catalog = NODE_CATALOG.find(c => c.type === node.type);
      if (!catalog) errors.push(`${label}.type is unknown`);
      if (!isRecord(node.params)) errors.push(`${label}.params must be an object`);
      for (const key of ['disabled', 'continueOnError', 'autoScreenshot']) if (node[key] !== undefined && typeof node[key] !== 'boolean') errors.push(`${label}.${key} must be boolean`);
      for (const key of ['id', 'label', 'url']) if (node[key] !== undefined && typeof node[key] !== 'string') errors.push(`${label}.${key} must be a string`);
      if (typeof node.id === 'string') { if (ids.has(node.id)) errors.push(`${label}.id is duplicated`); ids.add(node.id); }
      if (node.runIf !== undefined && (!isRecord(node.runIf) || typeof node.runIf.variable !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_]*$/.test(node.runIf.variable) || typeof node.runIf.equals !== 'boolean' ||
          Object.keys(node.runIf).some(k => !['variable', 'equals'].includes(k)))) errors.push(`${label}.runIf must contain variable and boolean equals`);
      if (node.waitAfter !== undefined) {
        if (!isRecord(node.waitAfter)) errors.push(`${label}.waitAfter must be an object`);
        else {
          const wait = node.waitAfter;
          for (const key of ['timeout', 'delaySeconds']) if (wait[key] !== undefined && (typeof wait[key] !== 'number' || !Number.isFinite(wait[key]) || Number(wait[key]) < 0)) errors.push(`${label}.waitAfter.${key} must be nonnegative`);
          for (const key of ['successKeywords', 'failKeywords']) if (wait[key] !== undefined && (!Array.isArray(wait[key]) || (wait[key] as unknown[]).some(x => typeof x !== 'string' || !x))) errors.push(`${label}.waitAfter.${key} must contain nonempty strings`);
          if (wait.enabled !== undefined && typeof wait.enabled !== 'boolean') errors.push(`${label}.waitAfter.enabled must be boolean`);
          if (wait.action !== undefined && !['appeared', 'disappeared', 'url_match'].includes(String(wait.action))) errors.push(`${label}.waitAfter.action is invalid`);
          for (const key of ['selector', 'urlContains']) if (wait[key] !== undefined && typeof wait[key] !== 'string') errors.push(`${label}.waitAfter.${key} must be a string`);
        }
      }
      if (isRecord(node.params) && node.params.timeoutAction === 'continue') warnings.push(`${label}: wait timeout is configured to continue, not prove success`);
      if (node.continueOnError) warnings.push(`${label}: execution continues on failure`);
    });
    if (!value.nodes.length) warnings.push('empty draft: add nodes before execution');
  }
  return { valid: errors.length === 0, errors, warnings };
}
export function assertWorkflowShape(value: unknown): asserts value is WorkflowDef {
  const result = validateWorkflow(value);
  if (!result.valid) throw new WorkflowInputError(result.errors.join('; '));
}

const SECRET_FIELD = /password|cookie|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key/i;
export function redactWorkflowData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWorkflowData);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    SECRET_FIELD.test(key) && item ? '[REDACTED]' : redactWorkflowData(item)]));
}
