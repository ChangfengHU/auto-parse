const SERVER = 'https://parse.vyibc.com';

// 需要同步的 cookie 名称（按优先级排列）
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

// ── Toast ──────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── 时间格式化 ──────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 从浏览器读取 douyin cookies ──────────────────────────
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

// cookie 对象 → 字符串
function cookiesToString(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// cookie 字符串 → 对象数组
function parseCookieString(str) {
  return str.split(';').map(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return null;
    return {
      name: part.slice(0, idx).trim(),
      value: part.slice(idx + 1).trim(),
    };
  }).filter(c => c && c.name && c.value);
}

// ── 一键读取抖音登录信息 ──────────────────────────────────
async function readCookiesToBox() {
  const readBtn = document.getElementById('readBtn');
  const readText = document.getElementById('readText');
  const readIcon = document.getElementById('readIcon');

  readBtn.disabled = true;
  readIcon.textContent = '⏳';
  readText.textContent = '读取中...';

  try {
    const cookies = await getDouyinCookies();
    const str = cookiesToString(cookies);

    if (!str) {
      showToast('❌ 未读取到抖音 Cookie，请先登录抖音网页版');
      return;
    }

    document.getElementById('cookieBox').value = str;

    // 同时复制到剪贴板
    try {
      await navigator.clipboard.writeText(str);
      showToast('✅ 已读取并复制到剪贴板');
    } catch {
      showToast('✅ 已读取到文本框');
    }

    // 刷新登录状态
    await checkLoginStatus();
  } catch (e) {
    showToast('❌ 读取失败：' + e.message);
  } finally {
    readBtn.disabled = false;
    readIcon.textContent = '📋';
    readText.textContent = '一键读取抖音登录信息';
  }
}

// ── 同步登录抖音（把文本框的 cookie 写入浏览器）────────────
async function restoreDouyinLogin() {
  const loginBtn = document.getElementById('loginBtn');
  const loginText = document.getElementById('loginText');

  const cookieStr = document.getElementById('cookieBox').value.trim();
  if (!cookieStr) {
    showToast('❌ 请先填入 Cookie 信息');
    return;
  }
  if (!cookieStr.includes('sessionid=')) {
    showToast('❌ Cookie 中缺少 sessionid，请确认登录信息完整');
    return;
  }

  loginBtn.disabled = true;
  loginText.textContent = '同步中...';

  try {
    const pairs = parseCookieString(cookieStr);
    let successCount = 0;

    await Promise.all(pairs.map(({ name, value }) =>
      new Promise(resolve => {
        chrome.cookies.set(
          {
            url: 'https://www.douyin.com',
            name,
            value,
            domain: '.douyin.com',
            path: '/',
            secure: true,
            sameSite: 'no_restriction',
          },
          cookie => {
            if (cookie) successCount++;
            resolve();
          }
        );
      })
    ));

    showToast(`✅ 已写入 ${successCount} 个 Cookie 到抖音`);
    await checkLoginStatus();
  } catch (e) {
    showToast('❌ 写入失败：' + e.message);
  } finally {
    loginBtn.disabled = false;
    loginText.textContent = '同步登录抖音';
  }
}

// ── 同步 Cookie 到解析平台 ──────────────────────────────
async function syncToServer() {
  const syncBtn = document.getElementById('syncBtn');
  const syncText = document.getElementById('syncText');
  const syncIcon = document.getElementById('syncIcon');

  // 优先用文本框内容；如果为空则从浏览器读取
  let cookieStr = document.getElementById('cookieBox').value.trim();
  if (!cookieStr) {
    const cookies = await getDouyinCookies();
    cookieStr = cookiesToString(cookies);
    if (cookieStr) {
      document.getElementById('cookieBox').value = cookieStr;
    }
  }

  if (!cookieStr) {
    showToast('❌ 未检测到登录状态，请先登录抖音');
    return;
  }
  if (!cookieStr.includes('sessionid=')) {
    showToast('❌ Cookie 中缺少 sessionid，请先登录抖音');
    return;
  }

  syncBtn.disabled = true;
  syncIcon.textContent = '⟳';
  syncText.textContent = '同步中...';

  try {
    const res = await fetch(`${SERVER}/api/cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieStr }),
    });

    const data = await res.json();
    if (data.success) {
      showToast('✅ 已同步到解析平台！');
      chrome.storage.local.set({ lastSync: Date.now() });
      await checkServerStatus();
    } else {
      showToast('❌ 同步失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    showToast('❌ 网络错误：' + e.message);
  } finally {
    syncBtn.disabled = false;
    syncIcon.textContent = '⇅';
    syncText.textContent = '同步到解析平台';
  }
}

// ── 检查抖音登录状态 ──────────────────────────────────────
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

// ── 检查服务器 Cookie 状态 ────────────────────────────────
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

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 读取本地缓存的同步时间
  chrome.storage.local.get(['lastSync'], result => {
    if (result.lastSync) {
      document.getElementById('lastSync').textContent = formatTime(result.lastSync);
    }
  });

  // 并行检查状态
  await Promise.all([checkLoginStatus(), checkServerStatus()]);

  // 绑定按钮
  document.getElementById('readBtn').addEventListener('click', readCookiesToBox);
  document.getElementById('loginBtn').addEventListener('click', restoreDouyinLogin);
  document.getElementById('syncBtn').addEventListener('click', syncToServer);
});
