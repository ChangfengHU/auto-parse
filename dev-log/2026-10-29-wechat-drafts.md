# API-003: Official-account draft box

User prioritizes official-account draft creation; reuse existing platform plugin, keep separate WeChat MCP. No public publication or mass-send. Use official stable_token and draft/material APIs. App credentials held in Vault and protected service configuration, never Git/logs.

Initial real stable_token call returned40164: current service egress IP must be authorized in official-account IP whitelist. User notified; implementation continues independently.

## Implementation and verification

Seven draft-only official API tools integrated into the existing platform HTTP router. Separate WeChat credential, no workflow authoring, no browser, no public publish/mass-send/delete. Conservative HTML/image validation and trusted-host, bounded JPEG/PNG downloader; permanent cover and uploaded body images. Durable per-account/request ledger, exclusive single-host request locks, fingerprints, upload subreceipts and unknown-result refusal.

15 new focused tests plus platform and XHS regressions:38/38 pass. Independent TypeScript and focused ESLint both pass. Production build.next-wechat-drafts-20261029 passes. Canary verified official server identity, seven schemas, credential-free capabilities and sanitized40164. No workflow/publish activity and both browser locks confirmed before AutoParse-only restart; old build retained. Public endpoint repeats identity/capability success and official40164; WeChat credential rejected401 on the other three platform endpoints. No browser/proxy restarted; five unrelated dirty-file hashes match initial snapshot.

MCP0.1.0 registered; existing Skill/plugin upgraded0.3.0 using current base/digest and exact previews. Fixed package has4 MCP +1 Skill,18 files and verified SHA256 cbff4d2ceb9ad36e1854c7b87b355989ef448fbe9c9e25e789862404a3f30947. Skill publication receipt verified; its seven-file source is unchanged in the archive. Plugin update02a07ea4-ae6e-4291-92e2-25f1599844e4. These packaging results do not imply official draft creation succeeded.

## Remaining acceptance

User was asked to add service egress IP to the official-account whitelist. Real token/draft permissions, material upload, draft/add and same-media_id readback remain unverified until this external change; no test draft was created. Keep API-003 In Progress. No public publication is authorized by this draft-box task.

Native Codex fixed-package installation passed in an isolated HOME/CODEX_HOME after creating that isolated configuration directory; no user plugin/configuration was touched. Initial installer attempt correctly stopped because the isolated CODEX_HOME did not exist.

## Follow-up: push articles → image-post research
User clarified that both WeChat and XHS should eventually support image posts/Apple Live Photos, prioritizing WeChat, then identified vyibc-push.pages.dev as the source and asked for implementation/design research. Read three complete sample posts, the index and current migrated official draft/material docs using authorized browser tools. Distinguish static newspic, permanent GIF upload and native Live Photo. Current source contains no newspic/GIF/Live implementation; no new production deployment in this research phase.

Research report: docs/push-to-newspic-research-20261029.md. Observed site structure supports block extraction; strip personalized/private opening text in public versions. Reviewed primary repository documentation and four repo metadata records; no external packages installed/tested. An imagegen-produced three-card static proposal was shown in the conversation, not rendered motion or an actual draft. Public account status still40164. Official migrated docs reveal adapter limits that need correction during implementation; recorded explicitly. No public posting or media upload.

## Egress correction

User clarified that the intended route is the existing proxy. The earlier40164 responses correctly reported the direct machine egress, but advising that address for a proxy deployment was wrong. Native fetch had no explicit proxy binding. Follow-up transport remediation and real post-deployment evidence are tracked in dev-log/2026-10-29-wechat-proxy.md. Whitelist the IP observed on the intended proxy path, not the host address.
