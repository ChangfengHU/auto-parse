import type { WorkflowDef } from './types';

export function needsIsolatedDouyinBrowser(workflow: WorkflowDef): boolean {
  const active = workflow.nodes.filter(n => !n.disabled);
  if (!active.some(n => n.type === 'douyin_publish')) return false;
  if (active.some(n => n.type === 'navigate' && (n.params.useAdsPower || n.params.adsManualCdpUrl))) {
    throw new Error('publication_shared_browser_not_allowed');
  }
  return true;
}
