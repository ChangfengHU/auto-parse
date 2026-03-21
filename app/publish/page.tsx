'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// ── 发布阶段定义 ─────────────────────────────────────────────
const STAGE_KEYS = [
  'download',
  'login-check',
  'upload-page',
  'video-inject',
  'cp1-upload',
  'cp2-title',
  'cp3-cover',
  'cp4-detection',
  'pre-publish',
  'redirect-manage',
  'upload-complete',
] as const;

const STAGE_LABELS: Record<string, string> = {
  'download':        '下载视频',
  'login-check':     '登录检测',
  'login':           '扫码登录',
  'upload-page':     '打开上传页',
  'video-inject':    '注入视频',
  'cp1-upload':      '上传完成',
  'cp2-title':       '填写标题',
  'cp3-cover':       '封面确认',
  'cp4-detection':   '内容检测',
  'pre-publish':     '点击发布',
  'redirect-manage': '跳转管理页',
  'upload-complete': '上传完成',
};

type StageStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error' | 'skip';

interface StageState {
  key: string;
  label: string;
  status: StageStatus;
  message: string;
  screenshotUrl?: string;
  timestamp?: string;
}

interface Checkpoint {
  name: string;
  status: string;
  message: string;
  timestamp: string;
  screenshotUrl?: string;
}

interface Material {
  id: string;
  platform: string;
  title: string;
  ossUrl: string;
  parsedAt: number;
}

// ── 阶段状态图标 ─────────────────────────────────────────────
function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'pending') return <span className="w-5 h-5 rounded-full border border-gray-700 flex-shrink-0" />;
  if (status === 'running') return (
    <span className="w-5 h-5 rounded-full border-2 border-pink-500 border-t-transparent flex-shrink-0 animate-spin" />
  );
  if (status === 'ok') return (
    <span className="w-5 h-5 rounded-full bg-green-600 flex-shrink-0 flex items-center justify-center text-white text-xs">✓</span>
  );
  if (status === 'warn' || status === 'skip') return (
    <span className="w-5 h-5 rounded-full bg-yellow-600 flex-shrink-0 flex items-center justify-center text-white text-xs">!</span>
  );
  if (status === 'error') return (
    <span className="w-5 h-5 rounded-full bg-red-600 flex-shrink-0 flex items-center justify-center text-white text-xs">✕</span>
  );
  return null;
}

// ── 截图详情弹窗 ─────────────────────────────────────────────
function ScreenshotModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-white">{label} — 截图</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <img src={url} alt={label} className="w-full rounded-lg border border-gray-700 object-contain max-h-[60vh]" />
      </div>
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────
function PublishPageInner() {
  const searchParams = useSearchParams();
  const initOssUrl = searchParams.get('ossUrl') ?? '';
  const initTitle = searchParams.get('title') ?? '';
  const initTaskId = searchParams.get('taskId') ?? '';

  // 表单
  const [ossUrl, setOssUrl] = useState(initOssUrl);
  const [title, setTitle] = useState(initTitle);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  // 素材库选择
  const [materials, setMaterials] = useState<Material[]>([]);
  const [showMaterials, setShowMaterials] = useState(false);

  // 发布状态
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [taskId, setTaskId] = useState(initTaskId);
  const [stages, setStages] = useState<StageState[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState('');

  // UI
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; label: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 加载素材库
  useEffect(() => {
    fetch('/api/materials').then(r => r.json()).then(setMaterials).catch(() => {});
  }, []);

  // 自动滚动日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 如果带 taskId 参数进来，自动拉取历史
  const loadTaskHistory = useCallback(async (tid: string) => {
    const res = await fetch(`/api/publish/status?taskId=${tid}`);
    if (!res.ok) return;
    const task = await res.json();
    if (task.checkpoints) {
      const stageList: StageState[] = task.checkpoints.map((cp: Checkpoint) => ({
        key: cp.name,
        label: STAGE_LABELS[cp.name] ?? cp.name,
        status: cp.status as StageStatus,
        message: cp.message,
        screenshotUrl: cp.screenshotUrl,
        timestamp: cp.timestamp,
      }));
      setStages(stageList);
    }
    setResultMsg(task.result?.message ?? '');
    setPublishState(task.status === 'success' ? 'done' : task.status === 'failed' ? 'error' : 'idle');
    if (task.latestQrCode) setQrCode(task.latestQrCode);
  }, []);

  useEffect(() => {
    if (initTaskId) loadTaskHistory(initTaskId);
  }, [initTaskId, loadTaskHistory]);

  // 初始化阶段列表
  function initStages(): StageState[] {
    return STAGE_KEYS.map(k => ({
      key: k,
      label: STAGE_LABELS[k] ?? k,
      status: 'pending' as StageStatus,
      message: '',
    }));
  }

  // 根据日志消息更新阶段
  function applyLog(log: string, prev: StageState[]): StageState[] {
    const next = [...prev];
    const update = (key: string, status: StageStatus, message?: string) => {
      const idx = next.findIndex(s => s.key === key);
      if (idx >= 0) next[idx] = { ...next[idx], status, message: message ?? next[idx].message };
    };
    const setRunning = (key: string) => update(key, 'running');

    if (log.includes('开始下载')) setRunning('download');
    else if (log.includes('视频下载完成')) update('download', 'ok', '视频下载完成');
    else if (log.includes('启动浏览器')) setRunning('login-check');
    else if (log.includes('上传页就绪')) {
      update('login-check', 'ok', '已登录'); update('upload-page', 'ok', '上传页就绪');
    }
    else if (log.includes('检测到未登录')) update('login-check', 'warn', '需要扫码登录');
    else if (log.includes('扫码登录成功')) update('login-check', 'ok', '扫码登录成功');
    else if (log.includes('开始上传视频')) setRunning('video-inject');
    else if (log.includes('视频已注入')) update('video-inject', 'ok', '视频已注入上传框');
    else if (log.includes('上传中...')) setRunning('cp1-upload');
    else if (log.includes('Checkpoint 1')) update('cp1-upload', 'ok', 'URL 已跳转到发布表单');
    else if (log.includes('Checkpoint 2')) { setRunning('cp2-title'); if (log.includes('已填写')) update('cp2-title', 'ok', log.split('→')[1]?.trim() ?? ''); }
    else if (log.includes('Checkpoint 3')) { if (log.includes('⚠️')) update('cp3-cover', 'skip', '使用默认封面'); else update('cp3-cover', 'ok', '封面确认'); }
    else if (log.includes('Checkpoint 4')) { setRunning('cp4-detection'); if (log.includes('无需')) update('cp4-detection', 'skip', '无需检测'); }
    else if (log.includes('检测完成') || log.includes('检测通过')) update('cp4-detection', 'ok', '检测通过');
    else if (log.includes('点击发布按钮')) { update('cp4-detection', s => s.status === 'running' ? 'ok' : s.status, ''); setRunning('pre-publish'); }
    else if (log.includes('已跳转到作品管理页')) { update('pre-publish', 'ok', '发布按钮已点击'); setRunning('redirect-manage'); update('redirect-manage', 'ok', '已跳转'); setRunning('upload-complete'); }
    else if (log.includes('视频后台上传中')) {
      const pct = log.match(/(\d+)%/)?.[1];
      update('upload-complete', 'running', `上传中 ${pct ?? ''}%`);
    }
    else if (log.includes('视频上传完成')) update('upload-complete', 'ok', '上传完成，抖音将自动发布');
    else if (log.includes('发布成功')) update('upload-complete', 'ok', '发布成功！');

    return next;
  }

  // 类型安全的辅助函数
  function applyLogHelper(log: string, prev: StageState[]): StageState[] {
    return applyLog(log, prev);
  }

  async function handlePublish() {
    if (!ossUrl.trim() || !title.trim()) return;
    setPublishState('publishing');
    setStages(initStages());
    setLogs([]);
    setQrCode(null);
    setResultMsg('');
    setTaskId('');

    const tagList = tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: ossUrl, title, description, tags: tagList }),
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
              setLogs(prev => [...prev, payload]);
              setStages(prev => applyLogHelper(payload, prev));
              // 从日志里提取 taskId
              const tidMatch = payload.match(/任务ID[：:]\s*(\S+)/);
              if (tidMatch) setTaskId(tidMatch[1]);
            } else if (type === 'qrcode') {
              setQrCode(payload);
            } else if (type === 'done') {
              setQrCode(null);
              setPublishState('done');
              setResultMsg(payload);
              // 拉取最新截图信息
              const tidMatch = payload.match(/taskId: (\S+)/);
              if (tidMatch) {
                setTaskId(tidMatch[1]);
                setTimeout(() => loadTaskHistory(tidMatch[1]), 1000);
              }
            } else if (type === 'error') {
              setPublishState('error');
              setResultMsg(payload);
              setStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setPublishState('error');
      setResultMsg(e instanceof Error ? e.message : '网络错误');
    }
  }

  function selectMaterial(m: Material) {
    setOssUrl(m.ossUrl);
    setTitle(m.title);
    setShowMaterials(false);
  }

  // 点击 stage 展开/收起
  function toggleStage(key: string) {
    setExpandedStage(prev => prev === key ? null : key);
  }

  const isPublishing = publishState === 'publishing';
  const hasResult = publishState === 'done' || publishState === 'error';

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">视频发布</h1>
        <p className="mt-1 text-gray-400 text-sm">将视频发布到抖音账号，实时追踪每个发布阶段</p>
      </div>

      <div className="flex gap-6">
        {/* ── 左侧表单 ── */}
        <div className="flex-1 space-y-4">
          {/* OSS URL */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium">视频地址 (OSS URL)</label>
              <button onClick={() => setShowMaterials(v => !v)}
                className="text-xs text-pink-400 hover:text-pink-300 transition-colors">
                从素材库选择
              </button>
            </div>

            {/* 素材库下拉 */}
            {showMaterials && (
              <div className="mb-3 bg-gray-800 border border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {materials.length === 0 && <p className="text-xs text-gray-500 p-3">素材库为空，先去解析视频</p>}
                {materials.map(m => (
                  <button key={m.id} onClick={() => selectMaterial(m)}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-700 border-b border-gray-700 last:border-0 transition-colors">
                    <p className="text-xs text-white truncate">{m.title || '（无标题）'}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{m.ossUrl}</p>
                  </button>
                ))}
              </div>
            )}

            <input
              type="text"
              value={ossUrl}
              onChange={e => setOssUrl(e.target.value)}
              disabled={isPublishing}
              placeholder="https://articel.oss-cn-hangzhou.aliyuncs.com/..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Title */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">标题（最多 30 字）</label>
            <input
              type="text"
              maxLength={30}
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isPublishing}
              placeholder="输入发布标题..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
            <p className="text-right text-xs text-gray-600 mt-1">{title.length}/30</p>
          </div>

          {/* Description */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">正文（可选）</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isPublishing}
              placeholder="输入正文内容..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none resize-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Tags */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">话题标签（逗号分隔，不含 #）</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              disabled={isPublishing}
              placeholder="例如：情感,治愈,日常"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Publish button */}
          {!isPublishing && !hasResult && (
            <button onClick={handlePublish} disabled={!ossUrl.trim() || !title.trim()}
              className="w-full py-3 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors">
              开始发布
            </button>
          )}

          {/* Result */}
          {publishState === 'done' && (
            <div className="bg-green-950 border border-green-800 rounded-xl p-4 text-sm text-green-400">
              ✓ {resultMsg}
              {taskId && <p className="text-xs text-green-700 mt-1">任务ID: {taskId}</p>}
              <button onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); }}
                className="mt-3 text-xs text-green-600 hover:text-green-400 block">重新发布</button>
            </div>
          )}
          {publishState === 'error' && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-400">
              ✕ {resultMsg}
              <button onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); }}
                className="mt-3 text-xs text-red-600 hover:text-red-400 block">重试</button>
            </div>
          )}

          {/* QR Code */}
          {qrCode && (
            <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-4 flex flex-col items-center gap-3">
              <p className="text-xs text-yellow-400 font-medium">Cookie 已过期，请用抖音 App 扫码登录</p>
              <img src={qrCode} alt="扫码登录" className="w-44 h-44 object-contain rounded-lg bg-white p-2" />
              <p className="text-xs text-yellow-600">扫码后自动继续，约 3 分钟有效</p>
            </div>
          )}

          {/* Logs */}
          {(isPublishing || hasResult) && logs.length > 0 && (
            <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs text-gray-500">实时日志</span>
                {taskId && <span className="text-xs text-gray-600">ID: {taskId}</span>}
              </div>
              <div className="h-36 overflow-y-auto p-3 font-mono text-xs text-green-400 space-y-0.5">
                {logs.map((l, i) => <div key={i}>{l}</div>)}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* ── 右侧阶段进度 ── */}
        {(isPublishing || stages.length > 0) && (
          <div className="w-72 flex-shrink-0">
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden sticky top-6">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-medium text-gray-300">发布进度</p>
              </div>
              <div className="p-3 space-y-1">
                {stages.map((stage, idx) => (
                  <div key={stage.key}>
                    {/* Stage row */}
                    <button
                      onClick={() => toggleStage(stage.key)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        stage.screenshotUrl ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      {/* Connector line */}
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <StageIcon status={stage.status} />
                        {idx < stages.length - 1 && (
                          <div className={`w-px h-4 ${stage.status === 'ok' ? 'bg-green-700' : 'bg-gray-700'}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${
                          stage.status === 'ok' ? 'text-green-400' :
                          stage.status === 'running' ? 'text-pink-400' :
                          stage.status === 'error' ? 'text-red-400' :
                          stage.status === 'warn' || stage.status === 'skip' ? 'text-yellow-400' :
                          'text-gray-600'
                        }`}>{stage.label}</p>
                        {stage.message && stage.status !== 'pending' && (
                          <p className="text-xs text-gray-600 truncate mt-0.5">{stage.message}</p>
                        )}
                      </div>
                      {stage.screenshotUrl && (
                        <span className="text-xs text-gray-600 flex-shrink-0">📷</span>
                      )}
                    </button>

                    {/* Expanded screenshot */}
                    {expandedStage === stage.key && stage.screenshotUrl && (
                      <div className="mx-3 mb-2">
                        <button
                          onClick={() => setScreenshotModal({ url: stage.screenshotUrl!, label: stage.label })}
                          className="block w-full"
                        >
                          <img
                            src={stage.screenshotUrl}
                            alt={stage.label}
                            className="w-full rounded-lg border border-gray-700 object-contain max-h-40 hover:border-pink-600 transition-colors"
                          />
                          <p className="text-xs text-gray-600 text-center mt-1">点击放大</p>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Screenshot modal */}
      {screenshotModal && (
        <ScreenshotModal
          url={screenshotModal.url}
          label={screenshotModal.label}
          onClose={() => setScreenshotModal(null)}
        />
      )}
    </div>
  );
}

export default function PublishPage() {
  return (
    <Suspense>
      <PublishPageInner />
    </Suspense>
  );
}
