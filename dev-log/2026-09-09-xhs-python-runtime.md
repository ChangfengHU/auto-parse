# RUNTIME-003 XHS Python runtime

## Cause and repair
84 /opt/auto-parse had no Python virtualenv or uv; CLI bridge fell back to system Python and failed importing httpx. The previously imported browser session was not proven invalid by that error.

Installed uv 0.12.11 in project-private .runtime/xhs-bootstrap/bin using the official standalone installer. Ran existing python/scripts/setup-xhs-cli.sh with XHS_CLI_BOOTSTRAP_PYTHON=/usr/bin/python3, project cache and UV_NATIVE_TLS=true. Frozen vendor uv.lock installed the complete environment into python/.venv using existing Python 3.12.3. No system Python packages, browser binaries or TTS models installed. No credentials changed.

## Verification
- Bootstrap exited 0; httpx and xhshow imports passed.
- Restarted only auto-parse.service; active, loopback11007.
- GET /api/analysis/xhs/cookie/test: HTTP200, ok=true, valid=true.
- POST /api/analysis/xhs/search, 通勤穿搭/page1: HTTP200, ok=true, result array22 (not all entries independently classified).
- Public creator-analysis MCP xhs_discover with backend=auto_parse, limit5: ok=true, source=auto_parse_search, returned5, attempts empty. No browser fallback.
- No Next.js code changes, build, lint or full TypeScript checks; no whole-app regression claimed.
- No source login changes or new browser credential import needed. Original .materials.json changes preserved.

## Reproduction and persistence
Use existing frozen setup script before deploying XHS capability; validate CLI imports and the authenticated read-only API after restart. Keep python/.venv as a production dependency. Download/cache are disposable, no runtime env or cookies should be committed.

Reference: https://docs.astral.sh/uv/getting-started/installation/ (standalone installer and isolated install).

- Public recommendation feed: ok=true, 34 items. Diff check passed. Removed disposable cache; production venv retained and imports rechecked.
- Repository visibility verification returned private=false. Operational notes are committed locally only, not pushed to the public repository; this does not affect the completed running-service repair.
