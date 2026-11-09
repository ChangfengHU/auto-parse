# STORAGE-001 Video work center and Douyin MCP upgrade

User requested a new AutoParse menu, permanent video/input retention independent from Fleet, one work with many platform deliveries, drafts sufficient. No public test publication authorized.

Findings: workflow task cache purges after7days; current Douyin receipt ledger lacks complete source/metadata; Fleet registration is separate and incomplete. Preserve original Supabase workflow definitions, credentials and all existing ledgers. Existing unrelated dirty parser/material/R2/tsconfig files remain untouched.

Plan: permanent per-attempt ledger, content-hash original storage, explicit prepared vs draft_saved vs published/unknown, central UI and scoped MCP read/query/recovery tools; read-only historic import, no resubmission. Protect new archive APIs with existing scoped credentials/admin authentication; no public archive access.

Implementation and verification in progress. GitHub push remains separately unauthorized per prior review.

Implementation complete: permanent per-intent archive plus full-fidelity original copies; guarded Douyin node/start/task cache hooks; WeChat video-draft hooks and retained-original reuse; authenticated work center with platform/state filters and draft-only preparation; authenticated byte-range playback and posters. Default list shows real publication receipts. Douyin MCP 0.2.0 adds scoped list_video_works/get_video_work and archived get_video_task fallback. No Supabase workflow edited.

Read-only historic backfill:31 existing Douyin task snapshots +6 WeChat draft attempts =>37 deliveries /16 works;14 published-receipt attempts,12 prepared,7 failed,2 verified drafts,2 unknown. All16 source videos copied without transcoding and SHA256 checked;16 preview posters. No platform upload/save/publication performed during backfill.

Verification:137 isolated regression tests passed, independent TypeScript and targeted ESLint passed; git diff --check passed. New isolated production build succeeded (39.8s). Initial build scanned retained build/data artifacts via automatic Tailwind source detection; stopped only its own two build PIDs, restricted style sources to app/components/lib; current production process untouched. Added docs/video-work-center.md. New archive is private host84 persistent disk, not an offsite backup.

Remaining: deploy while browser1/2 locks are free; authenticated UI/public MCP checks; update Hub fixed capability/guide/plugin versions. GitHub push remains outside this task's approved path after prior automatic rejection; no push attempted.
