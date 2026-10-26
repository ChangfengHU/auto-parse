# X text posting through AutoParse

The formal workflow and editor use Supabase rpa_workflows; do not add a parallel publisher or local JSON fallback. Use the existing authenticated /api/workflows/mcp endpoint and a browser already logged into the intended X account. Credentials remain in the existing Vault connector.

## Inputs and supported scope

- expectedUsername: the X @username, not display name.
- text: exact nonempty text, no leading/trailing whitespace or unresolved templates. Maximum request text size is 10,000 UTF-8 bytes; this is a local input bound, not an X character allowance. X's enabled Post button determines whether the current account accepts the text.
- requestId: stable 8–100 character letters/digits/underscore/hyphen ID.
- directPublish: string "false" by default. "true" requires actual user authorization.

This release supports a single text post, including Unicode, line breaks and hashtags. Images, videos, replies, quotes, threads, scheduling and long Premium posts are not accepted as supported functionality. It controls the existing web composer; it does not require an X developer API subscription, but depends on the current UI and a valid browser session.

## Workbench

Open the saved X workflow from /workflows, enter the runtime variables, select the logged-in browser, and provide the existing workflow MCP credential in memory. Leave Direct publish unchecked for preparation. The two x_publish nodes use prepare then conditional publish. A final screenshot captures the resulting page.

Preparation fills and verifies the composer, returns prepared=true/published=false and leaves a task-owned tab. It is not a promise of cloud draft storage. Stop/close ends only that tab. Do not use the legacy unauthenticated debugger for this node: managed publication authorization is server-owned.

## MCP

1. workflow_capabilities and workflow_node_catalog(type="x_publish").
2. workflow_list to locate the X workflow, then workflow_get.
3. workflow_open_session with workflowId, browserInstance, confirmBrowserControl=true and string vars expectedUsername/text/requestId/directPublish.
4. workflow_run with returned sessionId/expectedRevision, stable operation requestId and confirmExecution=true. Confirm only user-authorized effects.
5. Poll workflow_get_session; inspect history and screenshot. Keep the same operation/session after transport failure.
6. workflow_close_session after review.

Publishing requires both the conditional branch and server-checked directPublish=true. It checks same-session preparation proof, exact current text, single composer, no attachments/thread, matching account and enabled Post control. A disk-synced atomic reservation precedes the one click. A native CreateTweet response must carry a string post ID, matching author and exact text before a saved receipt is reported. HTTP 200 or a toast alone is insufficient. Creation confirmed does not mean public visibility independently checked.

x_publication_status accepts expectedUsername/text/requestId and reads the durable local record even after a server restart. It makes no publishing request and does not check X public visibility:
- not_submitted: no local reservation found; no external-state claim.
- submitting: outcome unknown, do not automatically retry.
- published: saved creation evidence including postId/postUrl; visibility remains unverified.

The ledger is .data/x-publications with directory 700/files 600, preserved across deployments and backups. Its key is account+normalized exact content, not requestId; changing requestId cannot resend identical content. It stores hashes, request ID, timestamps and receipt, not credentials or plaintext draft text. This is single-host durable deduplication, not a distributed ledger. Repeating identical content intentionally needs human review; never delete a record to bypass uncertainty.

## Acceptance and rollback

Automated tests exercise mock submit/receipt and real filesystem concurrency. Real browser acceptance must be preparation only unless a particular public post is explicitly authorized. Do not describe a mock response as an actual X post.

Rollback selects the previous verified build via the service's existing build environment file and restarts only AutoParse after tasks are idle. Keep the formal workflow and ledger for inspection; never restart Chrome, overwrite cookies, or discard uncertain records.
