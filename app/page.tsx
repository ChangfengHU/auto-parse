'use client';

import { useState, useEffect } from 'react';

interface Result {
  platform: string;
  videoId: string;
  title: string;
  videoUrl: string;
  ossUrl: string;
  watermark?: boolean;
}

type PublishState = 'idle' | 'confirm' | 'publishing' | 'done' | 'error';

const STEPS = ['解析短链', '提取视频地址', '下载视频', '上传 OSS'];

interface CookieStatus {
  valid: boolean;
  updatedAt: number | null;
}

// 平台检测函数
function detectPlatform(input: string): 'douyin' | 'xiaohongshu' | 'tiktok' | null {
  if (input.includes('douyin.com') || input.includes('v.douyin.com')) {
    return 'douyin';
  }
  if (input.includes('xiaohongshu.com') || input.includes('xhslink.com')) {
    return 'xiaohongshu';
  }
  if (input.includes('tiktok.com') || input.includes('vm.tiktok.com')) {
    return 'tiktok';
  }
  return null;
}

function formatTime(ts: number | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function CookieStatusBar() {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/cookie')
      .then(r => r.json())
      .then((d: CookieStatus) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
        检测 Cookie 状态…
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
        无法连接服务
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
        status.valid
          ? 'bg-green-950 border-green-800 text-green-400'
          : 'bg-red-950 border-red-900 text-red-400'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${status.valid ? 'bg-green-400' : 'bg-red-400'}`} />
        {status.valid ? '抖音 Cookie 有效' : 'Cookie 已过期'}
      </span>
      {status.updatedAt && (
        <span className="text-gray-600">上次同步 {formatTime(status.updatedAt)}</span>
      )}
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);

  // 发布到抖音
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [publishTitle, setPublishTitle] = useState('');
  const [publishMsg, setPublishMsg] = useState('');
  const [publishLogs, setPublishLogs] = useState<string[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);

  // 检测输入的平台
  useEffect(() => {
    const platform = detectPlatform(input);
    setDetectedPlatform(platform);
  }, [input]);

  async function handleParse() {
    if (!input.trim() || loading) return;
    
    const platform = detectPlatform(input);
    if (!platform) {
      setError('请输入有效的抖音、小红书或TikTok分享链接');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    setStep(0);

    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 2000);
    const t3 = setTimeout(() => setStep(3), 4000);

    try {
      // 根据平台选择API endpoint
      const apiEndpoint = platform === 'tiktok' ? '/api/parse-tiktok' : '/api/parse';
      
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      const data = await res.json();
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      if (!res.ok || !data.success) {
        setError(data.error ?? '解析失败，请检查链接是否有效');
        setStep(-1);
      } else {
        setStep(4);
        setResult(data);
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      setError('网络请求失败，请检查网络连接');
      setStep(-1);
    } finally {
      setLoading(false);
    }
  }

  function openPublishPanel() {
    setPublishTitle(result?.title ?? '');
    setPublishMsg('');
    setPublishState('confirm');
  }

  async function handlePublish() {
    if (!result) return;
    setPublishState('publishing');
    setPublishMsg('');
    setPublishLogs([]);
    setQrCodeUrl(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: result.ossUrl, title: publishTitle }),
      });
      if (!res.body) throw new Error('不支持流式响应');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const { type, payload } = JSON.parse(line.slice(6)) as { type: string; payload: string };
            if (type === 'log') {
              setPublishLogs(prev => [...prev, payload]);
            } else if (type === 'qrcode') {
              setQrCodeUrl(payload);
            } else if (type === 'done') {
              setQrCodeUrl(null);
              setPublishState('done');
              setPublishMsg(payload);
            } else if (type === 'error') {
              setPublishState('error');
              setPublishMsg(payload);
            }
          } catch { /* ignore malformed line */ }
        }
      }
    } catch (e: unknown) {
      setPublishState('error');
      setPublishMsg(e instanceof Error ? e.message : '网络错误');
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">多平台视频解析工具</h1>
          <p className="mt-2 text-gray-400 text-sm">支持抖音、TikTok、小红书，自动提取视频地址并上传至 OSS</p>
          <div className="mt-4 flex justify-center">
            <CookieStatusBar />
          </div>
        </div>

        {/* Platform Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['抖音', '小红书', 'TikTok'] as const).map((p) => (
            <div key={p} className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              (p === '抖音' && detectedPlatform === 'douyin') ||
              (p === '小红书' && detectedPlatform === 'xiaohongshu') ||
              (p === 'TikTok' && detectedPlatform === 'tiktok')
                ? 'bg-pink-600 border-pink-500 text-white ring-2 ring-pink-500/30'
                : 'bg-pink-600/80 border-pink-500/80 text-white/80'
            }`}>
              {p}
              {((p === '抖音' && detectedPlatform === 'douyin') ||
                (p === '小红书' && detectedPlatform === 'xiaohongshu') ||
                (p === 'TikTok' && detectedPlatform === 'tiktok')) && (
                <span className="ml-1 text-xs">✓</span>
              )}
            </div>
          ))}
          {(['B站', '微博']).map((p) => (
            <div key={p} className="px-4 py-1.5 rounded-full text-sm font-medium border bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed">
              {p} <span className="text-xs opacity-60">即将支持</span>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <textarea
            className="w-full bg-transparent resize-none text-sm text-gray-200 placeholder-gray-600 outline-none leading-relaxed"
            rows={4}
            placeholder={`粘贴分享文本，例如：
抖音: 9.43 B@T.yt 05/19 VYm:/ 心怎么变 都是偏向你 https://v.douyin.com/xxxxx/
TikTok: https://www.tiktok.com/@username/video/1234567890
${detectedPlatform ? `当前检测到: ${detectedPlatform === 'douyin' ? '抖音' : detectedPlatform === 'tiktok' ? 'TikTok' : '小红书'}` : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <div className="flex justify-between items-center mt-3">
            <button
              onClick={() => { setInput(''); setResult(null); setError(''); setStep(-1); }}
              disabled={loading}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              清空
            </button>
            <button
              onClick={handleParse}
              disabled={loading || !input.trim()}
              className="px-6 py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? '解析中...' : '开始解析'}
            </button>
          </div>
        </div>

        {/* Progress */}
        {loading && step >= 0 && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3">处理进度</p>
            <div className="space-y-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    i < step ? 'bg-green-600 text-white' : i === step ? 'bg-pink-600 text-white animate-pulse' : 'bg-gray-800 text-gray-600'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm ${i < step ? 'text-green-400' : i === step ? 'text-white' : 'text-gray-600'}`}>
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-6 bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">视频 ID: {result.videoId}</span>
              <span className="px-2 py-0.5 bg-green-900 text-green-400 text-xs rounded-full">上传成功</span>
            </div>

            {result.title && (
              <p className="text-sm text-gray-300 border-b border-gray-800 pb-3">
                {result.title}
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                  result.platform === 'tiktok' 
                    ? 'bg-pink-900 text-pink-400' 
                    : result.platform === 'douyin'
                    ? 'bg-pink-900 text-pink-400'
                    : 'bg-red-900 text-red-400'
                }`}>
                  {result.platform === 'tiktok' ? 'TikTok' : 
                   result.platform === 'douyin' ? '抖音' : '小红书'}
                </span>
              </p>
            )}

            {/* Video Player */}
            <div className="rounded-xl overflow-hidden bg-black">
              <video
                src={result.ossUrl}
                controls
                playsInline
                className="w-full max-h-96 object-contain"
                preload="metadata"
              />
            </div>

            {/* Video URL */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">
                视频原始地址
                {result.platform === 'douyin' && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${result.watermark !== false ? 'bg-yellow-900 text-yellow-400' : 'bg-green-900 text-green-400'}`}>
                    {result.watermark !== false ? '含水印' : '无水印'}
                  </span>
                )}
                {result.platform === 'tiktok' && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-green-900 text-green-400">
                    无水印
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2.5">
                <span className="text-xs text-gray-300 flex-1 truncate">{result.videoUrl}</span>
                <button
                  onClick={() => copy(result.videoUrl, 'video')}
                  className="flex-shrink-0 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                >
                  {copied === 'video' ? '已复制' : '复制'}
                </button>
              </div>
            </div>

            {/* OSS URL */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">OSS 存储地址</p>
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2.5">
                <span className="text-xs text-blue-400 flex-1 truncate">{result.ossUrl}</span>
                <button
                  onClick={() => copy(result.ossUrl, 'oss')}
                  className="flex-shrink-0 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                >
                  {copied === 'oss' ? '已复制' : '复制'}
                </button>
              </div>
            </div>

            {/* Bottom actions */}
            <div className="flex gap-2 pt-1 flex-wrap">
              <a
                href={result.ossUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 bg-pink-600 hover:bg-pink-500 rounded-lg text-xs font-medium text-center transition-colors"
              >
                下载视频
              </a>
              <button
                onClick={openPublishPanel}
                disabled={publishState === 'publishing' || result.platform === 'tiktok'}
                className="flex-1 py-2 bg-black hover:bg-gray-900 border border-gray-700 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={result.platform === 'tiktok' ? 'TikTok视频暂不支持发布到抖音' : '发布到抖音'}
              >
                {result.platform === 'tiktok' ? '暂不支持发布' : '发布到抖音'}
              </button>
              <button
                onClick={() => copy(`视频地址：${result.videoUrl}\nOSS地址：${result.ossUrl}`, 'both')}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors"
              >
                {copied === 'both' ? '已复制全部' : '复制全部'}
              </button>
              <button
                onClick={() => { setResult(null); setError(''); setStep(-1); setPublishState('idle'); }}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors"
              >
                重新解析
              </button>
            </div>

            {/* 发布到抖音面板 */}
            {publishState !== 'idle' && (
              <div className="mt-3 rounded-xl border border-gray-700 bg-gray-950 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white">发布到抖音</p>
                  {publishState !== 'publishing' && (
                    <button
                      onClick={() => setPublishState('idle')}
                      className="text-gray-600 hover:text-gray-400 text-xs"
                    >
                      关闭
                    </button>
                  )}
                </div>

                {(publishState === 'confirm') && (
                  <>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">标题（可修改，最多 55 字）</p>
                      <textarea
                        rows={2}
                        maxLength={55}
                        value={publishTitle}
                        onChange={e => setPublishTitle(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none resize-none focus:border-pink-600 transition-colors"
                        placeholder="输入视频标题..."
                      />
                      <p className="text-right text-xs text-gray-600 mt-0.5">{publishTitle.length}/55</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      后台将自动打开无头浏览器发布视频。若 Cookie 已过期，页面会弹出二维码供你扫码登录。
                    </p>
                    <button
                      onClick={handlePublish}
                      disabled={!publishTitle.trim()}
                      className="w-full py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
                    >
                      确认发布
                    </button>
                  </>
                )}

                {publishState === 'publishing' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <span className="text-xs text-gray-400">发布进行中，后台浏览器运行中…</span>
                    </div>

                    {/* 扫码登录 QR 码 */}
                    {qrCodeUrl && (
                      <div className="border border-yellow-700 bg-yellow-950 rounded-xl p-4 flex flex-col items-center gap-3">
                        <p className="text-xs text-yellow-400 font-medium">Cookie 已过期，请用抖音 App 扫码登录</p>
                        <img src={qrCodeUrl} alt="抖音扫码登录" className="w-48 h-48 object-contain rounded-lg bg-white p-2" />
                        <p className="text-xs text-yellow-600">扫码后自动继续发布，二维码约 3 分钟有效</p>
                      </div>
                    )}

                    <div className="bg-black rounded-lg p-3 h-40 overflow-y-auto font-mono text-xs text-green-400 space-y-0.5">
                      {publishLogs.length === 0 && (
                        <span className="text-gray-600">等待日志输出...</span>
                      )}
                      {publishLogs.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}

                {publishState === 'done' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-400 text-sm">
                      <span>✓</span>
                      <span>{publishMsg}</span>
                    </div>
                    {publishLogs.length > 0 && (
                      <div className="bg-black rounded-lg p-3 h-36 overflow-y-auto font-mono text-xs text-gray-500 space-y-0.5">
                        {publishLogs.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {publishState === 'error' && (
                  <div className="space-y-2">
                    <p className="text-red-400 text-sm">{publishMsg}</p>
                    <button
                      onClick={() => setPublishState('confirm')}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      重试
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
