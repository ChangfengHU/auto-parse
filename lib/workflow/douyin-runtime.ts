import type { WorkflowDef } from './types';

export function remoteDouyinEndpoint(workflow: WorkflowDef, configuredUrl?: string): string | null {
  const active = workflow.nodes.filter(n => !n.disabled);
  const remote = active.filter(n => n.type === 'credential_login' && n.params.useExistingBrowser === true);
  if (!remote.length) return null;
  if (remote.length !== 1 || remote[0].params.platform !== 'douyin' ||
      remote[0].params.verifyDouyinCreator !== true ||
      active.some(n => n.type === 'credential_login' && n !== remote[0]) ||
      active.some(n => n.type === 'navigate' && (n.params.useAdsPower || n.params.adsManualCdpUrl)) ||
      active.some(n => n.type === 'file_upload' && n.params.transferMode !== 'buffer')) {
    throw new Error('remote_browser_workflow_invalid');
  }
  if (!configuredUrl) throw new Error('remote_browser_not_configured');
  let url: URL;
  try { url = new URL(configuredUrl); } catch { throw new Error('remote_browser_endpoint_invalid'); }
  // Only an operator-owned loopback tunnel, never a workflow-supplied remote host.
  if (!['http:', 'ws:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('remote_browser_endpoint_invalid');
  }
  return url.href;
}

// Shared across Next.js route bundles/hot reloads within this service process.
const remoteState = globalThis as typeof globalThis & { __douyinRemoteLeases?: Set<string> };
const remoteLeases = remoteState.__douyinRemoteLeases ??= new Set<string>();
export function acquireRemoteDouyinBrowser(endpoint: string): () => void {
  const key = new URL(endpoint).origin;
  if (remoteLeases.has(key)) throw new Error('remote_browser_busy');
  remoteLeases.add(key);
  return () => { remoteLeases.delete(key); };
}

export function needsIsolatedDouyinBrowser(workflow: WorkflowDef): boolean {
  const active = workflow.nodes.filter(n => !n.disabled);
  if (!active.some(n => n.type === 'douyin_publish')) return false;
  if (active.some(n => n.type === 'navigate' && (n.params.useAdsPower || n.params.adsManualCdpUrl))) {
    throw new Error('publication_shared_browser_not_allowed');
  }
  return true;
}
