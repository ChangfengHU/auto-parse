'use client';

import { useState } from 'react';

export default function MetaAIPage() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([
    '等待输入提示词...',
    '提示：视频渲染时间受短片时长影响，通常需要等待 1 到 4 分钟。',
  ]);

  const handleEnhancePrompt = async () => {
    if (!prompt.trim()) return;
    
    setEnhancing(true);
    setLogs((prev) => [...prev, '✨ 正在请求 Gemini 智能扩写提示词...']);
    try {
      const res = await fetch('/api/metaai/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '扩写失败');
      }
      setPrompt(data.enhanced);
      setLogs((prev) => [...prev, '✅ 扩写完毕，已替换为专业级英文 Prompt！']);
    } catch (err: any) {
      setLogs((prev) => [...prev, `❌ 扩写发送失败: ${err.message}`]);
    } finally {
      setEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('提示词不能为空');
      return;
    }

    setLoading(true);
    setError('');
    setVideos([]);
    setLogs((prev) => [...prev, '\n🚀 开始请求 Node API...等待 AdsPower 浏览器被唤出']);

    try {
      const res = await fetch('/api/metaai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || '接口请求失败');
      }

      if (data.urls && data.urls.length > 0) {
        setVideos(data.urls);
        setLogs((prev) => [...prev, `🎉 成功！已获取 ${data.urls.length} 个视频并转存至 OSS。`]);
      } else {
        throw new Error('未返回任何视频 URL');
      }
    } catch (err: any) {
      setError(err.message || '系统错误');
      setLogs((prev) => [...prev, `❌ 发生错误: ${err.message}`]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Meta AI 创作台</h1>
        <p className="text-muted-foreground mt-2">
          基于 AdsPower 底层驱动，全自动绕过地区限制并将生成的优质视频提取至云端。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧控制区 */}
        <div className="lg:col-span-1 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">输入生成提示词 (Prompt)</label>
              <button
                onClick={handleEnhancePrompt}
                disabled={enhancing || !prompt.trim() || loading}
                className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {enhancing ? '✨ 思考中...' : '✨ AI 智能扩写'}
              </button>
            </div>
            <textarea
              className="w-full h-40 p-3 bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm resize-none"
              placeholder="例如: 小猫在睡觉，小狗在生气..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading || enhancing}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className={`w-full py-3 rounded-lg font-medium transition-all ${
              loading 
                ? 'bg-primary/50 text-primary-foreground cursor-not-allowed' 
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                正在排队渲染中 (长达几分钟)...
              </span>
            ) : (
              '✨ 立即生成视频'
            )}
          </button>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-4 overflow-hidden h-64 flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 shrink-0">运行日志</h3>
            <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs text-muted-foreground">
              {logs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap">{log}</div>
              ))}
              {loading && <div className="animate-pulse">_ _ _</div>}
            </div>
          </div>
        </div>

        {/* 右侧结果区 */}
        <div className="lg:col-span-2">
          {videos.length === 0 ? (
            <div className="w-full h-full min-h-[500px] border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center bg-muted/20 text-muted-foreground">
              <span className="text-4xl mb-4 opacity-50">🎬</span>
              {loading ? <p>正在拼命利用 Meta AI 算力挤占生成中...</p> : <p>生成的结果将在此处实时展示</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {videos.map((url, i) => (
                <div key={i} className="rounded-xl overflow-hidden bg-black aspect-[10/16] shadow-md border border-border group relative">
                  <video 
                    src={url} 
                    controls 
                    autoPlay 
                    loop 
                    muted 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a href={url} target="_blank" rel="noreferrer" className="bg-background/80 hover:bg-background text-foreground backdrop-blur-sm p-1.5 rounded-md text-xs font-medium border border-border/50 shadow-sm flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      新标签页打开
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
