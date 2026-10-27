# WORKFLOW-008: extensible automatic-publication plugin

User requested a unified installable plugin in Fleet Hub and explicitly noted future publishing providers. Existing audio-only admission is separate; no existing automatic-publication plugin was found by source/ID search.

Reuse auto-parse-workflow (host84 official Supabase workflow service) and existing vyibc-douyin 0.3.0 for its guarded video adapter. No new publisher, server, browser login or public test post. The routing Skill is source-controlled in skills/auto-parse-publish; live MCP capabilities/schema and Supabase remain authoritative. Future providers extend the same stable plugin and use version-pinned dependency updates.

Hub MCP admission for auto-parse-workflow 0.1.0 passed preview and committed. Exact-endpoint binding reuses existing scoped service authorization; secrets remain in Vault. Remaining: validate/publish Skill, compose plugin, inspect fixed package, isolated install, protocol/read-only business checks, Git preservation and archive.

## Acceptance
Skill source passed cloud validation and fixed artifact publication; six complete files/14846 bytes. Hub Skill and plugin admissions passed preview then same-request commit; original receipts read back. Plugin has three pinned components (two MCP + one Skill), with a 17-file immutable archive verified by SHA256.

Independent Codex0.164.0 install in an isolated HOME/CODEX_HOME succeeded; installed/enabled identity and version returned by native plugin list. Public MCP initialize/tools/list discovered17/25 tools. Read-only capability/real persisted X receipt queries succeeded. Six route workflow IDs and required variables resolve in Supabase; relative references resolve. No new media upload/publication, workflow modification or service restart. Other clients' installation and service authorization are not implied by packaging.

Complete instructions and immutable receipts are in docs/auto-publish-plugin.md. Hub validation.installation remains not_verified because the catalog itself does not run native clients; independent acceptance is documented separately. This task adds only Skill/docs, so a new application build or broad source regression is unnecessary.

Same-version native reinstall was verified without duplication. Skill YAML, manifest identities, icon/reference paths and public Hub plugin readback passed. Source preservation uses a separate public feature branch atop the existing public X branch, without private local upload-operation ancestors.
