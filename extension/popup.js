const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const syncBtn = document.getElementById('syncBtn');
const clientIdEl = document.getElementById('clientId');
const copyBtn = document.getElementById('copyBtn');

function setStatus(state, title, desc) {
  dot.className = `status-dot ${state}`;
  statusText.innerHTML = `<strong>${title}</strong>${desc ? `<br/><span style="font-size:10px;color:#888">${desc}</span>` : ''}`;
}

// 初始化：加载 clientId 和上次同步状态
async function init() {
  const { clientId, lastSyncAt, lastSyncOk } = await chrome.storage.local.get(['clientId', 'lastSyncAt', 'lastSyncOk']);

  if (clientId) {
    clientIdEl.value = clientId;
  }

  if (lastSyncAt) {
    const ago = Math.round((Date.now() - lastSyncAt) / 60000);
    const agoStr = ago < 1 ? '刚刚' : ago < 60 ? `${ago} 分钟前` : `${Math.round(ago / 60)} 小时前`;
    if (lastSyncOk) {
      setStatus('ok', '✅ 已同步', `上次同步：${agoStr}`);
    } else {
      setStatus('error', '上次同步失败', agoStr);
    }
  } else {
    setStatus('unknown', '尚未同步', '点击按钮立即同步');
  }
}

// 复制 clientId
copyBtn.addEventListener('click', () => {
  const val = clientIdEl.value;
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
  });
});

// 手动同步
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  setStatus('syncing', '同步中...', '正在读取抖音 Cookie');

  const result = await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });

  if (result?.ok) {
    await chrome.storage.local.set({ lastSyncAt: Date.now(), lastSyncOk: true });
    setStatus('success', '✅ 同步成功！', `写入 ${result.cookieCount} 个 Cookie`);
  } else {
    const errMap = {
      'not_logged_in': '请先在浏览器中登录 creator.douyin.com',
      'no clientId': '初始化异常，请重新安装插件',
    };
    setStatus('error', '同步失败', errMap[result?.error] || result?.error || '未知错误');
    await chrome.storage.local.set({ lastSyncOk: false });
  }

  syncBtn.disabled = false;
});

init();
