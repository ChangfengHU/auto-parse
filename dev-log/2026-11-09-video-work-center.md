# STORAGE-001 Video work center and Douyin MCP upgrade

User requested a new AutoParse menu, permanent video/input retention independent from Fleet, one work with many platform deliveries, drafts sufficient. No public test publication authorized.

Findings: workflow task cache purges after7days; current Douyin receipt ledger lacks complete source/metadata; Fleet registration is separate and incomplete. Preserve original Supabase workflow definitions, credentials and all existing ledgers. Existing unrelated dirty parser/material/R2/tsconfig files remain untouched.

Plan: permanent per-attempt ledger, content-hash original storage, explicit prepared vs draft_saved vs published/unknown, central UI and scoped MCP read/query/recovery tools; read-only historic import, no resubmission. Protect new archive APIs with existing scoped credentials/admin authentication; no public archive access.

Implementation and verification in progress. GitHub push remains separately unauthorized per prior review.

Implementation complete: permanent per-intent archive plus full-fidelity original copies; guarded Douyin node/start/task cache hooks; WeChat video-draft hooks and retained-original reuse; authenticated work center with platform/state filters and draft-only preparation; authenticated byte-range playback and posters. Default list shows real publication receipts. Douyin MCP 0.2.0 adds scoped list_video_works/get_video_work and archived get_video_task fallback. No Supabase workflow edited.

Read-only historic backfill:31 existing Douyin task snapshots +6 WeChat draft attempts =>37 deliveries /16 works;14 published-receipt attempts,12 prepared,7 failed,2 verified drafts,2 unknown. All16 source videos copied without transcoding and SHA256 checked;16 preview posters. No platform upload/save/publication performed during backfill.

Verification:137 isolated regression tests passed, independent TypeScript and targeted ESLint passed; git diff --check passed. New isolated production build succeeded (39.8s). Initial build scanned retained build/data artifacts via automatic Tailwind source detection; stopped only its own two build PIDs, restricted style sources to app/components/lib; current production process untouched. Added docs/video-work-center.md. New archive is private host84 persistent disk, not an offsite backup.

Remaining: deploy while browser1/2 locks are free; authenticated UI/public MCP checks; update Hub fixed capability/guide/plugin versions. GitHub push remains outside this task's approved path after prior automatic rejection; no push attempted.

Deployment complete 2026-11-09T19:37:03.779Z: build .next-video-works-v020c-20261109, service auto-parse only; both browser activity locks acquired, no running workflow tasks. Previous .next-wechat-batch-v059-20261106 preserved. Release metadata points to f8d0623e447bc70e22729ed08506db76f219a519; unrelated dirty parser/R2/material/audio settings preserved. No GitHub push.

Live verified: get_version 0.2.0 metadata_verified=true; authenticated16 works /14 Douyin works with actual publication receipts /16 originals; unauthenticated archive401; original byte-range206 exactly matches stored bytes; poster200; Douyin credential to WeChat preparation403; secure login API cookie; new MCP tools real read execution. No public post, upload or cloud draft triggered by verification. Initial smoke cross-platform assertion selected a WeChat-only work under Douyin scope and received not-found rather than403; rerun with a Douyin-owned work confirmed403, no authorization bypass.

Hub updates: MCP registration61a2191a-2c91-4622-bce0-a43bf94a15d4 version0.2.0; guide0.6.0 registration57ea94c6-8bc1-479e-ac0a-f75d1a0407a7; plugin0.6.0 registration3747fc74-3941-4039-b5ef-95f00c5e7058, archiveSHAff5841da9f0f255bff842e3f7796c8e12ff616e76e944543762b712350efdbd4. Four MCP identities preserved; guide preserves all8 files. Hub ChatGPT auto-push queued, not claimed installed in clients.

CUA public page verified new sidebar/menu and protected connection form; screenshot /tmp/video-work-center-20261109.jpg. Authenticated UI walkthrough pending user decision: automatic review rejected transferring the server's existing scoped credential to browser over ephemeral memory pipe because this specific credential transfer lacks explicit user authorization. No transfer executed; no workaround. User asked via async input to authorize that exact login or complete login personally. API verification unaffected.
