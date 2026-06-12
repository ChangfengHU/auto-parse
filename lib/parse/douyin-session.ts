export async function validateDouyinSession(cookieStr: string): Promise<{ loggedIn: boolean; account: string | null }> {
  if (!cookieStr || !/(?:^|;\s*)sessionid(?:_ss)?=/.test(cookieStr)) {
    return { loggedIn: false, account: null };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://creator.douyin.com/web/api/media/aweme/post/?count=1&cursor=0',
      {
        headers: {
          Cookie: cookieStr,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://creator.douyin.com/',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return { loggedIn: true, account: null }; // 5xx 等异常保守处理
    const data = await res.json() as { status_code?: number };
    if (data?.status_code === 8) return { loggedIn: false, account: null };
    return { loggedIn: true, account: null };
  } catch {
    return { loggedIn: true, account: null }; // 超时保守处理
  }
}
