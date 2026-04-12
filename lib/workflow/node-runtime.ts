import type { NavigateParams, NodeDef, NodeType, WorkflowDef } from './types';

const BROWSERLESS_NODE_TYPES = new Set<NodeType>(['topic_picker_agent', 'agent_react']);

export function nodeRequiresBrowser(node: Pick<NodeDef, 'type'>): boolean {
  return !BROWSERLESS_NODE_TYPES.has(node.type);
}

export function shouldDeferNativePageBootstrap(workflow: WorkflowDef): boolean {
  const firstNode = workflow.nodes[0];
  if (!firstNode) return true;
  if (!nodeRequiresBrowser(firstNode)) return true;
  if (firstNode.type !== 'navigate') return false;
  const params = (firstNode.params ?? {}) as Partial<NavigateParams>;
  return !!params.useAdsPower;
}
