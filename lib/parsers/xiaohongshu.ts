import axios from 'axios';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface XhsParseResult {
  platform: 'xiaohongshu';
  videoId: string;
  videoUrl: string;
  title?: string;
}

export async function parseXiaohongshu(input: string): Promise<XhsParseResult> {
  // 支持多种链接格式
  // https://www.xiaohongshu.com/explore/{id}
  // https://www.xiaohongshu.com/discovery/item/{id}
  // http://xhslink.com/xxx  (短链)
  const urlMatch = input.match(/https?:\/\/[^\s]+(?:xiaohongshu\.com|xhslink\.com)[^\s]*/);
  if (!urlMatch) throw new Error('未找到有效的小红书链接');
  let url = urlMatch[0];

  // 短链先跟随重定向
  if (url.includes('xhslink.com')) {
    const r = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    url = r.headers['location'] ?? url;
  }

  // /explore/ 会 302 到 /discovery/item/
  const noteIdMatch = url.match(/(?:explore|discovery\/item)\/([a-f0-9]+)/);
  if (!noteIdMatch) throw new Error('无法从链接中提取笔记 ID');
  const noteId = noteIdMatch[1];

  // 保留原始 xsec_token（有些内容需要）
  const tokenMatch = url.match(/xsec_token=([^&\s]+)/);
  const xsecToken = tokenMatch ? tokenMatch[1] : '';

  const fetchUrl = `https://www.xiaohongshu.com/discovery/item/${noteId}${xsecToken ? `?xsec_token=${xsecToken}&xsec_source=pc_feed` : ''}`;

  const res = await axios.get(fetchUrl, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://www.xiaohongshu.com/',
    },
    timeout: 15000,
  });

  const html: string = res.data;

  // 从 __INITIAL_STATE__ 中提取 masterUrl
  const masterUrlMatch = html.match(/"masterUrl":"((?:[^"\\]|\\.)*)"/);
  if (!masterUrlMatch) throw new Error('页面中未找到视频地址，可能是图文笔记或需要登录');

  // 反转义 Unicode（\u002F → /）
  const videoUrl = masterUrlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');

  // 提取标题
  const titleMatch = html.match(/"title":"((?:[^"\\]|\\.)*)"/);
  const title = titleMatch?.[1].replace(/\\u[\da-f]{4}/gi, (m) =>
    String.fromCharCode(parseInt(m.slice(2), 16))
  );

  return { platform: 'xiaohongshu', videoId: noteId, videoUrl, title };
}
