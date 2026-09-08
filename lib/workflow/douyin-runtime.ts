import type { WorkflowDef } from './types';

export function needsIsolatedDouyinBrowser(workflow: WorkflowDef): boolean {
  const active = workflow.nodes.filter(n => !n.disabled);
  if (!active.some(n => n.type === 'douyin_publish')) return false;
  if (active.some(n => n.type === 'navigate' && (n.params.useAdsPower || n.params.adsManualCdpUrl))) {
    throw new Error('publication_shared_browser_not_allowed');
  }
  return true;
}

export async function verifyDouyinDispatch(): Promise<void> {
  const nodeId = process.env.FLEET_NODE_ID;
  if (!nodeId) throw new Error('fleet_node_identity_missing');
  const response = await fetch('https://fleet.vyibc.com/api/fleet', {
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('fleet_preflight_unavailable');
  const body = await response.json() as { nodes?: Array<{ id: string; reachable: boolean; dispatchHeld: boolean }> };
  const node = body.nodes?.find(n => n.id === nodeId);
  if (!node || node.reachable !== true || node.dispatchHeld !== false) throw new Error('fleet_dispatch_unavailable');
}
