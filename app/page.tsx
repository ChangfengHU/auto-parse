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

const STEPS = ['解析短链', '提取视频地址', '下载视频', '上传 OSS'];

interface CookieStatus {
  valid: boolean;
  updatedAt: number | null;
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

  async function handleParse() {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    setStep(0);

    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 2000);
    const t3 = setTimeout(() => setStep(3), 4000);

    try {
      const res = await fetch('/api/parse', {
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
          <h1 className="text-3xl font-bold tracking-tight">视频解析工具</h1>
          <p className="mt-2 text-gray-400 text-sm">粘贴分享文本，自动提取视频地址并上传至 OSS</p>
          <div className="mt-4 flex justify-center">
            <CookieStatusBar />
          </div>
        </div>

        {/* Platform Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['抖音', '小红书'] as const).map((p) => (
            <div key={p} className="px-4 py-1.5 rounded-full text-sm font-medium border bg-pink-600 border-pink-500 text-white">
              {p}
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
            placeholder={`粘贴抖音分享文本，例如：\n9.43 B@T.yt 05/19 VYm:/ 心怎么变 都是偏向你 https://v.douyin.com/xxxxx/`}
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
              <p className="text-sm text-gray-300 border-b border-gray-800 pb-3">{result.title}</p>
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
            <div className="flex gap-2 pt-1">
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
                onClick={() => copy(`视频地址：${result.videoUrl}\nOSS地址：${result.ossUrl}`, 'both')}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors"
              >
                {copied === 'both' ? '已复制全部' : '复制全部地址'}
              </button>
              <button
                onClick={() => { setResult(null); setError(''); setStep(-1); }}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors"
              >
                重新解析
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
