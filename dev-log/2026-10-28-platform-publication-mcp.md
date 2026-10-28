# WORKFLOW-009: platform publication MCP separation

User explicitly requires classification by self-media platform. Keep existing plugin identity and publisher implementations. Introduce three platform-scoped endpoints and credentials; replace the two backend-oriented plugin members. Preserve original workflows, ledgers and browser profiles. No public test post is authorized by this packaging task.

## Implementation
Three endpoints have separate domain-separated credentials, per-platform workflow/browser allowlists and endpoint-owned session guards. No arbitrary authoring or research tools are exposed. Douyin video calls the existing approved adapter directly; its task queries and reconciliation reject unrelated workflows. Generic existing endpoints and other plugin users are unchanged.

## Verification and deployment
12 scoped-security tests cover credential separation, Origin, denied foreign workflows, session ownership/recovery, asynchronous cleanup ownership, video confirmation and HTTP contract. Independent TypeScript and focused ESLint pass. A final production build passes without relaxing existing private runtime-directory permissions (initial unprivileged build rejected those paths).
Real canary checks verified all three server identities, tool counts13/9/10, allowed workflow lists, wrong-platform Token401 and foreign workflow rejection. One owned blank task tab was opened/read, refused by the other platform and closed; no upload or public post. After queue/lock idle checks, AutoParse alone was restarted into the tested build; canary stopped, prior build preserved. X scoped endpoint read the original persisted receipt without resubmission.

## Hub
New platform MCPs admitted by preview and stable-request commit. Existing Skill and plugin updated to0.2.0 using current base/digest and previewDigest; original identities and0.1.0 archives preserved. New Skill requires exactly the three platform MCPs; plugin components contain3 MCP +1 Skill, with no transitive old backend connector. Fixed ZIP/content verified and new version installed in isolated native Codex. This is not an install into the user's existing client, nor a new authorization grant.

Final combined regression110/110 passes. Existing five unrelated file hashes match the task-start snapshot. Protected Supabase workflows were only read, never updated by this task. Public source preservation updates the existing plugin feature branch/PR, retaining its prior public ancestors only.
