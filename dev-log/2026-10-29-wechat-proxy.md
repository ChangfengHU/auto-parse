# API-003 follow-up: explicit proxy routing

User corrected the assumption that the host IP is the intended egress. Native fetch currently goes direct; the configured local Mihomo proxy has a different WeChat-observed public IP. Both official stable_token requests returned40164, each naming its actual egress. Correct the WeChat transport only; no global proxy/browser/routing changes. Preserve existing ledgers and task IDs. No public publication is authorized.

## Implemented
Pinned undici6.29.1 as one direct dependency. Updated only package/lock entries for this dependency and installed just that package, avoiding pruning existing runtime modules. WeChat uses a per-request ProxyAgent via WECHAT_HTTPS_PROXY, including official JSON calls, multipart uploads and trusted asset downloads. Missing/invalid proxy fails closed; transport failures never retry directly. Token cache includes the proxy configuration fingerprint; proxy credentials are not reported. No global dispatcher, shared proxy helper, Mihomo rule, browser or other platform was changed.

## Verification
43 focused/platform/XHS regressions pass, including a real unavailable-proxy test proving zero requests reach the local origin, dispatcher coverage on JSON/multipart/asset requests, redaction and token invalidation on transport changes. Independent TypeScript, focused ESLint and production build pass.

Canary using the configured service proxy authenticated and read24 official drafts. Both workflow sessions and publish tasks were idle; both browser activity locks held before switching to.next-wechat-proxy-20261029 and restarting AutoParse only. Previous build preserved; canary stopped. Production endpoint then authenticated successfully.

A single clearly named integration-test draft was created through the public production MCP using an existing public source cover. Official get of the exact returned media_id confirmed title, expected body and cover. Same request replay returned the same media_id without another upload/create; draft count changed24→25 once. No public publish/mass-send/delete. Receipt stays in the private durable ledger, not in public documentation.

## Remaining scope
Official article-draft creation/readback is now accepted; prior whitelist blocking status is superseded by the verified proxied path. Newspic/GIF/native Live Photo implementation remains separate pending work. This routing fix preserves MCP identity, schemas, credentials and plugin fixed package0.3.0; no new plugin install is required.
