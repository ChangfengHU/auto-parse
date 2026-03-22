const SUPABASE_URL = 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2NTQwNTAsImV4cCI6MjA2NTIzMDA1MH0.LMhY-7H3ySiXEZt2cjLXhhicL4idx0A6xurvxynqJf8';

// 安装时生成唯一 clientId，并注册定时器
chrome.runtime.onInstalled.addListener(async () => {
  const { clientId } = await chrome.storage.local.get('clientId');
  if (!clientId) {
    const id = 'dy_' + crypto.randomUUID().replace(/-/g, '');
    await chrome.storage.local.set({ clientId: id });
  }
  await syncCookies();
  chrome.alarms.create('sync-douyin', { periodInMinutes: 30 });
});

// 浏览器启动时也立即同步一次
chrome.runtime.onStartup.addListener(() => syncCookies());

// 定时触发
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'sync-douyin') syncCookies();
});

// popup 手动同步
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SYNC_NOW') {
    syncCookies().then(result => sendResponse(result));
    return true;
  }
});

async function syncCookies() {
  try {
    const { clientId } = await chrome.storage.local.get('clientId');
    if (!clientId) return { ok: false, error: 'no clientId' };

    const cookies = await chrome.cookies.getAll({ domain: '.douyin.com' });
    const hasSession = cookies.some(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
    if (!hasSession) return { ok: false, error: 'not_logged_in' };

    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 尝试读取抖音账号昵称
    let account = null;
    try {
      const r = await fetch('https://creator.douyin.com/web/api/creator/creator_center/homepage/v2/', {
        credentials: 'include',
      });
      if (r.ok) {
        const j = await r.json();
        account = j?.data?.creator_info?.nickname || j?.data?.user?.nickname || null;
      }
    } catch { /* ignore */ }

    // upsert 到 Supabase
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
        account: account,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) return { ok: false, error: await res.text() };

    await chrome.storage.local.set({ lastSyncAt: Date.now(), lastSyncOk: true });
    return { ok: true, cookieCount: cookies.length, account };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
