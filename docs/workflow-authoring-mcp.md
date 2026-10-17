# Workflow authoring MCP

Server: `auto-parse-workflow` (trusted owner/operator access, not a public anonymous service).

Release status (2026-10-17): production endpoint, authenticated CRUD, real browser upload and saved-draft round-trip verified on host84/browser1. The endpoint-scoped connection is in Vault `service:auto-parse-workflow-mcp`. Public Xiaohongshu publication and local MP4 playback are not verified/supported by this acceptance.

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
- Do not include publish/submit nodes in a preparation-only workflow. A real publication requires separately approved content/account and a platform-specific receipt guard. The existing protected Douyin workflow must use its dedicated adapter.
- Credential-valued fields are redacted in responses and rejected in AI-authored definitions. Keep credentials on the server.
- Debug sessions and their request deduplication are process-local, expire after 20 idle minutes and do not survive restart. A missing session after an uncertain upload or submission is not permission to replay it.
- The first release executes the basic browser, upload, material, wait and QR nodes listed by capabilities. Other catalog nodes can be inspected/saved but are not falsely advertised as supported managed-debug execution.
- MCP-managed sessions cannot be controlled or read through the older unauthenticated debug routes.
- Public marketplace registration and installation into every AI client are separate from hosting a verified MCP endpoint.
- For a closed Shadow DOM button, the shared `click` node accepts `shadowHostSelector` plus exact `text`. It requires one host and one actionable, unobscured matching button and sends a native browser mouse click. It does not guess fixed coordinates, fall back to another action, or mix with selector/multi-target/publication-adapter modes. Main-DOM observation still does not enumerate closed-shadow internals or iframe fields automatically.

## Verified Xiaohongshu example

Workflow: `/workflows/6105efc6-7e54-4c85-acfe-1a37e0d5093f`, using the existing host84 browser1 login. Inputs: `videoUrl`, `title`, `description`. Nine saved nodes navigate, open upload, transfer the file, dismiss an optional first-use guide, fill title/body, verify upload completion, save a draft and read it back. No public-publish node is present.

The provided approximately 50-second MP4 was uploaded once through production MCP. A normal text click could not see Xiaohongshu's closed `xhs-publish-btn`; the new shared node first preserved that existing upload as a draft. After rollout, a fresh production MCP session reopened, edited, saved and reread the same draft: 5/5 steps, one draft, no second upload. The final nine-node definition incorporates the tested nodes and stronger readiness guards; it was not replayed from upload to create a duplicate.

Xiaohongshu explicitly reports these drafts as local to the current browser; clearing browser data removes them. This is not a published note, server-side draft guarantee or publication receipt. The installed browser returns unsupported for this H.264/AAC MP4 and reports `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`; local playback remains unverified. The source is 720p and the site recommends 1080p, without blocking upload.

## Verification

`node --test scripts/test-workflow-authoring-mcp.mjs`

Closed-shadow targeting regression: `node --test scripts/test-shadow-button.mjs`. The selected combined workflow, upload, maintenance-lock and Douyin suite passed 131/131 after this repair; independent TypeScript, focused ESLint and production build passed.

`node scripts/verify-workflow-mcp.mjs` accepts loopback endpoint plus `adminToken` or endpoint `token` via JSON on stdin (never command arguments). It tests real Supabase CRUD on empty disposable drafts, removes only those drafts, and verifies protected definitions did not change. It never opens a browser.

Transport reference: [MCP Streamable HTTP, protocol 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

Use an authorized draft and non-publishing browser test before production use. Source tests alone do not establish that a platform publication works.
