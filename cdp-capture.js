const WebSocket = require('ws');
const fs = require('fs');
const http = require('http');

const TARGET_IDS = ['k1b908rw', 'k1d7vjtr', 'k1d8g5bo'];
const ADSPOWER_API = 'http://127.0.0.1:50325';

async function cdpCmd(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id === 1) {
        ws.close();
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 12000);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getActivePorts() {
  const resp = await httpGet(`${ADSPOWER_API}/api/v1/browser/local-active`);
  const portMap = {};
  if (resp.code === 0 && resp.data && resp.data.list) {
    for (const item of resp.data.list) {
      if (TARGET_IDS.includes(item.user_id)) {
        portMap[item.user_id] = parseInt(item.debug_port, 10);
      }
    }
  }
  return portMap;
}

async function captureOne(port) {
  const targets = await httpGet(`http://127.0.0.1:${port}/json/list`);
  const pages = targets.filter(t =>
    t.type === 'page' &&
    !t.url.includes('adspower.net') &&
    !t.url.startsWith('about:') &&
    !t.url.startsWith('chrome-') &&
    t.webSocketDebuggerUrl
  );
  if (!pages.length) return { error: 'no page', url: '' };

  for (const page of pages.slice(0, 4)) {
    try {
      const shot = await cdpCmd(page.webSocketDebuggerUrl, 'Page.captureScreenshot', {
        format: 'jpeg', quality: 70
      });
      return { data: shot.data, url: page.url.substring(0, 70) };
    } catch(e) {
      // try next tab
    }
  }
  return { error: 'all tabs timeout', url: pages[0].url.substring(0, 70) };
}

async function captureAll() {
  const portMap = await getActivePorts();
  const results = {};

  for (const name of TARGET_IDS) {
    const port = portMap[name];
    if (!port) {
      results[name] = { error: 'browser not running', url: '' };
      continue;
    }
    try {
      const { data, url, error } = await captureOne(port);
      if (error) { results[name] = { error, url }; continue; }
      const path = `/tmp/cdp-frame-${name}.jpg`;
      fs.writeFileSync(path, Buffer.from(data, 'base64'));
      results[name] = { path, url };
    } catch(e) {
      results[name] = { error: e.message, url: '' };
    }
  }
  console.log(JSON.stringify(results));
}

captureAll().catch(e => { console.error(e.message); process.exit(1); });
