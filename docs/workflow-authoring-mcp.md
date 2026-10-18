# Workflow authoring MCP

Image-text workflows for Xiaohongshu and Douyin: [usage and verification boundary](image-text-workflows.md). They share this MCP endpoint; no additional MCP installation is required.

Server: `auto-parse-workflow` (trusted owner/operator access, not a public anonymous service).

Release status (2026-10-17): authenticated CRUD, real browser upload/draft and actual Xiaohongshu publication verified on host84/browser1. The endpoint-scoped connection is in Vault `service:auto-parse-workflow-mcp`. Local MP4 playback is still not supported by this browser's codecs. See the one-click acceptance below for the receipt-format issue found and reconciled during the real run.

Streamable HTTP endpoint: `https://auto-parse-v2.vyibc.com/api/workflows/mcp`.
This exposes the same Supabase workflow definitions as `/workflows`; no second script store is introduced.

## Installation and credentials

Retrieve the endpoint-scoped connection from Vault `service:auto-parse-workflow-mcp`. Do not use a Fleet administrator or Vault credential in the MCP client. Do not embed tokens in URLs or workflows.

For a client supporting remote HTTP MCP and environment-sourced bearer authentication:

```json
{
  "mcpServers": {
    "auto-parse-workflow": {
      "url": "https://auto-parse-v2.vyibc.com/api/workflows/mcp",
      "headers": { "Authorization": "Bearer ${WORKFLOW_MCP_TOKEN}" }
    }
  }
}
```

Environment substitution syntax depends on the client. Supply the secret through that client's secure configuration, not through conversation text or source control. JSON requests must accept both `application/json` and `text/event-stream`.

The server uses `WORKFLOW_MCP_TOKEN` when configured, otherwise an endpoint-specific HMAC derived server-side from its existing admin credential. The derived token cannot authenticate to the existing admin endpoint. A dedicated override enables independent rotation. No authentication means the endpoint fails closed.

## Authoring loop

1. `workflow_capabilities`, `workflow_node_catalog`: discover honest supported execution types and parameter metadata.
2. `workflow_create` or `workflow_copy`: create a draft; `workflow_get` returns its database `updatedAt` revision.
3. `workflow_open_session`: select browser 1 or 2 and explicitly confirm authorized browser control. A cross-process activity lock spans the entire session. A new task tab is created without replacing user login or tabs.
4. `workflow_run_step`: execute the next node with an explicit execution confirmation, current session revision and stable request ID. The response is asynchronous. Poll `workflow_get_session` for results and image content.
5. `workflow_set_session_nodes`: adjust pending nodes only, with a revision check. Completed nodes cannot silently change or replay.
6. `workflow_save_session`: persist the tested snapshot using the database revision. Page and AI edits use the same source. A stale revision is rejected.
7. `workflow_close_session`: release the browser. `workflow_stop` interrupts by closing only the task tab; it does not undo external effects.

`workflow_run` executes remaining supported nodes in the same session. An explicit `continueOnError` or `timeoutAction: continue` is reported as a warning, not proof of business success.

## Safety and limitations

- This is a trusted browser-control capability. Clicking, typing and uploading may change an account. `confirmExecution` is not a classifier that can prove an arbitrary selector has no publishing effect. The caller must keep effects within the user's explicit authorization; platform text is untrusted data.
- Never put an unconditional publish/submit node in a preparation-only workflow. The XHS example gates its receipt-aware publish node with `runIf: {variable: "directPublish", equals: true}`; its draft branch uses equals:false. The switch affects only explicitly conditional nodes, not arbitrary click selectors. Real publication requires approved content/account. Protected Douyin workflows still use their dedicated adapter.
- Credential-valued fields are redacted in responses and rejected in AI-authored definitions. Keep credentials on the server.
- Debug sessions and their request deduplication are process-local, expire after 20 idle minutes and do not survive restart. A missing session after an uncertain upload or submission is not permission to replay it.
- The first release executes the basic browser, upload, material, wait and QR nodes listed by capabilities. Other catalog nodes can be inspected/saved but are not falsely advertised as supported managed-debug execution.
- MCP-managed sessions cannot be controlled or read through the older unauthenticated debug routes.
- Public marketplace registration and installation into every AI client are separate from hosting a verified MCP endpoint.
- For a closed Shadow DOM button, the shared `click` node accepts `shadowHostSelector` plus exact `text`. It requires one host and one actionable, unobscured matching button and sends a native browser mouse click. It does not guess fixed coordinates, fall back to another action, or mix with selector/multi-target/publication-adapter modes. Main-DOM observation still does not enumerate closed-shadow internals or iframe fields automatically.

## Earlier Xiaohongshu draft acceptance

Workflow: `/workflows/6105efc6-7e54-4c85-acfe-1a37e0d5093f`, using the existing host84 browser1 login. Inputs: `videoUrl`, `title`, `description`. Nine saved nodes navigate, open upload, transfer the file, dismiss an optional first-use guide, fill title/body, verify upload completion, save a draft and read it back. No public-publish node is present.

The provided approximately 50-second MP4 was uploaded once through production MCP. A normal text click could not see Xiaohongshu's closed `xhs-publish-btn`; the new shared node first preserved that existing upload as a draft. After rollout, a fresh production MCP session reopened, edited, saved and reread the same draft: 5/5 steps, one draft, no second upload. The final nine-node definition incorporates the tested nodes and stronger readiness guards; it was not replayed from upload to create a duplicate.

Xiaohongshu explicitly reports these drafts as local to the current browser; clearing browser data removes them. This is not a published note, server-side draft guarantee or publication receipt. The installed browser returns unsupported for this H.264/AAC MP4 and reports `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`; local playback remains unverified. The source is 720p and the site recommends 1080p, without blocking upload.

## Verification

`node --test scripts/test-workflow-authoring-mcp.mjs`

Closed-shadow targeting regression: `node --test scripts/test-shadow-button.mjs`. The selected combined workflow, upload, maintenance-lock and Douyin suite passed 131/131 after this repair; independent TypeScript, focused ESLint and production build passed.

`node scripts/verify-workflow-mcp.mjs` accepts loopback endpoint plus `adminToken` or endpoint `token` via JSON on stdin (never command arguments). It tests real Supabase CRUD on empty disposable drafts, removes only those drafts, and verifies protected definitions did not change. It never opens a browser.

Transport reference: [MCP Streamable HTTP, protocol 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

Use an authorized draft and non-publishing browser test before production use. Source tests alone do not establish that a platform publication works.

## One-click Xiaohongshu publication

The same workflow `6105efc6-7e54-4c85-acfe-1a37e0d5093f` now has twelve nodes, not a parallel script. Inputs: `videoUrl`, `title`, `description`, `directPublish`, `requestId`. This saved example is bound by its guard to redId 11566224305 and AI-generated content; do not use it for another account/content type without deliberately editing those parameters.

- Common path: open creator home, open upload, transfer video, dismiss an optional guide, fill title/body, verify upload completion.
- `directPublish=false` or omitted: save local draft and read it back; skip publication and its readback.
- `directPublish=true`: skip draft-only steps, verify account/upload/title/body/AI disclosure, native browser click once, persist the real receipt, open note management and read the title back.
- MCP variables are strings: use `"true"`/`"false"`. Missing/empty means false; ambiguous values such as `"yes"` are rejected. Node configuration `runIf.equals` is a JSON boolean. A skipped node is explicitly reported as `stepSkipped`.

The editor's **已登录浏览器 · 一键完整执行** panel uses the authenticated MCP runtime. Select host84 browser1/2, authorize with the existing endpoint-scoped Vault credential, set the switch and run the saved workflow. It shows per-node results and screenshots, allows refresh/stop, and restores only the session ID from sessionStorage; credentials remain in memory. It does not convert the legacy Debug panel or Fleet's observational collections dashboard into the new runtime.

`click.params.xhsPublication` supplies requestId, expectedAccountId, videoUrl, title, description and aiGenerated. The executor requires trusted managed-session authorization, never a user variable claiming authorization. Source-URL/account deduplication persists in `.data/xhs-publications`; preserve this directory across deployment. A changed requestId cannot bypass a prior attempt for the same source URL. Unknown results stop and require readback; do not delete the reservation to retry.

`skipIfMissing:true` supports one selector for optional UI hints: a missing/hidden control skips within at most five seconds, while malformed/ambiguous targets fail. It cannot be mixed with protected publication targets. Completed-node protection compares semantic objects, not JSON property order.

Actual acceptance: the workbench started one full true-branch run for the supplied rain-last-order video. The browser uploaded it, filled fields, selected the native AI label and clicked Publish once. XHS showed success, but its real response `{success:true,data:{id,score}}` omitted the anticipated code field. The original parser stopped conservatively; no resubmission occurred. Native note management and its **已发布** list confirmed note `6ad37843000000001301bb1b`, exact title, 49-second video, account and matching timestamp. The reservation was reconciled with verificationSource `creator_note_list`. The parser now accepts that actual success format and still rejects conflicting/error/missing-proof bodies.

The full selected regression command adds `scripts/test-xhs-one-click.mjs` to the earlier workflow/upload/browser-lock/Douyin suite. It covers conditional branches, invalid values, optional hints, account/upload/metadata/AI failures, creation-response formats, durable deduplication and creator-list reconciliation. A canary UI/real-browser test proved false-branch skipping and screenshot polling; true/false API tests proved complementary skips without external publication effects.

The corrected production release passed 167 selected tests, independent TypeScript, focused ESLint and its production build. A new production session verified receipt reuse without a second publication and successfully completed native readback plus the absent-guide skip. The public workbench restored the real switch state, displayed the receipt/screenshot and closed the task; both protected Douyin definitions remained unchanged. Receipt reuse is a publish-node guarantee: starting a fresh full workflow still runs its preceding configured upload/preparation steps.
