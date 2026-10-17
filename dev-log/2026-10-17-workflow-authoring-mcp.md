# WORKFLOW-003: workflow authoring MCP

Status: In Progress

## Scope

Expose the existing workflow authoring and debug runtime to a trusted AI client, using the same Supabase definitions as `/workflows`. Fix defects in the shared implementation, not only in an MCP wrapper. Preserve existing publication workflows and unrelated working-tree changes. No real publication is authorized by this implementation task.

## Initial findings

- Debug sessions permit overlapping step requests and remote interactions.
- A positive `waitAfter` condition can time out while the node remains successful.
- Session disposal does not stop its idle simulator or disconnect an owned CDP connection.
- Workflow writes need structural validation; AI edits need optimistic concurrency checks.
- Catalog responses must not disclose embedded credential defaults.

## Verification

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

## Resume gates

1. Repair the shared browser maintenance service through its owning source/deployment workflow, not by patching the installed bundle.
2. Rerun the full installed browser-lock regression, rebuild after final changes, then test the provided video through workflow MCP on browser 1, stopping before publication.
3. Verify the preview, production route and endpoint-scoped Vault connection before calling the capability shipped.
