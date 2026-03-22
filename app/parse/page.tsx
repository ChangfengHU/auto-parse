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
        <h1 className="text-2xl font-bold text-foreground">视频解析</h1>
        <p className="mt-1 text-muted-foreground text-sm">支持抖音、TikTok、小红书，自动去水印并上传至 OSS</p>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['抖音', '小红书', 'TikTok'] as const).map((p) => (
          <div key={p} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
            (p === '抖音' && detectedPlatform === 'douyin') ||
            (p === '小红书' && detectedPlatform === 'xiaohongshu') ||
            (p === 'TikTok' && detectedPlatform === 'tiktok')
              ? 'bg-primary border-primary text-white shadow-sm shadow-primary/20'
              : 'bg-primary/20 border-primary/30 text-primary'
          }`}>{p}</div>
        ))}
        {['B站', '微博'].map((p) => (
          <div key={p} className="px-3 py-1 rounded-full text-xs font-medium border bg-muted border-border text-muted-foreground/60">
            {p} <span className="opacity-60 text-[10px]">即将支持</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm focus-within:ring-1 focus-within:ring-primary/20 transition-all">
        <textarea
          className="w-full bg-transparent resize-none text-sm text-foreground placeholder-muted-foreground outline-none leading-relaxed"
          rows={4}
          placeholder="粘贴抖音/小红书/TikTok 分享链接或文本..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <div className="flex justify-between items-center mt-3">
          <button onClick={() => { setInput(''); setResult(null); setError(''); setStep(-1); }} disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">清空</button>
          <button onClick={handleParse} disabled={loading || !input.trim()}
            className="px-6 py-2 bg-primary text-white hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-all shadow-lg shadow-primary/20">
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loading && step >= 0 && (
        <div className="mt-5 bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-3">处理进度</p>
          <div className="space-y-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  i < step ? 'bg-green-500 text-white' : i === step ? 'bg-primary text-white animate-pulse' : 'bg-muted text-muted-foreground/60'
                }`}>{i < step ? '✓' : i + 1}</div>
                <span className={`text-sm ${i < step ? 'text-green-500' : i === step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mt-5 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-500">{error}</div>}

      {/* Result */}
      {result && (
        <div className="mt-5 bg-card border border-border rounded-xl p-4 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">ID: {result.videoId}</span>
            <span className="px-2 py-0.5 bg-green-500/10 text-green-500 text-[10px] font-semibold rounded-full uppercase tracking-wider">素材库收录</span>
          </div>
          {result.title && (
            <p className="text-sm text-foreground font-medium border-b border-border pb-3 flex items-center gap-2">
              <span className="truncate">{result.title}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary flex-shrink-0">
                {result.platform === 'tiktok' ? 'TikTok' : result.platform === 'douyin' ? '抖音' : '小红书'}
              </span>
            </p>
          )}
          <div className="rounded-xl overflow-hidden bg-black">
            <video src={result.ossUrl} controls playsInline className="w-full max-h-96 object-contain" preload="metadata" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-1.5">OSS 永久地址</p>
            <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
              <span className="text-xs text-blue-500 flex-1 truncate font-mono">{result.ossUrl}</span>
              <button onClick={() => copy(result.ossUrl, 'oss')}
                className="flex-shrink-0 px-2.5 py-1 bg-background border border-border hover:bg-muted rounded text-xs transition-colors shadow-sm">
                {copied === 'oss' ? '✓ 已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-1 flex-wrap">
            <a href={result.ossUrl} download target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg text-xs font-semibold text-center transition-all shadow-md shadow-primary/10">
              下载视频
            </a>
            <a href="/publish" className="flex-1 py-2 bg-muted border border-border hover:bg-border/50 rounded-lg text-xs font-semibold text-center text-foreground transition-all">
              去发布
            </a>
            <button onClick={() => { setResult(null); setError(''); setStep(-1); }}
              className="flex-1 py-2 text-muted-foreground hover:text-foreground text-xs transition-colors">
              重新解析
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
