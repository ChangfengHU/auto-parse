# WORKFLOW-005: image-text workflows for Xiaohongshu and Douyin

Status: Implementation deployed; non-publishing acceptance passed. Public image-text submission awaits user-approved content.

The owner explicitly requests two new image-text workflows. Preserve all existing video definitions, copy the formal Douyin source before adapting it, and use the existing workbench/MCP browser runtime. No test content is authorized for public submission. Validate preparation on host84 browser1 (XHS) and browser2 (Douyin); report actual publication as unverified until authorized material is submitted.

Initial audit: file_upload accepts a single URL. Existing paste_image_clipboard supports images but is not in the managed execution catalog and has broad fallback behavior. Add narrowly scoped ordered-image upload and guarded image-text verification/publication rather than changing working video semantics. Preserve unrelated materials/parser/R2/audio/tsconfig changes.

Skills: Fleet access/ops constrain credentials to process memory and preserve current logged-in browsers; Supabase guidance requires saved formal definitions and readback. No schema/auth changes are planned. Reviewed current Data API docs and changelog; REST shape is unchanged, upcoming legacy TLS cipher retirement does not affect current Node TLS.

## Implemented

- Formal Supabase workflows: XHS `1dc07adf-65a1-48f0-98ab-31cfcafc7fd3` (browser1), Douyin `53197d8e-a89d-4d1a-bb8d-fc114156f30f` (browser2). Each has six nodes: home, image entry, ordered upload, metadata/AI preparation, conditional publication, screenshot. Both were created by formal copy; Douyin copied the frozen original.
- Added `image_upload` and `image_text_publish` to types, engine, catalog and authenticated managed MCP. Added contract/ledger and browser helpers; existing video executors were not modified.
- PNG/JPEG/WebP only, 1–9 images, 10 MiB each / 50 MiB total. HTTPS trusted asset hosts, no redirects, MIME sniffing, bounded download and chunked in-memory CDP FileList. No browser-side temporary files.
- Stable account verification, input and unresolved-template validation, upload/preparation proof, ordered thumbnail fingerprints, exact title/body and applied AI declaration; public/immediate/single-platform setting checks.
- `directPublish=false` prepares the whole form but does not guarantee a saved cloud draft. True reserves a durable source-set intent, clicks once and requires a native creation response. Unknown outcomes fail closed; no automatic resubmission. Test placeholders are always rejected by the publish node.
- Workbench distinguishes prepared state from saved draft and displays generic image/video receipt IDs. Existing MCP endpoint and install configuration remain unchanged; usage in `docs/image-text-workflows.md`.

## Verification

- Final combined suite: **202/202 passed**, including 35 new image-text tests and the previous 167 workflow/upload/browser-lock/Douyin/XHS tests. Independent TypeScript and focused ESLint passed. Final production build passed (Next build skips type validation, so the independent check is recorded separately).
- Canary protocol/auth/catalog/shared Supabase CRUD/stale-revision protection passed. The verifier removed only its two empty disposable test workflows.
- Canary real workflows: both 6/6 completed with two ordered test images, title/body and AI declaration enabled; publication node skipped; screenshots returned. Explicit true-mode fixture attempts returned `image_test_fixture_must_not_be_published` on both platforms, before any publish click/reservation.
- Final production real workflows: XHS session `65d1d72d-fbff-4c15-8adf-a4a647cecda0` completed 6/6 with one image; Douyin session `0db693d5-fad6-46ef-be8a-bc466f3e6477` completed 6/6 with two images supplied in reverse order. Source digests confirmed requested order. Both used aiGenerated=false, returned prepared=true/published=false, skipped publication, and passed public/immediate settings checks.
- Public workbench test for each new workflow restored the correct browser and directPublish=false, displayed step history/skips and browser screenshots. Both task sessions closed successfully; no browser login overwritten/restarted.
- Exact semantic comparison of the original `douyin-publish`, approved video copy `34f421be-f97c-498a-9c80-5214564abd1c`, and XHS video `6105efc6-7e54-4c85-acfe-1a37e0d5093f` passed after rollout. This is definition preservation, not a new public video publication test.

## Deployment and remaining acceptance

Production `auto-parse.service` uses `.next-image-text-final-20261018` through `ops/workflow-mcp-build.env`; previous XHS release retained for rollback. Loopback/public workbench returned HTTP200. Restart followed idle session/publish checks and local dispatcher queue size=0, while holding both browser activity locks. Temporary canary stopped.

Unrelated materials/parser/R2/audio and pre-existing tsconfig changes preserved, not staged. Removed only the two build-generated tsconfig includes from this task. GitHub identity/repository push permission verified with minimal read requests; remote main matched the starting commit before staging.

No public image-text publication was attempted. No real image-post ID or public-readback evidence exists yet. The final acceptance requires the owner's actual image URLs, title/body, AI declaration and explicit publication authorization. Custom cover, music, scheduled/private/cross-platform posting and native topic selection are outside this first release.

Account observation: XHS stable userId matches the earlier account, but its display name/redId changed. New image workflows use the stable ID. The preserved older XHS video definition still uses its former redId; it needs a separate account-binding review before the next video publication, not a silent edit in this task.
