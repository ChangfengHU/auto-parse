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
  'upload-complete': '后台上传',
};

type StageStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error' | 'skip';
type LoginStatus = 'unknown' | 'checking' | 'logged_in' | 'not_logged_in' | 'scanning';

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
  if (status === 'pending') return (
    <span className="w-5 h-5 rounded-full border border-gray-700 flex-shrink-0 block" />
  );
  if (status === 'running') return (
    <span className="w-5 h-5 rounded-full border-2 border-pink-500 border-t-transparent flex-shrink-0 animate-spin block" />
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

// ── 全屏截图弹窗 ─────────────────────────────────────────────
function ScreenshotModal({ url, label, onClose, isQr }: {
  url: string; label: string; onClose: () => void; isQr?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-medium text-white">{label}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
      </div>

      {/* 图片区 — 可滚动，点击关闭 */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={onClose}>
        {isQr ? (
          /* 二维码：尽量大，保持清晰 */
          <div className="bg-white rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <img src={url} alt={label}
              style={{ width: 'min(80vw, 80vh)', height: 'min(80vw, 80vh)' }}
              className="object-contain block"
            />
            <p className="text-center text-gray-500 text-xs mt-3">用抖音 App 扫描上方二维码 · 点击背景关闭</p>
          </div>
        ) : (
          /* 普通截图：自然尺寸，可滚动查看 */
          <img src={url} alt={label} onClick={e => e.stopPropagation()}
            className="max-w-none rounded-lg shadow-2xl"
            style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain' }}
          />
        )}
      </div>
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────
function PublishPageInner() {
  const searchParams = useSearchParams();
  const initOssUrl  = searchParams.get('ossUrl') ?? '';
  const initTitle   = searchParams.get('title') ?? '';
  const initTaskId  = searchParams.get('taskId') ?? '';

  // 表单
  const [ossUrl,      setOssUrl]      = useState(initOssUrl);
  const [title,       setTitle]       = useState(initTitle);
  const [description, setDescription] = useState('');
  const [tags,        setTags]        = useState('');

  // 素材库
  const [materials,     setMaterials]     = useState<Material[]>([]);
  const [showMaterials, setShowMaterials] = useState(false);

  // 登录状态
  const [loginStatus, setLoginStatus] = useState<LoginStatus>('unknown');
  const [loginQr,     setLoginQr]     = useState<string | null>(null);

  // 发布状态
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [stages,       setStages]       = useState<StageState[]>([]);
  const [logs,         setLogs]         = useState<string[]>([]);
  const [qrCode,       setQrCode]       = useState<string | null>(null);
  const [resultMsg,    setResultMsg]     = useState('');

  // taskId：state + ref（解决 SSE 回调闭包里读不到最新值的问题）
  const [taskId, setTaskId] = useState(initTaskId);
  const taskIdRef = useRef(initTaskId);
  const updateTaskId = useCallback((id: string) => {
    taskIdRef.current = id;
    setTaskId(id);
  }, []);

  // UI
  const [expandedStage,   setExpandedStage]   = useState<string | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; label: string; isQr?: boolean } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── 初始化加载 ──────────────────────────────────────────────

  // 加载素材库
  useEffect(() => {
    fetch('/api/materials').then(r => r.json()).then(setMaterials).catch(() => {});
  }, []);

  // 快速检测登录状态（只看 Cookie 文件，不开浏览器）
  useEffect(() => {
    fetch('/api/login')
      .then(r => r.json())
      .then(data => setLoginStatus(data.loggedIn ? 'logged_in' : 'not_logged_in'))
      .catch(() => {});
  }, []);

  // 自动滚动日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 带 taskId 参数进来时自动拉历史
  const loadTaskHistory = useCallback(async (tid: string) => {
    if (!tid) return;
    const res = await fetch(`/api/publish/status?taskId=${encodeURIComponent(tid)}`);
    if (!res.ok) return;
    const task = await res.json();
    if (Array.isArray(task.checkpoints) && task.checkpoints.length > 0) {
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
    if (initTaskId) {
      updateTaskId(initTaskId);
      loadTaskHistory(initTaskId);
    }
  }, [initTaskId, loadTaskHistory, updateTaskId]);

  // ── 发布中：每 5s 轮询截图 URL ──────────────────────────────
  useEffect(() => {
    if (publishState !== 'publishing') return;
    const timer = setInterval(async () => {
      const tid = taskIdRef.current;
      if (!tid) return;
      try {
        const res = await fetch(`/api/publish/status?taskId=${encodeURIComponent(tid)}`);
        if (!res.ok) return;
        const task = await res.json();
        if (!Array.isArray(task.checkpoints)) return;
        // 合并截图 URL（只补充还没有的）
        setStages(prev => prev.map(stage => {
          if (stage.screenshotUrl) return stage;
          const cp = task.checkpoints.find((c: Checkpoint) => c.name === stage.key);
          return cp?.screenshotUrl ? { ...stage, screenshotUrl: cp.screenshotUrl } : stage;
        }));
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [publishState]);

  // ── 初始化阶段列表 ───────────────────────────────────────────
  function initStages(): StageState[] {
    return STAGE_KEYS.map(k => ({
      key: k,
      label: STAGE_LABELS[k] ?? k,
      status: 'pending' as StageStatus,
      message: '',
    }));
  }

  // ── 根据日志文本更新阶段 ─────────────────────────────────────
  function applyLog(line: string, prev: StageState[]): StageState[] {
    const next = [...prev];
    const upd = (key: string, status: StageStatus, message?: string) => {
      const idx = next.findIndex(s => s.key === key);
      if (idx >= 0) next[idx] = { ...next[idx], status, message: message ?? next[idx].message };
    };
    const run = (key: string) => upd(key, 'running');

    if (line.includes('开始下载'))            run('download');
    else if (line.includes('视频下载完成'))    upd('download', 'ok', '视频下载完成');
    else if (line.includes('启动浏览器'))      run('login-check');
    else if (line.includes('上传页就绪')) {
      upd('login-check', 'ok', '已登录');
      upd('upload-page', 'ok', '上传页就绪');
    }
    else if (line.includes('检测到未登录'))    upd('login-check', 'warn', '需要扫码登录');
    else if (line.includes('扫码登录成功'))    upd('login-check', 'ok', '扫码登录成功');
    else if (line.includes('开始上传视频'))    run('video-inject');
    else if (line.includes('视频已注入'))      upd('video-inject', 'ok', '视频已注入上传框');
    else if (line.includes('上传中...'))       run('cp1-upload');
    else if (line.includes('Checkpoint 1'))   upd('cp1-upload', 'ok', 'URL 已跳转到发布表单');
    else if (line.includes('Checkpoint 2')) {
      run('cp2-title');
      if (line.includes('已填写')) upd('cp2-title', 'ok', line.split('→')[1]?.trim() ?? '');
    }
    else if (line.includes('Checkpoint 3')) {
      if (line.includes('⚠️')) upd('cp3-cover', 'skip', '使用默认封面');
      else upd('cp3-cover', 'ok', '封面已生成');
    }
    else if (line.includes('Checkpoint 4')) {
      run('cp4-detection');
      if (line.includes('无需')) upd('cp4-detection', 'skip', '无需检测');
    }
    else if (line.includes('检测完成') || line.includes('检测通过'))
      upd('cp4-detection', 'ok', '检测通过');
    else if (line.includes('点击发布按钮'))    run('pre-publish');
    else if (line.includes('已跳转到作品管理页')) {
      upd('pre-publish', 'ok', '发布按钮已点击');
      upd('redirect-manage', 'ok', '已跳转');
      run('upload-complete');
    }
    else if (line.includes('视频后台上传中')) {
      const pct = line.match(/(\d+)%/)?.[1];
      upd('upload-complete', 'running', `后台上传中 ${pct ?? ''}%`);
    }
    else if (line.includes('视频上传完成'))    upd('upload-complete', 'ok', '上传完成，抖音将自动发布');
    else if (line.includes('发布成功'))        upd('upload-complete', 'ok', '发布成功！');

    return next;
  }

  // ── 预检登录 / 扫码 ──────────────────────────────────────────
  async function handleCheckLogin() {
    if (loginStatus === 'scanning' || loginStatus === 'checking') return;
    setLoginStatus('scanning');
    setLoginQr(null);
    try {
      const res = await fetch('/api/login', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        alert(err.error ?? '登录检测失败');
        setLoginStatus('unknown');
        return;
      }
      if (!res.body) { setLoginStatus('unknown'); return; }
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
            if (type === 'qrcode') {
              setLoginQr(payload);
            } else if (type === 'done') {
              const data = JSON.parse(payload) as { loggedIn: boolean };
              setLoginStatus(data.loggedIn ? 'logged_in' : 'not_logged_in');
              if (data.loggedIn) setLoginQr(null);
            } else if (type === 'error') {
              setLoginStatus('unknown');
              setLoginQr(null);
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setLoginStatus('unknown');
    }
  }

  // ── 发布 ─────────────────────────────────────────────────────
  async function handlePublish() {
    if (!ossUrl.trim() || !title.trim()) return;
    setPublishState('publishing');
    setStages(initStages());
    setLogs([]);
    setQrCode(null);
    setResultMsg('');
    updateTaskId('');

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
              setStages(prev => applyLog(payload, prev));
              // 从日志中提取 taskId（格式：🆔 任务ID：2026-03-22T17-56-17-abc）
              const tidMatch = payload.match(/任务ID[：:]\s*(\S+)/);
              if (tidMatch) updateTaskId(tidMatch[1]);
            } else if (type === 'qrcode') {
              setQrCode(payload);
            } else if (type === 'done') {
              setQrCode(null);
              setPublishState('done');
              setResultMsg(payload);
              setLoginStatus('logged_in');
              // 从 done payload 中提取 taskId（格式：... [taskId: xxx]）
              const tidMatch = payload.match(/\[taskId:\s*([^\]]+)\]/);
              const finalTid = tidMatch?.[1]?.trim() || taskIdRef.current;
              if (finalTid) {
                updateTaskId(finalTid);
                // 延迟 1.5s 再拉，确保截图文件已落盘
                setTimeout(() => loadTaskHistory(finalTid), 1500);
              }
            } else if (type === 'error') {
              setPublishState('error');
              setResultMsg(payload);
              setStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
              // 失败时也拉一次历史，方便看截图
              if (taskIdRef.current) setTimeout(() => loadTaskHistory(taskIdRef.current), 1500);
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

  function toggleStage(key: string) {
    setExpandedStage(prev => prev === key ? null : key);
  }

  const isPublishing = publishState === 'publishing';
  const hasResult    = publishState === 'done' || publishState === 'error';

  const loginStatusLabel: Record<LoginStatus, string> = {
    unknown:      '未检测',
    checking:     '检测中...',
    logged_in:    '✓ 已登录',
    not_logged_in:'⚠ 未登录',
    scanning:     '扫码中...',
  };
  const loginStatusColor: Record<LoginStatus, string> = {
    unknown:      'text-gray-500',
    checking:     'text-gray-400',
    logged_in:    'text-green-400',
    not_logged_in:'text-yellow-400',
    scanning:     'text-pink-400',
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">视频发布</h1>
        <p className="mt-1 text-gray-400 text-sm">将视频发布到抖音账号，实时追踪每个发布阶段</p>
      </div>

      <div className="flex gap-6">
        {/* ── 左侧表单 ── */}
        <div className="flex-1 space-y-4">

          {/* 登录状态 */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium">登录状态</span>
                <span className={`text-xs font-semibold ${loginStatusColor[loginStatus]}`}>
                  {loginStatusLabel[loginStatus]}
                </span>
              </div>
              <button
                onClick={handleCheckLogin}
                disabled={loginStatus === 'scanning' || loginStatus === 'checking' || isPublishing}
                className="text-xs text-pink-400 hover:text-pink-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {loginStatus === 'not_logged_in' || loginStatus === 'unknown'
                  ? '扫码登录'
                  : loginStatus === 'logged_in' ? '重新检测' : '检测中...'}
              </button>
            </div>

            {/* 扫码二维码（预登录流程） */}
            {loginQr && (
              <div className="mt-4 flex flex-col items-center gap-3 pt-3 border-t border-gray-800">
                <p className="text-xs text-yellow-400 font-medium">请用抖音 App 扫描下方二维码</p>
                <img src={loginQr} alt="扫码登录" className="w-48 h-48 object-contain rounded-lg bg-white p-2" />
                <p className="text-xs text-yellow-600">扫码后自动保存 Cookie，约 3 分钟有效</p>
                <button
                  onClick={() => { setLoginQr(null); setLoginStatus('unknown'); }}
                  className="text-xs text-gray-600 hover:text-gray-400"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          {/* OSS URL */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium">视频地址 (OSS URL)</label>
              <button onClick={() => setShowMaterials(v => !v)}
                className="text-xs text-pink-400 hover:text-pink-300 transition-colors">
                从素材库选择
              </button>
            </div>

            {showMaterials && (
              <div className="mb-3 bg-gray-800 border border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {materials.length === 0
                  ? <p className="text-xs text-gray-500 p-3">素材库为空，先去解析视频</p>
                  : materials.map(m => (
                    <button key={m.id} onClick={() => selectMaterial(m)}
                      className="w-full text-left px-3 py-2.5 hover:bg-gray-700 border-b border-gray-700 last:border-0 transition-colors">
                      <p className="text-xs text-white truncate">{m.title || '（无标题）'}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{m.ossUrl}</p>
                    </button>
                  ))
                }
              </div>
            )}

            <input type="text" value={ossUrl} onChange={e => setOssUrl(e.target.value)}
              disabled={isPublishing}
              placeholder="https://articel.oss-cn-hangzhou.aliyuncs.com/..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Title */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">标题（最多 30 字）</label>
            <input type="text" maxLength={30} value={title} onChange={e => setTitle(e.target.value)}
              disabled={isPublishing} placeholder="输入发布标题..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
            <p className="text-right text-xs text-gray-600 mt-1">{title.length}/30</p>
          </div>

          {/* Description */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">正文（可选）</label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
              disabled={isPublishing} placeholder="输入正文内容..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none resize-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Tags */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium block mb-2">话题标签（逗号分隔，不含 #）</label>
            <input type="text" value={tags} onChange={e => setTags(e.target.value)}
              disabled={isPublishing} placeholder="例如：情感,治愈,日常"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors disabled:opacity-50"
            />
          </div>

          {/* 发布按钮 */}
          {!isPublishing && !hasResult && (
            <button onClick={handlePublish} disabled={!ossUrl.trim() || !title.trim()}
              className="w-full py-3 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors">
              开始发布
            </button>
          )}

          {/* 结果 */}
          {publishState === 'done' && (
            <div className="bg-green-950 border border-green-800 rounded-xl p-4 text-sm text-green-400">
              ✓ {resultMsg}
              {taskId && <p className="text-xs text-green-700 mt-1 font-mono">任务 ID: {taskId}</p>}
              <button onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); }}
                className="mt-3 text-xs text-green-600 hover:text-green-400 block">
                重新发布
              </button>
            </div>
          )}
          {publishState === 'error' && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-400">
              ✕ {resultMsg}
              <button onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); }}
                className="mt-3 text-xs text-red-600 hover:text-red-400 block">
                重试
              </button>
            </div>
          )}

          {/* 发布流程中的二维码 */}
          {qrCode && (
            <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-5 flex flex-col items-center gap-3">
              <p className="text-sm text-yellow-400 font-medium">Cookie 已过期，请用抖音 App 扫码登录</p>
              {/* 可直接扫描的二维码（尽量大） */}
              <button
                onClick={() => setScreenshotModal({ url: qrCode, label: '抖音扫码登录', isQr: true })}
                className="bg-white rounded-xl p-3 hover:shadow-yellow-500/30 hover:shadow-lg transition-shadow"
                title="点击全屏放大"
              >
                <img src={qrCode} alt="扫码登录"
                  style={{ width: 'min(56vw, 220px)', height: 'min(56vw, 220px)' }}
                  className="object-contain block"
                />
              </button>
              <p className="text-xs text-yellow-600">扫码后自动继续 · 约 3 分钟有效</p>
              <button
                onClick={() => setScreenshotModal({ url: qrCode, label: '抖音扫码登录', isQr: true })}
                className="text-xs text-yellow-500 hover:text-yellow-300 underline"
              >
                全屏放大（扫不到时点这里）
              </button>
            </div>
          )}

          {/* 实时日志 */}
          {(isPublishing || hasResult) && logs.length > 0 && (
            <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs text-gray-500">实时日志</span>
                {taskId && <span className="text-xs text-gray-600 font-mono">ID: {taskId}</span>}
              </div>
              <div className="h-40 overflow-y-auto p-3 font-mono text-xs text-green-400 space-y-0.5">
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
                {taskId && (
                  <p className="text-xs text-gray-600 font-mono mt-0.5 truncate" title={taskId}>
                    #{taskId}
                  </p>
                )}
              </div>
              <div className="p-3 space-y-0.5">
                {stages.map((stage, idx) => {
                  const isActive     = stage.status !== 'pending';
                  const hasShot      = !!stage.screenshotUrl;
                  const isExpanded   = expandedStage === stage.key;

                  return (
                    <div key={stage.key}>
                      {/* Stage row */}
                      <button
                        onClick={() => isActive && toggleStage(stage.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                          isActive ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                          <StageIcon status={stage.status} />
                          {idx < stages.length - 1 && (
                            <div className={`w-px mt-0.5 ${stage.status === 'ok' ? 'bg-green-700/60' : 'bg-gray-700/60'}`}
                              style={{ height: 12 }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-tight ${
                            stage.status === 'ok'    ? 'text-green-400' :
                            stage.status === 'running'? 'text-pink-400' :
                            stage.status === 'error' ? 'text-red-400' :
                            stage.status === 'warn' || stage.status === 'skip' ? 'text-yellow-400' :
                            'text-gray-600'
                          }`}>{stage.label}</p>
                          {stage.message && stage.status !== 'pending' && (
                            <p className="text-xs text-gray-600 truncate mt-0.5 leading-tight">{stage.message}</p>
                          )}
                        </div>
                        {isActive && (
                          <span className="text-gray-600 flex-shrink-0 text-xs">
                            {hasShot ? '📷' : isExpanded ? '▴' : '▾'}
                          </span>
                        )}
                      </button>

                      {/* 展开内容 */}
                      {isExpanded && isActive && (() => {
                        // login-check 且需要扫码时，优先展示干净的 QR code（可直接扫描）
                        const isLoginQr = stage.key === 'login-check' && stage.status === 'warn' && !!qrCode;
                        return (
                          <div className="mx-3 mb-1">
                            {isLoginQr ? (
                              <div className="flex flex-col items-center gap-2 py-2">
                                <p className="text-xs text-yellow-400">扫码登录（可直接扫）</p>
                                <button
                                  onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                                  className="bg-white rounded-lg p-2 hover:shadow-md transition-shadow"
                                  title="点击全屏放大"
                                >
                                  <img src={qrCode!} alt="QR Code"
                                    className="w-36 h-36 object-contain block"
                                  />
                                </button>
                                <button
                                  onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                                  className="text-xs text-yellow-600 hover:text-yellow-400 underline"
                                >
                                  全屏放大
                                </button>
                              </div>
                            ) : hasShot ? (
                              <button
                                onClick={() => setScreenshotModal({ url: stage.screenshotUrl!, label: stage.label })}
                                className="block w-full group"
                              >
                                <img
                                  src={stage.screenshotUrl}
                                  alt={stage.label}
                                  className="w-full rounded-lg border border-gray-700 group-hover:border-pink-600 object-contain max-h-44 transition-colors"
                                />
                                <p className="text-xs text-gray-600 text-center mt-1">点击放大</p>
                              </button>
                            ) : (
                              <div className="py-3 text-center text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg">
                                {stage.status === 'running' ? '⏳ 截图生成中...' : '暂无截图'}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 全屏截图弹窗 */}
      {screenshotModal && (
        <ScreenshotModal
          url={screenshotModal.url}
          label={screenshotModal.label}
          isQr={screenshotModal.isQr}
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
