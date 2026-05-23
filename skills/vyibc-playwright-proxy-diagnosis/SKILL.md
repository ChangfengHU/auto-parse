---
name: vyibc-playwright-proxy-diagnosis
description: Diagnose Playwright/Chrome browser pages that show ERR_TUNNEL_CONNECTION_FAILED, blank pages, or cannot access websites while the normal network works. Use when a project browser instance uses BROWSER_PROXY_SERVER, system proxy, AdsPower proxy, or a persistent Chrome profile and the user suspects the browser instance or proxy is broken.
---

## Purpose

Find the real proxy/browser/network root cause before adding domain bypass rules. This is for failures like Chrome showing `ERR_TUNNEL_CONNECTION_FAILED`, Playwright pages staying blank, or a site failing only in the automated browser while `curl` or the user's normal browser works.

## Diagnosis Order

1. Identify the browser proxy actually used by the app.

```bash
rg -n "^(BROWSER_PROXY_SERVER|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|BROWSER_CHANNEL|BROWSER_HEADLESS|DOUYIN_BROWSER_DATA_DIR)=" .env .env.local
curl -s http://localhost:1007/api/browser/status
```

Do not assume the visible desktop Chrome and Playwright Chrome share the same network path. A persistent Playwright context may be forced through `BROWSER_PROXY_SERVER`.

2. Test the configured proxy directly with `curl -x`.

```bash
curl -I --connect-timeout 8 -x http://USER:PASS@HOST:PORT https://example.com/
curl -I --connect-timeout 8 -x http://USER:PASS@HOST:PORT https://www.google.com/
curl -I --connect-timeout 8 -x http://USER:PASS@HOST:PORT https://www.baidu.com/
curl -I --connect-timeout 8 -x http://USER:PASS@HOST:PORT https://creator.douyin.com/
```

Interpretation:

- `HTTP/1.1 403 NotPurchased` from the proxy means the proxy account/package is invalid or expired. This is a global proxy failure, not a site-specific issue and not a Chrome profile issue.
- `HTTP/1.1 200 Connection established` followed by a site status means the proxy can tunnel HTTPS.
- Timeouts or DNS errors should be compared against direct `curl -I URL` and a known-good local proxy such as `http://127.0.0.1:7890`.

3. Compare with a known-good proxy or direct path.

```bash
curl -I --connect-timeout 8 -x http://127.0.0.1:7890 https://example.com/
curl -I --connect-timeout 8 -x http://127.0.0.1:7890 https://www.google.com/
curl -I --connect-timeout 8 -x http://127.0.0.1:7890 https://creator.douyin.com/
```

If the known-good proxy works across multiple sites but the configured project proxy fails across all of them, fix the project proxy config instead of adding per-domain whitelist/bypass rules.

4. Inspect the running Chrome instance through CDP when needed.

```bash
curl -s http://localhost:10009/json/list
node - <<'NODE'
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:10009');
  const ctx = b.contexts()[0];
  const p = await ctx.newPage();
  const failed = [];
  p.on('requestfailed', r => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 100)}`));
  await p.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => failed.push(e.message));
  await p.waitForTimeout(1000);
  console.log({ title: await p.title().catch(() => ''), url: p.url(), failed: failed.slice(0, 10) });
  await p.close().catch(() => {});
  await b.close();
})();
NODE
```

If CDP access needs elevated permission in Codex, request it clearly; it only connects to the local Chrome debugging port.

## Fix Pattern

If the project proxy is invalid, replace it with a working proxy or remove the forced proxy so Chrome follows the system network:

```env
BROWSER_PROXY_SERVER=http://127.0.0.1:7890
```

Then restart both the persistent browser and the dev server so environment variables are re-read:

```bash
curl -s -X POST http://localhost:1007/api/browser/status \
  -H 'Content-Type: application/json' \
  -d '{"action":"close"}'

# restart the dev server process
npm run dev
```

After restart, verify from the same persistent Chrome, not just terminal `curl`.

## Do Not

- Do not solve a global proxy failure by adding domain bypass rules first.
- Do not call it a browser instance/profile problem until the configured proxy has been tested with `curl -x`.
- Do not keep a stale persistent Chrome running after changing `.env.local`; restart it and the app process.

## Case Note

In this project, `.env.local` had `BROWSER_PROXY_SERVER` pointing to a miyaip proxy. Direct tests to Google, Baidu, Douyin, and example.com all returned `HTTP/1.1 403 NotPurchased`. Switching `BROWSER_PROXY_SERVER` to the known-good local proxy `http://127.0.0.1:7890`, restarting Next, and closing/restarting the persistent browser fixed access across sites.
