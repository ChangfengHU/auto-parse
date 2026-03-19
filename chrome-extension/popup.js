const SERVER = 'https://parse.vyibc.com';

// 需要同步的 cookie 名称
const COOKIE_KEYS = [
  'sessionid',
  'sessionid_ss',
  'ttwid',
  'passport_csrf_token',
  'passport_csrf_token_default',
  's_v_web_id',
  'UIFID',
  'is_dash_user',
  'login_time',
  'bit_env',
];

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 读取 douyin.com 的 cookies
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

// 检查登录状态
async function checkLoginStatus() {
  const cookies = await getDouyinCookies();
  const loggedIn = !!(cookies.sessionid);
  const el = document.getElementById('loginStatus');
  if (loggedIn) {
    el.className = 'badge badge-green';
    el.innerHTML = '<span class="dot dot-green"></span> 已登录';
  } else {
    el.className = 'badge badge-red';
    el.innerHTML = '<span class="dot dot-red"></span> 未登录';
  }
  return loggedIn;
}

// 检查服务器状态
async function checkServerStatus() {
  try {
    const res = await fetch(`${SERVER}/api/cookie`, { method: 'GET' });
    const data = await res.json();
    const el = document.getElementById('serverStatus');
    if (data.valid) {
      el.className = 'badge badge-green';
      el.innerHTML = '<span class="dot dot-green"></span> Cookie 有效';
    } else {
      el.className = 'badge badge-red';
      el.innerHTML = '<span class="dot dot-red"></span> Cookie 已过期';
    }
    const lastSync = document.getElementById('lastSync');
    lastSync.textContent = data.updatedAt ? formatTime(data.updatedAt) : '—';
  } catch {
    const el = document.getElementById('serverStatus');
    el.className = 'badge badge-gray';
    el.innerHTML = '<span class="dot dot-gray"></span> 无法连接';
  }
}

// 同步 Cookie 到服务器
async function syncCookies() {
  const btn = document.getElementById('syncBtn');
  const btnText = document.getElementById('btnText');
  const btnIcon = document.getElementById('btnIcon');

  btn.disabled = true;
  btnIcon.textContent = '⟳';
  btnText.textContent = '同步中...';

  try {
    const cookies = await getDouyinCookies();
    if (!cookies.sessionid) {
      showToast('❌ 未检测到登录状态，请先登录抖音');
      return;
    }

    // 拼成 cookie 字符串
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const res = await fetch(`${SERVER}/api/cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieStr }),
    });

    const data = await res.json();
    if (data.success) {
      showToast('✅ 同步成功！');
      // 保存同步时间
      chrome.storage.local.set({ lastSync: Date.now() });
      await checkServerStatus();
    } else {
      showToast('❌ 同步失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    showToast('❌ 网络错误：' + e.message);
  } finally {
    btn.disabled = false;
    btnIcon.textContent = '⇅';
    btnText.textContent = '同步 Cookie 到服务器';
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 读取上次同步时间
  chrome.storage.local.get(['lastSync'], result => {
    document.getElementById('lastSync').textContent = formatTime(result.lastSync);
  });

  await Promise.all([checkLoginStatus(), checkServerStatus()]);

  document.getElementById('syncBtn').addEventListener('click', syncCookies);
});
