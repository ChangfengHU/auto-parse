# WORKFLOW-003: workflow authoring MCP

Status: Done (upload/draft scope; public publication and local MP4 playback excluded)

## Scope

Expose the existing workflow authoring and debug runtime to a trusted AI client, using the same Supabase definitions as `/workflows`. Fix defects in the shared implementation, not only in an MCP wrapper. Preserve existing publication workflows and unrelated working-tree changes. No real publication is authorized by this implementation task.

## Initial findings

- Debug sessions permit overlapping step requests and remote interactions.
- A positive `waitAfter` condition can time out while the node remains successful.
- Session disposal does not stop its idle simulator or disconnect an owned CDP connection.
- Workflow writes need structural validation; AI edits need optimistic concurrency checks.
- Catalog responses must not disclose embedded credential defaults.

## Initial verification (before the continuation below)

- 17 focused workflow/MCP tests passed; the broader selected workflow/Douyin regression set passed 101/101. Focused ESLint, independent TypeScript checking and production compilation passed.
- Authenticated loopback canary passed initialize/notification/tool discovery (16 tools), bearer/Origin rejection, node catalog, real Supabase create/read/update/copy/list, and stale-revision rejection. Two temporary empty test drafts were removed; no user workflow was deleted.
- Protected original and approved publication copy were read before/after the real database acceptance and their response digests were unchanged.
- An additional installed-runtime regression exposed two failures: the installed image-service hard restart and soft recycle functions do not acquire the cross-process browser activity lock. Existing CDP guard tests passed. No actual browser restart is performed by these tests.
- Production service/build selection and browser login were not changed. No video was uploaded or published. Browser acceptance and production rollout remain pending the shared-service safety repair; permission was requested because it crosses the auto-parse repository boundary.

## Implemented

- Authenticated MCP at `/api/workflows/mcp`, shared catalog and Supabase CRUD with revision checks.
- Task-owned browser sessions, single-step/remaining-step execution, async polling, screenshots as MCP image content, pending-node edits and save/stop/close.
- Explicit capability limits, process-local session lifetime and no implicit publication authorization.
- Shared fixes for postcondition false success, session concurrency, disposal, screenshot failure, duplicate node IDs and credential defaults.
- Installation/configuration and limitations are documented in `docs/workflow-authoring-mcp.md`.

## Initial rollout gates (resolved below)

1. Repair the shared browser maintenance service through its owning source/deployment workflow, not by patching the installed bundle.
2. Rerun the full installed browser-lock regression, rebuild after final changes, then test the provided video through workflow MCP on browser 1, stopping before publication.
3. Verify the preview, production route and endpoint-scoped Vault connection before calling the capability shipped.

## 2026-10-17 continuation and real browser acceptance

The owner clarified that acceptance means operating the logged-in browser and actually uploading the supplied video. The shared Fleet source repair was committed/pushed as `a245179`, deployed only to host84 via its owning deployment script, and verified at 86/86 installed files. Hard restart and soft recycle now honor workflow activity locks. Browser PIDs 3512914 and 3491468 remained unchanged before/after both service rollouts; login/profile data was not replaced.

- Production uses `ops/workflow-mcp-build.env` and its systemd drop-in, currently `.next-workflow-mcp-shadow-20261017`; the preceding build is retained as rollback. The temporary loopback canary was stopped. Before each auto-parse restart, task/dispatcher queues were idle and both browser activity locks were acquired.
- Bearer authentication on the public endpoint was verified using the derived endpoint-only credential. Vault `service:auto-parse-workflow-mcp` was provisioned without exposing the credential. No marketplace registration is claimed.
- Supabase workflow `6105efc6-7e54-4c85-acfe-1a37e0d5093f` is a new nine-node upload/draft workflow, not a replacement for protected Douyin definitions.
- One actual upload of the owner-provided rain-last-order MP4 ran through production MCP on browser1. The UI showed upload progress, then `重新上传`, a 720p recommendation, filled title/body and generated cover. No public publish action was invoked.
- The initial save-by-text node failed because the footer is a closed Shadow DOM component, not an iframe (the early iframe hypothesis was disproved). Added an explicit `shadowHostSelector` exact-button path to the shared click node and editor/MCP catalog. It refuses ambiguity, disabled/obscured controls and mixed targets, and detaches CDP on error. The existing guarded Douyin adapter rejects mixing this mode.
- After 19 new safety tests, the shared node was executed once against the already-owned paused task tab to preserve the upload without replaying it. The UI showed one local video draft, title `雨夜最后一单`, duration `0:49`.
- After deploying the new node, a new production MCP session reopened the existing draft, edited it, saved using the new closed-shadow mode and reread it: 5/5 passed. The draft count remained one; no video was reuploaded. The saved nine-node definition includes stronger readiness/postcondition checks but was not replayed end-to-end to avoid a duplicate draft.
- Final combined selected regressions: 131/131. Independent `tsc --noEmit`, focused ESLint, whitespace checks and production compilation passed. Earlier authenticated CRUD acceptance verified both protected Douyin definition digests unchanged.

## Honest remaining limits

- The installed browser does not decode this H.264/AAC MP4: `canPlayType` returns empty and the player reports `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. Upload and draft persistence are proven, playable local preview is not. No browser package/profile restart was attempted to address codecs.
- Xiaohongshu states drafts reside in the current browser and are removed by clearing browser data. This is not a cloud draft or a published note. Do not claim a public URL/publication receipt.
- Automatic observation covers the main DOM, not every iframe or closed-shadow descendant. Exact closed-button targeting is supported after identifying its host.
- Source entry commit `9f03c81` and Fleet repair `a245179` were pushed. This continuation commits its own source/config/docs only; unrelated materials, parser, R2, audio-build and existing tsconfig changes remain untouched.
