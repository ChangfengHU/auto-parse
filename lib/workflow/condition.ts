import type { NodeDef } from './types';

/** Never use truthiness: the string "false" must not authorize publication. */
export function booleanVariable(value: unknown, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('condition_variable_must_be_true_or_false');
}

export function shouldExecuteNode(node: NodeDef, vars: Record<string, string>): boolean {
  if (!node.runIf) return true;
  const { variable, equals } = node.runIf;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable) || typeof equals !== 'boolean') throw new Error('invalid_node_condition');
  return booleanVariable(vars[variable]) === equals;
}
