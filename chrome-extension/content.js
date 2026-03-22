// Content script 注入到 parse.vyibc.com
// 监听页面发来的 clientId 请求，返回本地存储的凭证

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'DOUYIN_GET_CLIENT_ID') return;

  const { clientId } = await chrome.storage.local.get('clientId');
  window.postMessage({
    type: 'DOUYIN_CLIENT_ID',
    clientId: clientId || null,
  }, '*');
});
