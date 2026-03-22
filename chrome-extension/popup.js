const SERVER = 'https://parse.vyibc.com';

// uid_tt 是登录后才会出现的用户 ID cookie，用于判断是否真实登录
const COOKIE_KEYS = [
  'sessionid', 'sessionid_ss',
  'uid_tt', 'uid_tt_ss',
  'ttwid', 'passport_csrf_token', 'passport_csrf_token_default',
  's_v_web_id', 'UIFID', 'is_dash_user', 'login_time', 'bit_env',
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
    return { name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
  }).filter(c => c && c.name && c.value);
}

// ── 一键读取抖音登录信息 → 填入文本框 ──────────────────
async function readCookiesToBox() {
  const btn = document.getElementById('readBtn');
  const icon = document.getElementById('readIcon');
  const text = document.getElementById('readText');

  btn.disabled = true;
  icon.textContent = '⏳';
  text.textContent = '读取中...';

  try {
    const cookies = await getDouyinCookies();
    const str = cookiesToString(cookies);

    if (!str) {
      showToast('未读取到抖音 Cookie，请先登录抖音网页版');
      return;
    }

    document.getElementById('cookieBox').value = str;
    showToast('已读取到文本框，可点击复制按钮复制');
    await checkLoginStatus();
  } catch (e) {
    showToast('读取失败：' + e.message);
  } finally {
    btn.disabled = false;
    icon.textContent = '📋';
    text.textContent = '一键读取抖音登录信息';
  }
}

// ── 复制文本框内容到剪贴板 ──────────────────────────────
async function copyToClipboard() {
  const val = document.getElementById('cookieBox').value.trim();
  if (!val) {
    showToast('文本框为空，请先读取登录信息');
    return;
  }
  try {
    await navigator.clipboard.writeText(val);
    showToast('已复制到剪贴板！');
  } catch {
    // fallback
    document.getElementById('cookieBox').select();
    document.execCommand('copy');
    showToast('已复制到剪贴板！');
  }
}



// ── 检查抖音登录状态（用 uid_tt 做真实验证）──────────────
async function checkLoginStatus() {
  const cookies = await getDouyinCookies();
  const hasSession = !!cookies.sessionid;
  const hasUid = !!cookies.uid_tt;
  const el = document.getElementById('loginStatus');

  if (hasSession && hasUid) {
    // sessionid + uid_tt 都有 → 确认是真实登录
    el.className = 'badge badge-green';
    el.innerHTML = '<span class="dot dot-green"></span> 已登录（已验证）';
  } else if (hasSession && !hasUid) {
    // 只有 sessionid，没有 uid_tt → 可能是过期的残留 cookie
    el.className = 'badge badge-yellow';
    el.innerHTML = '<span class="dot dot-yellow"></span> Cookie 不完整';
  } else {
    el.className = 'badge badge-red';
    el.innerHTML = '<span class="dot dot-red"></span> 未登录';
  }
  return hasSession && hasUid;
}


// ── 保活开关 ──────────────────────────────────────────────
async function initKeepAliveToggle() {
  const toggle = document.getElementById('keepAliveToggle');
  const statusEl = document.getElementById('keepAliveStatus');

  // 读取当前保活状态
  chrome.runtime.sendMessage({ type: 'GET_KEEP_ALIVE_STATUS' }, res => {
    const active = res && res.active;
    toggle.checked = active;
    updateKeepAliveUI(active);
  });

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ keepAliveEnabled: enabled });
    chrome.runtime.sendMessage({ type: 'SET_KEEP_ALIVE', enabled });
    updateKeepAliveUI(enabled);
    showToast(enabled ? '保活已开启，每分钟 ping 抖音' : '保活已关闭');
  });

  function updateKeepAliveUI(active) {
    statusEl.textContent = active ? '运行中' : '已关闭';
    statusEl.className = 'status-value ' + (active ? 'text-green' : 'text-gray');
  }
}



// ── 显示 clientId ──────────────────────────────────────
async function loadClientId() {
  const { clientId } = await chrome.storage.local.get('clientId');
  const el = document.getElementById('clientIdDisplay');
  if (!el) return;
  if (clientId) {
    el.textContent = clientId;
    el.title = '点击复制凭证';
    el.addEventListener('click', () => {
      navigator.clipboard.writeText(clientId).then(() => showToast('凭证已复制！'));
    });
  } else {
    el.textContent = '生成中...';
    // 触发 background 生成
    setTimeout(loadClientId, 1000);
  }
}


// ── 手动同步到发布平台 ─────────────────────────────────
async function manualSyncToPublish() {
  const btn = document.getElementById('manualSyncBtn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '⟳';

  const cookies = await getDouyinCookies();
  const cookieStr = cookiesToString(cookies);
  if (!cookieStr || !cookieStr.includes('sessionid=')) {
    showToast('未检测到抖音登录，无法同步');
    btn.disabled = false; btn.textContent = '☁';
    return;
  }

  chrome.runtime.sendMessage({ type: 'SYNC_TO_SUPABASE', cookieStr }, res => {
    if (res?.ok) {
      const now = Date.now();
      chrome.storage.local.set({ lastPublishSync: now });
      const el = document.getElementById('lastPublishSync');
      if (el) el.textContent = formatTime(now);
      showToast('✅ 已同步到发布平台');
    } else {
      showToast('同步失败，请检查网络');
    }
    btn.disabled = false; btn.textContent = '☁';
  });
}

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 恢复本地缓存的同步时间
  chrome.storage.local.get(['lastPublishSync'], result => {
    const el = document.getElementById('lastPublishSync');
    if (el && result.lastPublishSync) el.textContent = formatTime(result.lastPublishSync);
  });

  // 并行检查状态
  await checkLoginStatus();

  // 初始化保活开关
  await initKeepAliveToggle();

  // 绑定按钮
  document.getElementById('readBtn').addEventListener('click', readCookiesToBox);
  document.getElementById('copyBtn').addEventListener('click', copyToClipboard);



  await loadClientId();
  document.getElementById('manualSyncBtn')?.addEventListener('click', manualSyncToPublish);
});
