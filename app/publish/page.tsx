'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// ── 素材库抽屉 ────────────────────────────────────────────────
const PER_PAGE = 8;

function MaterialsDrawer({
  open, materials, onSelect, onClose,
}: {
  open: boolean;
  materials: Array<{ id: string; platform: string; title: string; ossUrl: string; parsedAt: number }>;
  onSelect: (ossUrl: string, title: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch]   = useState('');
  const [page,   setPage]     = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  // 搜索重置分页
  useEffect(() => setPage(0), [search]);
  // 关闭时重置搜索
  useEffect(() => { if (!open) { setSearch(''); setPage(0); setPreview(null); } }, [open]);

  const filtered   = materials.filter(m => !search || m.title.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paged      = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* 抽屉主体 */}
      <div
        className={`fixed right-0 top-0 h-full z-50 bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 400 }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <span className="text-sm font-semibold text-white">素材库</span>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{filtered.length} 个素材</span>
            <button onClick={onClose} className="ml-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg text-xl transition-colors">×</button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索标题..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">✕</button>
            )}
          </div>
        </div>

        {/* 视频预览（悬停时展开） */}
        {preview && (
          <div className="px-4 pt-3 flex-shrink-0">
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
              <video key={preview} src={preview} autoPlay muted loop playsInline
                className="w-full h-full object-contain" />
              <button onClick={() => setPreview(null)}
                className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full text-white text-xs flex items-center justify-center hover:bg-black">✕</button>
            </div>
          </div>
        )}

        {/* 素材网格 */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {paged.length === 0 ? (
            <div className="text-center text-gray-600 text-sm mt-16">
              {search ? `未找到含"${search}"的素材` : '素材库为空，先去解析视频'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {paged.map(m => (
                <div key={m.id} className="group bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-pink-500 transition-all duration-200 cursor-pointer"
                  onClick={() => { onSelect(m.ossUrl, m.title); onClose(); }}
                >
                  {/* 视频缩略图 */}
                  <div className="aspect-video bg-gray-900 relative overflow-hidden">
                    <video
                      src={m.ossUrl + '#t=1'}
                      preload="metadata"
                      muted playsInline
                      className="w-full h-full object-cover"
                      onMouseEnter={e => { (e.currentTarget as HTMLVideoElement).play(); setPreview(m.ossUrl); }}
                      onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 1; }}
                    />
                    {/* 平台徽章 */}
                    <span className="absolute top-1.5 left-1.5 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded-md leading-tight">
                      {m.platform === 'douyin' ? '抖音' : m.platform === 'xiaohongshu' ? '小红书' : m.platform}
                    </span>
                    {/* 播放提示 */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <span className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white text-sm">▶</span>
                    </div>
                  </div>
                  {/* 标题 + 日期 */}
                  <div className="px-2.5 py-2">
                    <p className="text-xs text-gray-100 line-clamp-2 leading-tight font-medium">{m.title || '（无标题）'}</p>
                    <p className="text-xs text-gray-600 mt-1">{new Date(m.parsedAt).toLocaleDateString('zh-CN')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0 flex items-center justify-between">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:bg-transparent rounded-lg transition-colors">
              ← 上一页
            </button>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = totalPages <= 7 ? i : i === 0 ? 0 : i === 6 ? totalPages - 1 : page - 2 + i;
                const isActive = p === page;
                return (
                  <button key={i} onClick={() => setPage(Math.max(0, Math.min(totalPages - 1, p)))}
                    className={`w-6 h-6 rounded text-xs transition-colors ${isActive ? 'bg-pink-600 text-white' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}>
                    {Math.max(0, Math.min(totalPages - 1, p)) + 1}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="text-xs text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:bg-transparent rounded-lg transition-colors">
              下一页 →
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── 发布阶段定义 ─────────────────────────────────────────────
const STAGE_KEYS = [
  'download', 'login-check', 'upload-page', 'video-inject',
  'cp1-upload', 'cp2-title', 'cp3-cover', 'cp4-detection',
  'pre-publish', 'redirect-manage', 'upload-complete',
] as const;

const STAGE_LABELS: Record<string, string> = {
  'download': '下载视频', 'login-check': '登录检测', 'login': '扫码登录',
  'upload-page': '打开上传页', 'video-inject': '注入视频',
  'cp1-upload': '上传完成', 'cp2-title': '填写标题', 'cp3-cover': '封面确认',
  'cp4-detection': '内容检测', 'pre-publish': '点击发布',
  'redirect-manage': '跳转管理页', 'upload-complete': '后台上传',
};

type StageStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error' | 'skip';
type LoginStatus = 'unknown' | 'checking' | 'logged_in' | 'not_logged_in' | 'scanning';

interface StageState {
  key: string; label: string; status: StageStatus;
  message: string; screenshotUrl?: string; timestamp?: string;
}
interface Checkpoint {
  name: string; status: string; message: string;
  timestamp: string; screenshotUrl?: string;
}
interface Material { id: string; platform: string; title: string; ossUrl: string; parsedAt: number; }

// ── 阶段状态图标 ─────────────────────────────────────────────
function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'pending')  return <span className="w-5 h-5 rounded-full border border-gray-700 flex-shrink-0 block" />;
  if (status === 'running')  return <span className="w-5 h-5 rounded-full border-2 border-pink-500 border-t-transparent flex-shrink-0 animate-spin block" />;
  if (status === 'ok')       return <span className="w-5 h-5 rounded-full bg-green-600 flex-shrink-0 flex items-center justify-center text-white text-xs">✓</span>;
  if (status === 'warn' || status === 'skip') return <span className="w-5 h-5 rounded-full bg-yellow-600 flex-shrink-0 flex items-center justify-center text-white text-xs">!</span>;
  if (status === 'error')    return <span className="w-5 h-5 rounded-full bg-red-600 flex-shrink-0 flex items-center justify-center text-white text-xs">✕</span>;
  return null;
}

// ── 全屏截图弹窗 ─────────────────────────────────────────────
function ScreenshotModal({ url, label, onClose, isQr }: {
  url: string; label: string; onClose: () => void; isQr?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-medium text-white">{label}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={onClose}>
        {isQr ? (
          <div className="bg-white rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <img src={url} alt={label}
              style={{ width: 'min(80vw, 80vh)', height: 'min(80vw, 80vh)' }}
              className="object-contain block"
            />
            <p className="text-center text-gray-500 text-xs mt-3">用抖音 App 扫描上方二维码 · 点击背景关闭</p>
          </div>
        ) : (
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

  const [ossUrl,       setOssUrl]       = useState(initOssUrl);
  const [title,        setTitle]        = useState(initTitle);
  const [description,  setDescription]  = useState('');
  const [tags,         setTags]         = useState('');
  const [materials,    setMaterials]    = useState<Material[]>([]);
  const [showDrawer,   setShowDrawer]   = useState(false);

  const [loginStatus,  setLoginStatus]  = useState<LoginStatus>('unknown');
  const [loginQr,      setLoginQr]      = useState<string | null>(null);

  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [stages,       setStages]       = useState<StageState[]>([]);
  const [logs,         setLogs]         = useState<string[]>([]);
  const [qrCode,       setQrCode]       = useState<string | null>(null);
  const [resultMsg,    setResultMsg]    = useState('');

  const [taskId,       setTaskId]       = useState(initTaskId);
  const taskIdRef = useRef(initTaskId);
  const updateTaskId = useCallback((id: string) => { taskIdRef.current = id; setTaskId(id); }, []);

  const [expandedStage,   setExpandedStage]   = useState<string | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; label: string; isQr?: boolean } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── 初始化 ─────────────────────────────────────────────────
  useEffect(() => { fetch('/api/materials').then(r => r.json()).then(setMaterials).catch(() => {}); }, []);
  useEffect(() => {
    fetch('/api/login').then(r => r.json())
      .then(d => setLoginStatus(d.loggedIn ? 'logged_in' : 'not_logged_in')).catch(() => {});
  }, []);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const loadTaskHistory = useCallback(async (tid: string) => {
    if (!tid) return;
    const res = await fetch(`/api/publish/status?taskId=${encodeURIComponent(tid)}`);
    if (!res.ok) return;
    const task = await res.json();
    if (Array.isArray(task.checkpoints) && task.checkpoints.length > 0) {
      setStages(task.checkpoints.map((cp: Checkpoint) => ({
        key: cp.name, label: STAGE_LABELS[cp.name] ?? cp.name,
        status: cp.status as StageStatus, message: cp.message,
        screenshotUrl: cp.screenshotUrl, timestamp: cp.timestamp,
      })));
    }
    setResultMsg(task.result?.message ?? '');
    setPublishState(task.status === 'success' ? 'done' : task.status === 'failed' ? 'error' : 'idle');
    if (task.latestQrCode) setQrCode(task.latestQrCode);
  }, []);

  useEffect(() => {
    if (initTaskId) { updateTaskId(initTaskId); loadTaskHistory(initTaskId); }
  }, [initTaskId, loadTaskHistory, updateTaskId]);

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
        setStages(prev => prev.map(stage => {
          if (stage.screenshotUrl) return stage;
          const cp = task.checkpoints.find((c: Checkpoint) => c.name === stage.key);
          return cp?.screenshotUrl ? { ...stage, screenshotUrl: cp.screenshotUrl } : stage;
        }));
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [publishState]);

  function initStages(): StageState[] {
    return STAGE_KEYS.map(k => ({ key: k, label: STAGE_LABELS[k] ?? k, status: 'pending' as StageStatus, message: '' }));
  }

  function applyLog(line: string, prev: StageState[]): StageState[] {
    const next = [...prev];
    const upd = (key: string, status: StageStatus, message?: string) => {
      const idx = next.findIndex(s => s.key === key);
      if (idx >= 0) next[idx] = { ...next[idx], status, message: message ?? next[idx].message };
    };
    const run = (key: string) => upd(key, 'running');
    if      (line.includes('开始下载'))           run('download');
    else if (line.includes('视频下载完成'))        upd('download', 'ok', '视频下载完成');
    else if (line.includes('启动浏览器'))          run('login-check');
    else if (line.includes('上传页就绪'))          { upd('login-check', 'ok', '已登录'); upd('upload-page', 'ok', '上传页就绪'); }
    else if (line.includes('检测到未登录'))        upd('login-check', 'warn', '需要扫码登录');
    else if (line.includes('扫码登录成功'))        upd('login-check', 'ok', '扫码登录成功');
    else if (line.includes('开始上传视频'))        run('video-inject');
    else if (line.includes('视频已注入'))          upd('video-inject', 'ok', '视频已注入上传框');
    else if (line.includes('上传中...'))           run('cp1-upload');
    else if (line.includes('Checkpoint 1'))       upd('cp1-upload', 'ok', 'URL 已跳转到发布表单');
    else if (line.includes('Checkpoint 2'))       { run('cp2-title'); if (line.includes('已填写')) upd('cp2-title', 'ok', line.split('→')[1]?.trim() ?? ''); }
    else if (line.includes('Checkpoint 3'))       { if (line.includes('⚠️')) upd('cp3-cover', 'skip', '使用默认封面'); else upd('cp3-cover', 'ok', '封面已生成'); }
    else if (line.includes('Checkpoint 4'))       { run('cp4-detection'); if (line.includes('无需')) upd('cp4-detection', 'skip', '无需检测'); }
    else if (line.includes('检测完成') || line.includes('检测通过')) upd('cp4-detection', 'ok', '检测通过');
    else if (line.includes('点击发布按钮'))        run('pre-publish');
    else if (line.includes('已跳转到作品管理页')) { upd('pre-publish', 'ok', '发布按钮已点击'); upd('redirect-manage', 'ok', '已跳转'); run('upload-complete'); }
    else if (line.includes('视频后台上传中'))     { const pct = line.match(/(\d+)%/)?.[1]; upd('upload-complete', 'running', `后台上传中 ${pct ?? ''}%`); }
    else if (line.includes('视频上传完成'))        upd('upload-complete', 'ok', '上传完成，抖音将自动发布');
    else if (line.includes('发布成功'))            upd('upload-complete', 'ok', '发布成功！');
    return next;
  }

  async function handleCheckLogin() {
    if (loginStatus === 'scanning' || loginStatus === 'checking') return;
    setLoginStatus('scanning'); setLoginQr(null);
    try {
      const res = await fetch('/api/login', { method: 'POST' });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; alert(e.error ?? '失败'); setLoginStatus('unknown'); return; }
      if (!res.body) { setLoginStatus('unknown'); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const { type, payload } = JSON.parse(line.slice(6)) as { type: string; payload: string };
            if (type === 'qrcode') setLoginQr(payload);
            else if (type === 'done') { const d = JSON.parse(payload) as { loggedIn: boolean }; setLoginStatus(d.loggedIn ? 'logged_in' : 'not_logged_in'); if (d.loggedIn) setLoginQr(null); }
            else if (type === 'error') { setLoginStatus('unknown'); setLoginQr(null); }
          } catch { /* ignore */ }
        }
      }
    } catch { setLoginStatus('unknown'); }
  }

  async function handlePublish() {
    if (!ossUrl.trim() || !title.trim()) return;
    setPublishState('publishing'); setStages(initStages()); setLogs([]); setQrCode(null); setResultMsg(''); updateTaskId('');
    const tagList = tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: ossUrl, title, description, tags: tagList }),
      });
      if (!res.body) throw new Error('不支持流式响应');
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const { type, payload } = JSON.parse(line.slice(6)) as { type: string; payload: string };
            if (type === 'log') {
              setLogs(prev => [...prev, payload]);
              setStages(prev => applyLog(payload, prev));
              const m = payload.match(/任务ID[：:]\s*(\S+)/); if (m) updateTaskId(m[1]);
              if (payload.includes('扫码登录成功')) setQrCode(null);
            } else if (type === 'qrcode') {
              setQrCode(payload);
            } else if (type === 'done') {
              setQrCode(null); setPublishState('done'); setResultMsg(payload); setLoginStatus('logged_in');
              const m = payload.match(/\[taskId:\s*([^\]]+)\]/);
              const finalTid = m?.[1]?.trim() || taskIdRef.current;
              if (finalTid) { updateTaskId(finalTid); setTimeout(() => loadTaskHistory(finalTid), 1500); }
            } else if (type === 'error') {
              setPublishState('error'); setResultMsg(payload);
              setStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
              if (taskIdRef.current) setTimeout(() => loadTaskHistory(taskIdRef.current), 1500);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) { setPublishState('error'); setResultMsg(e instanceof Error ? e.message : '网络错误'); }
  }

  function selectMaterial(url: string, t: string) { setOssUrl(url); setTitle(t); setShowDrawer(false); }
  function toggleStage(key: string) { setExpandedStage(prev => prev === key ? null : key); }

  const isPublishing = publishState === 'publishing';
  const hasResult    = publishState === 'done' || publishState === 'error';
  const isMonitor    = isPublishing || hasResult; // 监控布局

  const loginStatusLabel: Record<LoginStatus, string> = {
    unknown: '未检测', checking: '检测中...', logged_in: '✓ 已登录', not_logged_in: '⚠ 未登录', scanning: '扫码中...',
  };
  const loginStatusColor: Record<LoginStatus, string> = {
    unknown: 'text-gray-500', checking: 'text-gray-400', logged_in: 'text-green-400', not_logged_in: 'text-yellow-400', scanning: 'text-pink-400',
  };

  // ── 阶段面板内容（复用于两种布局） ──────────────────────────
  const StagePanel = () => (
    <>
      {stages.map((stage, idx) => {
        const isActive   = stage.status !== 'pending';
        const hasShot    = !!stage.screenshotUrl;
        const isExpanded = expandedStage === stage.key;
        const isLoginQr  = stage.key === 'login-check' && stage.status === 'warn' && !!qrCode;
        return (
          <div key={stage.key}>
            <button
              onClick={() => isActive && toggleStage(stage.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                <StageIcon status={stage.status} />
                {idx < stages.length - 1 && (
                  <div className={`w-px mt-0.5 ${stage.status === 'ok' ? 'bg-green-700/60' : 'bg-gray-700/60'}`} style={{ height: 12 }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-tight ${
                  stage.status === 'ok'    ? 'text-green-400' : stage.status === 'running' ? 'text-pink-400' :
                  stage.status === 'error' ? 'text-red-400'   : stage.status === 'warn' || stage.status === 'skip' ? 'text-yellow-400' : 'text-gray-600'
                }`}>{stage.label}</p>
                {stage.message && stage.status !== 'pending' && (
                  <p className="text-xs text-gray-600 truncate mt-0.5 leading-tight">{stage.message}</p>
                )}
              </div>
              {isActive && <span className="text-gray-600 flex-shrink-0 text-xs">{isLoginQr || hasShot ? '📷' : isExpanded ? '▴' : '▾'}</span>}
            </button>

            {isExpanded && isActive && (
              <div className="mx-3 mb-1">
                {isLoginQr ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <p className="text-xs text-yellow-400">扫码登录（可直接扫）</p>
                    <button onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                      className="bg-white rounded-lg p-2 hover:shadow-md transition-shadow">
                      <img src={qrCode!} alt="QR Code" className="w-36 h-36 object-contain block" />
                    </button>
                    <button onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                      className="text-xs text-yellow-600 hover:text-yellow-400 underline">全屏放大</button>
                  </div>
                ) : hasShot ? (
                  <button onClick={() => setScreenshotModal({ url: stage.screenshotUrl!, label: stage.label })} className="block w-full group">
                    <img src={stage.screenshotUrl} alt={stage.label}
                      className="w-full rounded-lg border border-gray-700 group-hover:border-pink-600 object-contain max-h-44 transition-colors" />
                    <p className="text-xs text-gray-600 text-center mt-1">点击放大</p>
                  </button>
                ) : (
                  <div className="py-3 text-center text-xs text-gray-600 border border-dashed border-gray-700 rounded-lg">
                    {stage.status === 'running' ? '⏳ 截图生成中...' : '暂无截图'}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // ══════════════════════════════════════════════════════════
  //  监控布局（发布中 / 完成 / 失败）
  //  日志 + 阶段进度并排，各自独立滚动，占满视口高度
  // ══════════════════════════════════════════════════════════
  if (isMonitor) {
    return (
      <div className="flex flex-col h-screen px-4 pt-4 pb-2 max-w-6xl mx-auto">

        {/* 顶栏 */}
        <div className="flex items-center gap-3 mb-3 flex-shrink-0 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
            isPublishing ? 'bg-pink-900 text-pink-300' :
            publishState === 'done' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}>
            {isPublishing ? '发布中' : publishState === 'done' ? '✓ 发布成功' : '✕ 发布失败'}
          </span>
          <p className="text-sm font-medium text-white truncate flex-1 min-w-0">{title}</p>
          {taskId && <span className="text-xs text-gray-600 font-mono flex-shrink-0 hidden sm:block">ID: {taskId}</span>}
          <button
            onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); updateTaskId(''); setQrCode(null); }}
            className="text-xs text-pink-400 hover:text-pink-300 border border-pink-900 hover:border-pink-600 px-3 py-1 rounded-lg transition-colors flex-shrink-0"
          >
            {hasResult ? '重新发布' : '返回'}
          </button>
        </div>

        {/* QR 码（扫码需要时显示在顶栏下方，不遮挡主内容） */}
        {qrCode && (
          <div className="mb-3 flex-shrink-0 bg-yellow-950 border border-yellow-700 rounded-xl px-4 py-3 flex items-center gap-4 relative">
            <button onClick={() => setQrCode(null)}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-yellow-700 hover:text-yellow-400 hover:bg-yellow-900 rounded transition-colors text-lg">×</button>
            <button onClick={() => setScreenshotModal({ url: qrCode, label: '抖音扫码登录', isQr: true })}
              className="bg-white rounded-lg p-1.5 hover:shadow-md transition-shadow flex-shrink-0">
              <img src={qrCode} alt="QR" className="w-20 h-20 object-contain block" />
            </button>
            <div className="min-w-0">
              <p className="text-sm text-yellow-400 font-medium">Cookie 已过期，请用抖音 App 扫码登录</p>
              <p className="text-xs text-yellow-700 mt-1">扫码后自动继续 · 约 3 分钟有效</p>
              <button onClick={() => setScreenshotModal({ url: qrCode, label: '抖音扫码登录', isQr: true })}
                className="text-xs text-yellow-500 hover:text-yellow-300 underline mt-1 block">
                扫不到？点击全屏放大
              </button>
            </div>
          </div>
        )}

        {/* 主体：日志 + 阶段进度并排，flex-1 撑满剩余高度 */}
        <div className="flex gap-3 flex-1 min-h-0">

          {/* ── 实时日志（左，flex-1，独立滚动） ── */}
          <div className="flex-1 min-w-0 flex flex-col bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium">实时日志</span>
                <span className="text-xs text-gray-600">({logs.length} 行)</span>
                {isPublishing && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
              </div>
              {resultMsg && (
                <span className={`text-xs truncate ml-2 ${publishState === 'done' ? 'text-green-400' : 'text-red-400'}`}>
                  {resultMsg.slice(0, 60)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-green-400 space-y-0.5">
              {logs.length === 0
                ? <p className="text-gray-600 text-center mt-8">等待日志...</p>
                : logs.map((l, i) => <div key={i} className="leading-relaxed">{l}</div>)
              }
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* ── 阶段进度（右，固定宽度，独立滚动） ── */}
          <div className="w-64 flex-shrink-0 flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
              <p className="text-xs font-medium text-gray-300">发布进度</p>
              {taskId && <p className="text-xs text-gray-600 font-mono mt-0.5 truncate" title={taskId}>#{taskId.slice(-12)}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <StagePanel />
            </div>
          </div>
        </div>

        {screenshotModal && (
          <ScreenshotModal url={screenshotModal.url} label={screenshotModal.label}
            isQr={screenshotModal.isQr} onClose={() => setScreenshotModal(null)} />
        )}
        <MaterialsDrawer
          open={showDrawer}
          materials={materials}
          onSelect={selectMaterial}
          onClose={() => setShowDrawer(false)}
        />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  表单布局（idle）
  // ══════════════════════════════════════════════════════════
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">视频发布</h1>
        <p className="mt-1 text-gray-400 text-sm">将视频发布到抖音账号，实时追踪每个发布阶段</p>
      </div>

      <div className="space-y-4">

        {/* 登录状态 */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">登录状态</span>
              <span className={`text-xs font-semibold ${loginStatusColor[loginStatus]}`}>{loginStatusLabel[loginStatus]}</span>
            </div>
            <button onClick={handleCheckLogin}
              disabled={loginStatus === 'scanning' || loginStatus === 'checking'}
              className="text-xs text-pink-400 hover:text-pink-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors">
              {loginStatus === 'not_logged_in' || loginStatus === 'unknown' ? '扫码登录' : loginStatus === 'logged_in' ? '重新检测' : '检测中...'}
            </button>
          </div>
          {loginQr && (
            <div className="mt-4 flex flex-col items-center gap-3 pt-3 border-t border-gray-800">
              <p className="text-xs text-yellow-400 font-medium">请用抖音 App 扫描下方二维码</p>
              <button onClick={() => setScreenshotModal({ url: loginQr, label: '抖音扫码登录', isQr: true })}
                className="bg-white rounded-xl p-2 hover:shadow-lg transition-shadow">
                <img src={loginQr} alt="扫码登录"
                  style={{ width: 'min(50vw, 200px)', height: 'min(50vw, 200px)' }}
                  className="object-contain block" />
              </button>
              <p className="text-xs text-yellow-600">扫码后自动保存 Cookie，约 3 分钟有效</p>
              <div className="flex items-center gap-4">
                <button onClick={() => setScreenshotModal({ url: loginQr, label: '抖音扫码登录', isQr: true })}
                  className="text-xs text-yellow-500 hover:text-yellow-300 underline">全屏放大</button>
                <button onClick={() => { setLoginQr(null); setLoginStatus('unknown'); }}
                  className="text-xs text-gray-600 hover:text-gray-400">取消</button>
              </div>
            </div>
          )}
        </div>

        {/* OSS URL */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400 font-medium">视频地址 (OSS URL)</label>
            <button onClick={() => setShowDrawer(true)}
              className="text-xs text-pink-400 hover:text-pink-300 transition-colors flex items-center gap-1">
              从素材库选择
              {materials.length > 0 && <span className="bg-pink-900 text-pink-300 rounded-full px-1.5 py-0.5 text-xs leading-none">{materials.length}</span>}
            </button>
          </div>
          <input type="text" value={ossUrl} onChange={e => setOssUrl(e.target.value)}
            placeholder="https://articel.oss-cn-hangzhou.aliyuncs.com/..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-pink-600 transition-colors" />
        </div>

        {/* Title */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <label className="text-xs text-gray-400 font-medium block mb-2">标题（最多 30 字）</label>
          <input type="text" maxLength={30} value={title} onChange={e => setTitle(e.target.value)} placeholder="输入发布标题..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors" />
          <p className="text-right text-xs text-gray-600 mt-1">{title.length}/30</p>
        </div>

        {/* Description */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <label className="text-xs text-gray-400 font-medium block mb-2">正文（可选）</label>
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="输入正文内容..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none resize-none focus:border-pink-600 transition-colors" />
        </div>

        {/* Tags */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <label className="text-xs text-gray-400 font-medium block mb-2">话题标签（逗号分隔，不含 #）</label>
          <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：情感,治愈,日常"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-pink-600 transition-colors" />
        </div>

        {/* 发布按钮 */}
        <button onClick={handlePublish} disabled={!ossUrl.trim() || !title.trim()}
          className="w-full py-3 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors">
          开始发布
        </button>
      </div>

      {screenshotModal && (
        <ScreenshotModal url={screenshotModal.url} label={screenshotModal.label}
          isQr={screenshotModal.isQr} onClose={() => setScreenshotModal(null)} />
      )}
      <MaterialsDrawer
        open={showDrawer}
        materials={materials}
        onSelect={selectMaterial}
        onClose={() => setShowDrawer(false)}
      />
    </div>
  );
}

export default function PublishPage() {
  return <Suspense><PublishPageInner /></Suspense>;
}
