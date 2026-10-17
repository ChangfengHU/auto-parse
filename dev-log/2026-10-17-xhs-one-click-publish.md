# WORKFLOW-004: Xiaohongshu one-click publication

Status: In Progress

The owner requires the full browser publication path, not draft-only acceptance. Add a strict directPublish switch controlling draft/publication branches in the same Supabase workflow. The provided rain-last-order video is authorized for actual publication on host84 browser1. Do not modify the protected Douyin definitions or browser2.

Initial audit: the existing editor debug entry uses a separate persistent context, not the authenticated MCP browser binding; Fleet collections is an observational dashboard, not this execution UI. Only small editor corrections were previously shipped. No claim of complete Fleet integration.

Implement shared conditional execution, an authenticated browser-bound one-click entry and guarded XHS receipt handling. Never repeat unknown submissions. Preserve unrelated materials/parser/R2/audio/tsconfig changes. Implementation, verification and deployment are complete; commit/push in progress.

## Implementation and pre-production verification

- Shared engine supports strict boolean runIf conditions; missing/empty value means false, ambiguous values fail. No conditions preserves legacy execution.
- Browser-bound workbench panel uses the same authenticated MCP, not legacy persistent-context debug. Select browser1/2, directPublish, run all, poll screenshots/step results and close the task. Credentials remain in component memory, only session ID is stored in sessionStorage. The older debug UI is retained, not falsely converted.
- XHS guarded click requires managed execution, directPublish=true, actual file-upload output, expected redId, title/body match and an applied AI declaration. Browser native exact closed-shadow click, never an HTTP publisher. Intent and creation receipt persist in .data/xhs-publications; same account/source URL cannot bypass dedup by changing requestId.
- Initial combined 148 tests passed; additional ten actual-node guard scenarios passed (44/44 focused MCP + XHS). Independent tsc and production build passed. Focused ESLint has zero errors and six existing image warnings after replacing one pre-existing any in the touched editor.
- Canary UI with a disposable workflow executed the false branch and displayed skipped-step status/screenshot. Canary API true/false branch tests both completed with complementary skips; invalid "yes" was rejected before execution. All task sessions closed, and only the disposable workflow 069912db-9be0-4578-a5d2-462fc043bdaf was deleted.
- Read-only live inspection confirmed redId 11566224305 and native AI declaration. Existing draft was saved with that declaration, still one local draft; inspection session closed. No publication click yet.
- Protected workflow digests before: douyin-publish 20e7820518ef3d9d0b3e56bfa49acf56da7436757e7a58a733dae9505f306dcb; approved copy f06417014b852fb61ddec0c157092dc15df279068e621d63ec1399e4525c10b9.

## Real publication and reconciliation

- Production one-click UI started session 3d91e3f5-37d9-4573-a32e-d4ce882f4c41 with directPublish=true and stable requestId xhs-rain-last-order-publish-20261017. This was a new full upload→fields→guarded click run, not merely reopening the earlier draft. The original local draft was preserved.
- Upload completed, title/body matched, native AI disclosure applied, draft-only steps skipped. The optional absent guide took 63.9 seconds through old click fallbacks; it is now an explicit bounded optional selector with stepSkipped rather than a spurious error.
- Exactly one native publication click was sent. XHS returned HTTP200, success:true, data fields id/score, and navigated to /publish/success. Its absent code field triggered the initial conservative unknown-result path. The intent remained reserved; no click/upload was repeated.
- Continued only readback nodes in the same task. Note management showed one video. Direct unsigned read of the list returned406, so evidence was obtained by observing the page's native signed list response during browser reload/filtering, not by bypassing the site.
- The native 已发布 filter (tab=1) returned note6ad37843000000001301bb1b, title雨夜最后一单, duration49, type video, permission_code0, schedule_post_time0, visible_time1792243842. The current account API still returned redId11566224305. The ledger was reconciled after unique ID/title/time/duration/account checks, with moderation published_list_visible and verificationSource creator_note_list.
- Screenshot: /tmp/xhs-workflow-acceptance-BZuD8j/xhs-published-note-readback.png. Browser PIDs remain3512914/3491468. Initial actual run has a historical receipt-parser error, not a clean uninterrupted green run; this must not be erased or reported as such.
- Fixes additionally restore the actual switch/browser selection when reopening a task and compare completed node objects semantically (Supabase JSONB key ordering had caused a false freeze conflict).
- Final source regression set:167 tests passed; independent TypeScript and focused ESLint passed.

## Corrected release and final verification

- Production now runs .next-xhs-oneclick-receipt-20261017 through ops/workflow-mcp-build.env. Build and independent post-build TypeScript passed. Both the loopback and public /workflows pages returned HTTP200; service is active. Canary was stopped and earlier builds retained for rollback.
- Formal Supabase workflow remains the same ID with twelve nodes and five inputs. Its verified updatedAt is 2026-10-17T13:38:46.056+00:00. The optional guide now has skipIfMissing:true rather than swallowing a click failure.
- Production verification session c26a0f2d-d0c8-4af6-b555-6209c06365c3 executed four ephemeral receipt/readback checks, not another full upload. The guarded publish node returned the existing durable receipt with reused:true; native navigation/title readback passed; the absent optional guide skipped in 1560ms. No second upload or publication was performed in this verification. Reopening a new full workflow still runs its configured upload steps; the guard prevents duplicate publication, not every preceding operation.
- The public workbench restored the actual directPublish=true state, displayed the real note receipt and browser screenshot, and closed the task through its own UI. Screenshot: /tmp/xhs-workflow-acceptance-BZuD8j/oneclick-receipt-reuse.png. Both protected Douyin definition digests match the originals. Browser PIDs3512914/3491468 are unchanged, and both activity locks are free.
- Initial publication's conservative receipt-parser stop remains recorded above. This is a real published-and-reconciled result plus corrected-runtime verification, not a claim that the first full run completed uninterrupted or that another video was published after the parser fix.
- Workbench/Supabase guidance kept the existing formal workflow as the sole definition source; React review kept credential state in memory and restored task controls from the actual runtime snapshot. Fleet's observational collections UI and the legacy debug runtime were not replaced.
- GitHub identity and repository push permission were verified with minimal read-only requests. Only task-owned paths will be committed; unrelated dirty files and build artifacts remain untouched.
