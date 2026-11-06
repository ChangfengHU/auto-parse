# WORKFLOW-007: X single-image publishing

## Scope
Extend the existing managed X workflow with one optional image. Preserve text-only compatibility, exact account checks, same-session preparation proof and durable one-click reservations. The previously rejected text was never submitted.

## Implementation
Trusted HTTPS image sources, MIME sniffing and local 5MiB limit; completed native FINALIZE upload ID; loaded preview fingerprint; photo media-ID matching and exact caption verification in native CreateTweet receipt. The reservation key remains account+text while the proof additionally binds the image URL. Formal Supabase copy leaves the original text workflow unchanged.

## Verification
44 X-specific tests pass (including five media tests); final combined regression passes 110/110, independent TypeScript and focused ESLint pass. Production build passes. A user-authorized English caption with a generated image was prepared and submitted exactly once using the formal copied workflow. Native creation evidence and independent logged-in permalink readback confirmed exact caption, author and one loaded photo. This does not assert anonymous visibility, recommendation reach or future moderation.
After closing the task session, both activity locks and zero active publication/dispatcher tasks were checked; only AutoParse restarted into the tested build. Canary stopped. Root-created ledger ownership was corrected to the claude service user (700/600); production status returns the original persisted receipt after restart. No extra public test post.

## Operations and rollback
Select the prior verified build using the service build environment file after tasks are idle. Preserve .data/x-publications and existing browser profiles. No browser/proxy restart. Real publication identifiers and account-specific evidence remain in private runtime records and authorized Notion trajectory, not this public Git log.

Existing unrelated source/configuration hashes were preserved. The materials store changed concurrently during live service operation and was neither staged nor restored.
