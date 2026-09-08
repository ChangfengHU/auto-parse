import path from 'node:path';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { getWorkflow } from './workflow-db';
import { startWorkflowTask, getWorkflowTask } from './workflow-task-cli';
import { publicationIdentity, readPublication } from './douyin-publication-ledger';
import type { ClickParams } from './types';
import { validateCoverUrl } from './douyin-cover';

export const DOUYIN_WORKFLOW_ID = '34f421be-f97c-498a-9c80-5214564abd1c';
export type DouyinWorkflowInput = NonNullable<ClickParams['douyinPublication']>;

export async function startDouyinWorkflow(input: DouyinWorkflowInput) {
  if (input.prepareOnly === true ? input.confirmPublish !== false : input.confirmPublish !== true) {
    throw new Error('publication_confirmation_required');
  }
  if (typeof input.aiGenerated !== 'boolean' || typeof input.description !== 'string' ||
      !Array.isArray(input.topics) || input.topics.length > 5 ||
      input.topics.some(topic => typeof topic !== 'string' || !/^[\p{L}\p{N}_]{1,30}$/u.test(topic)) ||
      input.description.length > 900) throw new Error('publication_metadata_invalid');
  const identity = publicationIdentity(input.requestId, input.expectedAccountId, input.videoUrl, input.title, input.aiGenerated, input);
  if (input.cover) {
    if (!input.cover.verticalUrl && !input.cover.horizontalUrl) throw new Error('publication_cover_input_invalid');
    for (const url of [input.cover.verticalUrl, input.cover.horizontalUrl]) if (url) validateCoverUrl(url);
  }
  const directory = path.join(process.cwd(), '.data');
  if (!input.prepareOnly) {
    const publication = await readPublication(path.join(directory, 'douyin-publications'), identity.key, identity.fingerprint);
    if (publication?.receipt) return { ok: true, status: 'published', receipt: publication.receipt, reused: true };
  }
  const workflow = await getWorkflow(DOUYIN_WORKFLOW_ID);
  const types = ['material', 'navigate', 'qrcode', 'navigate', 'file_upload', 'wait_condition', 'text_input',
    'scroll', 'wait_condition', 'click', 'click', 'wait_condition', 'screenshot'];
  if (!workflow || workflow.nodes.length !== types.length || workflow.nodes.some((n, i) => n.type !== types[i]) ||
      workflow.nodes[1].params.adsManualCdpUrl !== 'http://127.0.0.1:9223') throw new Error('publication_workflow_contract_changed');
  // Only approved input fields are projected onto an execution snapshot of the
  // real Supabase copy. Neither the original nor the stored copy is rewritten.
  const snapshot = structuredClone(workflow);
  snapshot.nodes[0].params = { ...snapshot.nodes[0].params, videoUrl: input.videoUrl, title: input.title };
  snapshot.nodes[4].params.transferMode = 'buffer';
  snapshot.nodes[6].params = { ...snapshot.nodes[6].params, selector: '[contenteditable="true"]', value: input.description };
  snapshot.nodes[9].params = { text: '发布', douyinPublication: input };
  snapshot.nodes[9].disabled = false;
  snapshot.nodes[10].disabled = true;
  snapshot.nodes[11].disabled = Boolean(input.prepareOnly);
  snapshot.nodes[12].disabled = false;
  const requestDirectory = path.join(directory, 'douyin-workflow-requests');
  await mkdir(requestDirectory, { recursive: true, mode: 0o700 });
  const requestFile = path.join(requestDirectory, (input.prepareOnly ? 'preview-' : 'publish-') + identity.key + '.json');
  let reservation;
  try { reservation = await open(requestFile, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(requestFile, 'utf8'));
    if (previous.fingerprint !== identity.fingerprint) throw new Error('publication_request_conflict');
    if (!previous.taskId) throw new Error('publication_start_unknown_do_not_retry');
    const task = getWorkflowTask(previous.taskId);
    return { ok: true, taskId: previous.taskId, workflowId: workflow.id, status: task?.status || 'unknown', reused: true };
  }
  try { await reservation.writeFile(JSON.stringify({ fingerprint: identity.fingerprint, state: 'starting' })); await reservation.sync(); }
  finally { await reservation.close(); }
  const task = await startWorkflowTask({ workflowId: workflow.id, workflow: snapshot, vars: {} });
  await writeFile(requestFile, JSON.stringify({ fingerprint: identity.fingerprint, taskId: task.taskId }), { mode: 0o600 });
  return { ok: true, taskId: task.taskId, workflowId: workflow.id, status: task.status, prepareOnly: Boolean(input.prepareOnly) };
}
