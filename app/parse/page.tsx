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

function detectPlatform(input: string): 'douyin' | 'xiaohongshu' | 'tiktok' | null {
  if (input.includes('douyin.com') || input.includes('v.douyin.com')) return 'douyin';
  if (input.includes('xiaohongshu.com') || input.includes('xhslink.com')) return 'xiaohongshu';
  if (input.includes('tiktok.com') || input.includes('vm.tiktok.com')) return 'tiktok';
  return null;
}

export default function ParsePage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);

  useEffect(() => { setDetectedPlatform(detectPlatform(input)); }, [input]);

  async function handleParse() {
    if (!input.trim() || loading) return;
    const platform = detectPlatform(input);
    if (!platform) { setError('请输入有效的抖音、小红书或TikTok分享链接'); return; }
    setLoading(true); setError(''); setResult(null); setStep(0);
    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 2000);
    const t3 = setTimeout(() => setStep(3), 4000);
    try {
      const apiEndpoint = platform === 'tiktok' ? '/api/parse-tiktok' : '/api/parse';
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      const data = await res.json();
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      if (!res.ok || !data.success) {
        setError(data.error ?? '解析失败，请检查链接是否有效'); setStep(-1);
      } else {
        setStep(4); setResult(data);
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      setError('网络请求失败，请检查网络连接'); setStep(-1);
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">视频解析</h1>
        <p className="mt-1 text-gray-400 text-sm">支持抖音、TikTok、小红书，自动去水印并上传至 OSS</p>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['抖音', '小红书', 'TikTok'] as const).map((p) => (
          <div key={p} className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            (p === '抖音' && detectedPlatform === 'douyin') ||
            (p === '小红书' && detectedPlatform === 'xiaohongshu') ||
            (p === 'TikTok' && detectedPlatform === 'tiktok')
              ? 'bg-pink-600 border-pink-500 text-white'
              : 'bg-pink-600/70 border-pink-500/70 text-white/70'
          }`}>{p}</div>
        ))}
        {['B站', '微博'].map((p) => (
          <div key={p} className="px-3 py-1 rounded-full text-xs font-medium border bg-gray-800 border-gray-700 text-gray-500">
            {p} <span className="opacity-60">即将支持</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <textarea
          className="w-full bg-transparent resize-none text-sm text-gray-200 placeholder-gray-600 outline-none leading-relaxed"
          rows={4}
          placeholder="粘贴抖音/小红书/TikTok 分享链接或文本..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <div className="flex justify-between items-center mt-3">
          <button onClick={() => { setInput(''); setResult(null); setError(''); setStep(-1); }} disabled={loading}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors">清空</button>
          <button onClick={handleParse} disabled={loading || !input.trim()}
            className="px-6 py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors">
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loading && step >= 0 && (
        <div className="mt-5 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-3">处理进度</p>
          <div className="space-y-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  i < step ? 'bg-green-600 text-white' : i === step ? 'bg-pink-600 text-white animate-pulse' : 'bg-gray-800 text-gray-600'
                }`}>{i < step ? '✓' : i + 1}</div>
                <span className={`text-sm ${i < step ? 'text-green-400' : i === step ? 'text-white' : 'text-gray-600'}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mt-5 bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-400">{error}</div>}

      {/* Result */}
      {result && (
        <div className="mt-5 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">ID: {result.videoId}</span>
            <span className="px-2 py-0.5 bg-green-900 text-green-400 text-xs rounded-full">已存入素材库</span>
          </div>
          {result.title && (
            <p className="text-sm text-gray-300 border-b border-gray-800 pb-3">
              {result.title}
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-pink-900 text-pink-400">
                {result.platform === 'tiktok' ? 'TikTok' : result.platform === 'douyin' ? '抖音' : '小红书'}
              </span>
            </p>
          )}
          <div className="rounded-xl overflow-hidden bg-black">
            <video src={result.ossUrl} controls playsInline className="w-full max-h-96 object-contain" preload="metadata" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5">OSS 永久地址</p>
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2.5">
              <span className="text-xs text-blue-400 flex-1 truncate">{result.ossUrl}</span>
              <button onClick={() => copy(result.ossUrl, 'oss')}
                className="flex-shrink-0 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                {copied === 'oss' ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-1 flex-wrap">
            <a href={result.ossUrl} download target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 bg-pink-600 hover:bg-pink-500 rounded-lg text-xs font-medium text-center transition-colors">
              下载视频
            </a>
            <a href="/publish" className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-medium text-center text-white transition-colors">
              去发布
            </a>
            <button onClick={() => { setResult(null); setError(''); setStep(-1); }}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors">
              重新解析
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
