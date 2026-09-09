# XHS MCP foundation — 2026-09-09

Added scoped-token /api/analysis/xhs/mcp endpoint, safe error classification and internal SSH transport. Supports runtime check, login validation, search, recommendations and candidate refresh. Source limited to95; cookie candidate validated before storage/readback and selection. Source browser activity flock; no Chrome restart, no source login writes. Private key anonymous memfd only. Config/token stored outside Git with0600.

Real public Fleet MCP refresh succeeded through this route; login valid, search5, recommendations5 and note parser passed. Six Worker tests pass; backend ESLint/Python compile/diff check pass. Isolated build succeeds (existing ignoreBuildErrors means not full typecheck). Two staging processes stopped; first temporary build removed. Production .next-xhs2 and preceding .next-douyin-release retained;90-xhs-build.conf adds task-specific build EnvironmentFile after original service env. Removing that override and restarting reverts to preceding build.

Failures corrected: staging lacked production Supabase env; copied service env only in process, no secret output. Initial build Environment setting was overridden by original service env; selected with later EnvironmentFile. Worker redirect parameter and legacy host ID corrections are in Fleet repository. No all-platform/source support claim; actual natural expiry not induced. Credential import tested with real authorized95 session. No whole-app regression or public-page visual QA performed.

Original .materials.json preserved. auto-parse GitHub repository is public; source saved in a local commit, not pushed with operational records. Current user did not authorize making these new operational records public.
