const DEFAULT_SERVER = 'https://parse.vyibc.com';
const PARSE_SERVER_KEY = 'parseServerBase';
const ALARM_NAME = 'douyinKeepAlive';
const CLIENT_ID_KEYS = {
  douyin: 'douyinClientId',
  xhs: 'xhsClientId',
  gemini: 'geminiClientId',
};

function normalizeServerBase(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function getServerBase() {
  const store = await chrome.storage.local.get(PARSE_SERVER_KEY);
  return normalizeServerBase(store[PARSE_SERVER_KEY]) || DEFAULT_SERVER;
}

async function ensurePlatformClientIds() {
  const store = await chrome.storage.local.get(Object.values(CLIENT_ID_KEYS));
  const updates = {};
  if (!store[CLIENT_ID_KEYS.douyin]) updates[CLIENT_ID_KEYS.douyin] = 'dy_' + crypto.randomUUID().replace(/-/g, '');
  if (!store[CLIENT_ID_KEYS.xhs]) updates[CLIENT_ID_KEYS.xhs] = 'xhs_' + crypto.randomUUID().replace(/-/g, '');
  if (!store[CLIENT_ID_KEYS.gemini]) updates[CLIENT_ID_KEYS.gemini] = 'gm_' + crypto.randomUUID().replace(/-/g, '');
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
    console.log('[发布平台] 平台凭证已补齐:', updates);
  }
  const finalStore = await chrome.storage.local.get([CLIENT_ID_KEYS.douyin, 'clientId']);
  if (!finalStore.clientId && finalStore[CLIENT_ID_KEYS.douyin]) {
    await chrome.storage.local.set({ clientId: finalStore[CLIENT_ID_KEYS.douyin] });
  }
}

const COOKIE_KEYS = [
  'sessionid', 'sessionid_ss', 'uid_tt', 'uid_tt_ss',
  'ttwid', 'passport_csrf_token', 'passport_csrf_token_default',
  's_v_web_id', 'UIFID', 'is_dash_user', 'login_time', 'bit_env',
];
const XHS_COOKIE_KEYS = [
  'a1', 'web_session', 'gid', 'id_token', 'xsecappid', 'webId', 'websectiga', 'webBuild',
];

// ── 读取抖音 Cookies ──────────────────────────────────────
async function getDouyinCookies() {
  const results = {};
  await Promise.all(
    COOKIE_KEYS.map(name =>
      new Promise(resolve => {
        chrome.cookies.get({ url: 'https://www.douyin.com', name }, cookie => {
          if (cookie) results[name] = cookie.value;
          resolve();
        });
      })
    )
  );
  return results;
}

async function getXhsCookies() {
  const results = {};
  await Promise.all(
    XHS_COOKIE_KEYS.map(name =>
      new Promise(resolve => {
        chrome.cookies.get({ url: 'https://www.xiaohongshu.com', name }, cookie => {
          if (cookie) results[name] = cookie.value;
          resolve();
        });
      })
    )
  );
  const allCookies = await new Promise(resolve => {
    chrome.cookies.getAll({}, cookies => resolve(cookies || []));
  });
  allCookies
    .filter(cookie => cookie?.domain?.includes('xiaohongshu.com'))
    .forEach(cookie => {
      if (!results[cookie.name]) results[cookie.name] = cookie.value;
    });
  return results;
}

// ── 1. Ping 抖音接口验证 Session 是否有效 ────────────────
// 注意：Cookie 是 forbidden header，不能手动设置，必须用 credentials:'include'
async function pingDouyin() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      'https://creator.douyin.com/web/api/creator/creator_center/homepage/v2/',
      {
        credentials: 'include',
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      console.log('[keepAlive] 抖音 ping HTTP 错误:', res.status);
      // 401/403 明确说明 session 无效；其他错误不能确定
      return res.status === 401 || res.status === 403 ? false : null;
    }
    const data = await res.json();
    // 接口正常返回且有 data 字段 → session 有效
    const valid = !!(data?.data || data?.user_info || data?.creator_info);
    console.log('[keepAlive] 抖音 ping 结果:', valid ? '有效' : `无用户数据 ${JSON.stringify(data).slice(0, 80)}`);
    return valid;
  } catch (e) {
    console.warn('[keepAlive] 抖音 ping 请求失败（网络/超时）:', e.message);
    return null; // null = 无法判断，不做误判
  } finally {
    clearTimeout(timer);
  }
}


// ── Supabase 同步（发布平台凭证）────────────────────────
const SUPABASE_URL = 'https://supabase.vyibc.com';
const SUPABASE_ANON_KEY = '';

async function syncToSupabase(cookieStr, platform = 'douyin') {
  try {
    await ensurePlatformClientIds();
    const clientIdKey = CLIENT_ID_KEYS[platform] || CLIENT_ID_KEYS.douyin;
    const store = await chrome.storage.local.get(clientIdKey);
    const clientId = store[clientIdKey];
    if (!clientId) return false;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/douyin_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        client_id: clientId,
        cookie_str: cookieStr,
        updated_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[发布平台] Supabase 同步失败:', e.message);
    return false;
  }
}

// ── 2. 同步 Cookie 到解析平台 ────────────────────────────
async function syncToParseServer(cookieStr, platform = 'douyin') {
  try {
    const server = await getServerBase();
    const apiUrl = platform === 'xhs' ? `${server}/api/analysis/xhs/cookie` : `${server}/api/cookie`;
    await ensurePlatformClientIds();
    const clientIdKey = CLIENT_ID_KEYS[platform] || CLIENT_ID_KEYS.douyin;
    const store = await chrome.storage.local.get(clientIdKey);
    const clientId = store[clientIdKey];
    const payload = platform === 'xhs' ? { cookie: cookieStr, clientId } : { cookie: cookieStr };
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.success === true || data.ok === true;
  } catch (e) {
    console.warn('[keepAlive] 同步解析平台失败:', e.message);
    return false;
  }
}

// ── 保活主逻辑 ────────────────────────────────────────────
async function keepAliveSync() {
  const cookies = await getDouyinCookies();

  // sessionid + uid_tt 同时存在才认为是真实登录
  if (!cookies.sessionid || !cookies.uid_tt) {
    console.log('[keepAlive] 未检测到有效登录（缺少 uid_tt），跳过');
    chrome.storage.local.set({ keepAliveStatus: 'no_login' });
    return;
  }

  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  // Step 1: Ping 抖音，刷新服务器 session 活跃时间
  const pingResult = await pingDouyin();
  const douyinOk = pingResult === true;

  // Step 2: 同步最新 cookie 到解析平台
  const serverOk = await syncToParseServer(cookieStr, 'douyin');

  // Step 3: 同步到发布平台（Supabase，自动）
  const supabaseOk = await syncToSupabase(cookieStr, 'douyin');
  if (supabaseOk) chrome.storage.local.set({ lastPublishSync: Date.now() });

  const now = Date.now();
  chrome.storage.local.set({
    lastKeepAlive: now,
    lastSync: serverOk ? now : undefined,
    keepAliveStatus: douyinOk ? 'ok' : 'ping_failed',
  });

  console.log(
    `[keepAlive] ${new Date().toLocaleTimeString()} | 抖音=${douyinOk ? 'OK' : 'FAIL'} 解析平台=${serverOk ? 'OK' : 'FAIL'}`
  );
}

// ── Alarm 触发 ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) keepAliveSync();
});

// ── 监听来自 popup 的消息 ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SET_KEEP_ALIVE') {
    if (msg.enabled) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      // 立即执行一次
      keepAliveSync();
      console.log('[keepAlive] 已开启，每分钟 ping 一次抖音');
    } else {
      chrome.alarms.clear(ALARM_NAME);
      chrome.storage.local.set({ keepAliveStatus: 'off' });
      console.log('[keepAlive] 已关闭');
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'SYNC_TO_SUPABASE') {
    const { cookieStr, platform = 'douyin' } = msg;
    syncToSupabase(cookieStr, platform).then(ok => sendResponse({ ok }));
    return true;
  }

  if (msg.type === 'AUTO_SYNC_ON_LOGIN') {
    // 登录状态变化时：读取最新 cookie 同步到 Supabase + 解析服务器
    (async () => {
      const platform = msg.platform || 'douyin';
      const cookies = platform === 'xhs' ? await getXhsCookies() : await getDouyinCookies();
      const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      const hasSession = platform === 'xhs'
        ? cookieStr.length > 0
        : cookieStr.includes('sessionid=');
      if (!hasSession) { sendResponse({ ok: false }); return; }
      const [supabaseOk, parseOk] = await Promise.all([
        syncToSupabase(cookieStr, platform),
        syncToParseServer(cookieStr, platform),
      ]);
      if (supabaseOk) chrome.storage.local.set({ lastPublishSync: Date.now() });
      sendResponse({ ok: supabaseOk || parseOk });
    })();
    return true;
  }

  if (msg.type === 'GET_KEEP_ALIVE_STATUS') {
    chrome.alarms.get(ALARM_NAME, alarm => {
      sendResponse({ active: !!alarm });
    });
    return true;
  }

  if (msg.type === 'CHECK_LOGIN_STATUS') {
    (async () => {
      // 第一步：检查本地 cookie 是否存在
      const cookies = await getDouyinCookies();
      if (!cookies.sessionid) {
        sendResponse({ loggedIn: false, reason: 'no_cookie' });
        return;
      }
      // 第二步：用 credentials:include 实际请求抖音 creator API 验证 session
      // extension service worker 有 host_permissions，可绕过 CORS 读取响应
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(
          'https://creator.douyin.com/web/api/media/aweme/post/?count=1&cursor=0',
          { credentials: 'include', signal: controller.signal }
        );
        clearTimeout(timer);
        const data = await res.json();
        if (data?.status_code === 8) {
          // 明确未登录
          sendResponse({ loggedIn: false, reason: 'session_expired' });
        } else if (data?.status_code === 0) {
          // 明确已登录
          sendResponse({ loggedIn: true, reason: 'ok' });
        } else {
          // 其他情况保守处理：cookie 存在就算登录
          sendResponse({ loggedIn: true, reason: 'cookie_only' });
        }
      } catch {
        // 网络超时/CORS → 保守处理
        sendResponse({ loggedIn: !!cookies.sessionid, reason: 'cookie_only' });
      }
    })();
    return true;
  }
});

// ── 安装 / Service Worker 重启时恢复保活状态 ──────────────
function restoreAlarm() {
  chrome.storage.local.get(['keepAliveEnabled'], result => {
    if (result.keepAliveEnabled) {
      chrome.alarms.get(ALARM_NAME, alarm => {
        if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensurePlatformClientIds();
  restoreAlarm();
});
ensurePlatformClientIds().catch(() => {});
restoreAlarm();
