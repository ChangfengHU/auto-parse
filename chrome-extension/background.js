const SERVER = 'https://parse.vyibc.com';
const ALARM_NAME = 'douyinKeepAlive';

const COOKIE_KEYS = [
  'sessionid', 'sessionid_ss', 'uid_tt', 'uid_tt_ss',
  'ttwid', 'passport_csrf_token', 'passport_csrf_token_default',
  's_v_web_id', 'UIFID', 'is_dash_user', 'login_time', 'bit_env',
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

// ── 1. Ping 抖音接口，让服务器刷新 Session 活跃时间 ──────
async function pingDouyin(cookieStr) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      'https://www.douyin.com/aweme/v1/web/query/user/' +
      '?aid=6383&channel=channel_pc_web&device_platform=webapp' +
      '&app_name=douyin_web&version_code=190500&version_name=19.5.0' +
      '&cookie_enabled=1&browser_language=zh-CN',
      {
        headers: {
          'Cookie': cookieStr,
          'Referer': 'https://www.douyin.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      }
    );
    const data = await res.json();
    // status_code 0 = 成功，session 仍有效
    const valid = data.status_code === 0;
    console.log('[keepAlive] 抖音 ping 结果:', valid ? '有效' : `status=${data.status_code}`);
    return valid;
  } catch (e) {
    console.warn('[keepAlive] 抖音 ping 失败:', e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}


// ── Supabase 同步（发布平台凭证）────────────────────────
const SUPABASE_URL = 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2NTQwNTAsImV4cCI6MjA2NTIzMDA1MH0.LMhY-7H3ySiXEZt2cjLXhhicL4idx0A6xurvxynqJf8';

async function syncToSupabase(cookieStr) {
  try {
    const { clientId } = await chrome.storage.local.get('clientId');
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
async function syncToParseServer(cookieStr) {
  try {
    const res = await fetch(`${SERVER}/api/cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieStr }),
    });
    const data = await res.json();
    return data.success === true;
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
  const douyinOk = await pingDouyin(cookieStr);

  // Step 2: 同步最新 cookie 到解析平台
  const serverOk = await syncToParseServer(cookieStr);

  // Step 3: 同步到发布平台（Supabase，自动）
  const supabaseOk = await syncToSupabase(cookieStr);
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
    const { cookieStr } = msg;
    syncToSupabase(cookieStr).then(ok => sendResponse({ ok }));
    return true;
  }

  if (msg.type === 'GET_KEEP_ALIVE_STATUS') {
    chrome.alarms.get(ALARM_NAME, alarm => {
      sendResponse({ active: !!alarm });
    });
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
  const { clientId } = await chrome.storage.local.get('clientId');
  if (!clientId) {
    const id = 'dy_' + crypto.randomUUID().replace(/-/g, '');
    await chrome.storage.local.set({ clientId: id });
    console.log('[发布平台] clientId 已生成:', id);
  }
  restoreAlarm();
});
restoreAlarm();
