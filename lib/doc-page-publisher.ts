import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { uploadBuffer } from '@/lib/oss';

function escapeHtml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function formatInline(input: string) {
  let text = escapeHtml(input);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return text;
}

function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const toc: Array<{ level: number; text: string; id: string }> = [];
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map((x) => formatInline(x)).join('<br />')}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!inList) return;
    out.push('</ul>');
    inList = false;
  };

  const flushCode = () => {
    if (!inCode) return;
    const lang = escapeHtml(codeLang || 'text');
    const code = escapeHtml(codeLines.join('\n'));
    out.push(
      `<div class="code-block">` +
      `<div class="code-toolbar"><span class="code-lang">${lang}</span><button class="copy-btn" type="button">复制</button></div>` +
      `<pre><code>${code}</code></pre>` +
      `</div>`
    );
    inCode = false;
    codeLang = '';
    codeLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const fence = raw.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || 'text';
      } else {
        flushCode();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line === '---') {
      flushParagraph();
      flushList();
      out.push('<hr />');
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph();
      flushList();
      const level = h[1].length;
      const text = formatInline(h[2]);
      const id = slugify(h[2]);
      if (level <= 3) toc.push({ level, text: h[2], id });
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${formatInline(li[1])}</li>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushCode();

  const tocHtml = toc.length
    ? `<aside class="toc"><div class="toc-title">目录</div>${toc.map((item) => `<a class="toc-l${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`).join('')}</aside>`
    : '';
  return `${tocHtml}<main class="doc">${out.join('\n')}</main>`;
}

function wrapHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg: #f6f8fb; --card: #fff; --line: #e5e7eb; --text: #0f172a; --muted: #64748b; --brand: #2563eb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.75; }
    .layout { max-width: 1100px; margin: 0 auto; padding: 24px 16px 60px; display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; }
    .toc { position: sticky; top: 16px; align-self: start; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
    .toc-title { font-weight: 700; margin-bottom: 8px; }
    .toc a { display: block; text-decoration: none; color: #334155; margin: 4px 0; }
    .toc a:hover { color: var(--brand); }
    .toc .toc-l3 { padding-left: 12px; font-size: 13px; color: var(--muted); }
    .doc { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(15, 23, 42, 0.05); }
    h1,h2,h3,h4,h5,h6 { line-height: 1.35; margin-top: 1.2em; scroll-margin-top: 12px; }
    h1 { margin-top: 0; font-size: 30px; }
    h2 { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    p { margin: 0.8em 0; }
    ul { padding-left: 1.3em; }
    hr { border: none; border-top: 1px solid var(--line); margin: 22px 0; }
    a { color: var(--brand); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #eef2ff; padding: 2px 6px; border-radius: 6px; font-size: 0.92em; }
    .code-block { border: 1px solid #1f2937; border-radius: 10px; overflow: hidden; margin: 14px 0; }
    .code-toolbar { display: flex; align-items: center; justify-content: space-between; background: #0f172a; color: #e2e8f0; padding: 8px 10px; font-size: 12px; }
    .copy-btn { border: 1px solid #334155; background: #111827; color: #e2e8f0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    .copy-btn:hover { background: #1f2937; }
    pre { margin: 0; padding: 14px; background: #0b1220; color: #dbeafe; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    pre code { background: transparent; padding: 0; color: inherit; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .toc { position: static; }
      .doc { padding: 18px; }
    }
  </style>
</head>
<body>
  <div class="layout">${body}</div>
  <script>
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const block = btn.closest('.code-block');
        const code = block ? block.querySelector('pre code') : null;
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code.textContent || '');
          const old = btn.textContent;
          btn.textContent = '已复制';
          setTimeout(() => { btn.textContent = old || '复制'; }, 1200);
        } catch (_) {
          btn.textContent = '复制失败';
          setTimeout(() => { btn.textContent = '复制'; }, 1200);
        }
      });
    });
  </script>
</body>
</html>`;
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishDocPage(input: {
  title?: string;
  content?: string;
  filePath?: string;
  folder?: string;
  objectKey?: string;
  provider?: 'doc-to-page' | 'oss';
}) {
  const folder = (input.folder || 'doc-pages').trim() || 'doc-pages';
  let content = String(input.content || '');
  let sourceFile = '';
  if (!content && input.filePath) {
    const p = path.resolve(input.filePath);
    if (!fs.existsSync(p)) throw new Error(`文件不存在: ${p}`);
    sourceFile = p;
    content = fs.readFileSync(p, 'utf8');
  }
  if (!content.trim()) throw new Error('content 和 filePath 不能同时为空');

  const title = String(
    input.title
      || (sourceFile ? path.basename(sourceFile, path.extname(sourceFile)) : '在线文档')
  ).trim();

  const ext = sourceFile ? path.extname(sourceFile).toLowerCase() : '.md';
  let body = '';
  if (ext === '.html' || ext === '.htm') {
    body = content;
  } else if (ext === '.md' || ext === '.markdown' || !sourceFile) {
    body = markdownToHtml(content);
  } else {
    body = `<pre>${escapeHtml(content)}</pre>`;
  }

  const html = wrapHtml(title, body);
  const provider = input.provider || 'doc-to-page';
  if (provider === 'doc-to-page') {
    const endpoint = process.env.DOC_TO_PAGE_API_URL || 'http://165.154.134.82:1002/v1beta/documents:toPage';
    let lastError = 'doc-to-page 调用失败';
    for (let i = 0; i < 3; i++) {
      const resp = await axios.post(endpoint, {
        title,
        content: html,
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      if (resp.status >= 200 && resp.status < 300 && resp.data?.page_url) {
        return {
          pageUrl: String(resp.data.page_url),
          key: null,
          title,
          provider: 'doc-to-page' as const,
        };
      }
      lastError = typeof resp.data?.error?.message === 'string'
        ? resp.data.error.message
        : `doc-to-page 调用失败: HTTP ${resp.status}`;
      if (i < 2) await sleep(1000 * (i + 1));
    }
    throw new Error(lastError);
  }

  const ts = Date.now();
  const key = input.objectKey?.trim()
    ? input.objectKey.trim()
    : `${folder}/${ts}-${sanitizeName(title)}.html`;
  const pageUrl = await uploadBuffer(Buffer.from(html, 'utf8'), key, 'text/html; charset=utf-8');
  return { pageUrl, key, title, provider: 'oss' as const };
}
