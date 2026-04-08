// Content script 注入到 parse.vyibc.com
// 监听页面发来的凭证请求，返回对应平台 clientId

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;
  if (type !== 'DOUYIN_GET_CLIENT_ID' && type !== 'PLATFORM_GET_CLIENT_ID') return;

  const platform = type === 'PLATFORM_GET_CLIENT_ID'
    ? String(event.data?.platform || 'douyin')
    : 'douyin';
  const keyMap = {
    douyin: 'douyinClientId',
    xhs: 'xhsClientId',
    gemini: 'geminiClientId',
  };
  const key = keyMap[platform] || keyMap.douyin;
  const result = await chrome.storage.local.get([key, 'clientId']);
  const clientId = result[key] || (platform === 'douyin' ? result.clientId : null);

  if (type === 'PLATFORM_GET_CLIENT_ID') {
    window.postMessage({
      type: 'PLATFORM_CLIENT_ID',
      platform,
      clientId: clientId || null,
    }, '*');
    return;
  }

  window.postMessage({
    type: 'DOUYIN_CLIENT_ID',
    clientId: clientId || null,
  }, '*');
});
