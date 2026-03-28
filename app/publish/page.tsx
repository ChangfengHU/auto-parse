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
        className={`fixed right-0 top-0 h-full z-50 bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 400 }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-semibold text-foreground">素材库</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{filtered.length} 个素材</span>
            <button onClick={onClose} className="ml-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg text-xl transition-colors">×</button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索标题..."
              className="w-full bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs">✕</button>
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
                <div key={m.id} className="group bg-muted rounded-xl overflow-hidden border border-border hover:border-primary transition-all duration-200 cursor-pointer"
                  onClick={() => { onSelect(m.ossUrl, m.title); onClose(); }}
                >
                  {/* 视频缩略图 */}
                  <div className="aspect-video bg-black relative overflow-hidden">
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
                    <p className="text-xs text-foreground line-clamp-2 leading-tight font-medium">{m.title || '（无标题）'}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(m.parsedAt).toLocaleDateString('zh-CN')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex-shrink-0 flex items-center justify-between">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs text-muted-foreground hover:text-foreground disabled:text-muted-foreground/50 disabled:cursor-not-allowed px-3 py-1.5 bg-muted hover:bg-muted/80 disabled:bg-transparent rounded-lg transition-colors">
              ← 上一页
            </button>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = totalPages <= 7 ? i : i === 0 ? 0 : i === 6 ? totalPages - 1 : page - 2 + i;
                const isActive = p === page;
                return (
                  <button key={i} onClick={() => setPage(Math.max(0, Math.min(totalPages - 1, p)))}
                    className={`w-6 h-6 rounded text-xs transition-colors ${isActive ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                    {Math.max(0, Math.min(totalPages - 1, p)) + 1}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="text-xs text-muted-foreground hover:text-foreground disabled:text-muted-foreground/50 disabled:cursor-not-allowed px-3 py-1.5 bg-muted hover:bg-muted/80 disabled:bg-transparent rounded-lg transition-colors">
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

// ── Debug 工作流按钮（含工作流选择，记住上次选择）──────────────
function DebugWorkflowButton({ ossUrl, title, description, tags, clientId, disabled }: {
  ossUrl: string; title: string; description: string; tags: string; clientId: string; disabled: boolean;
}) {
  const STORAGE_KEY = 'preferred-workflow-id';
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(STORAGE_KEY) ?? 'douyin-publish';
    return 'douyin-publish';
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/workflows').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setWorkflows(d.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name })));
    }).catch(() => {});
  }, []);

  function select(id: string) {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY, id);
    setOpen(false);
  }

  const params = new URLSearchParams({ ossUrl, title, description, tags, clientId });
  const href = `/workflows/${selectedId}?${params.toString()}`;
  const selected = workflows.find(w => w.id === selectedId);

  return (
    <div className="flex gap-1.5 items-stretch">
      <a href={href}
        className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all text-center border ${disabled ? 'border-border text-muted-foreground bg-muted/30 pointer-events-none' : 'border-primary/40 text-primary hover:border-primary hover:bg-primary/10'}`}>
        Debug {selected ? `· ${selected.name}` : '发布（逐步执行）'}
      </a>
      {!disabled && (
        <div className="relative">
          <button onClick={() => setOpen(p => !p)}
            className="h-full px-3 rounded-xl border border-primary/40 text-primary hover:border-primary hover:bg-primary/10 transition-all text-sm">
            ▾
          </button>
          {open && (
            <div className="absolute right-0 bottom-full mb-1 bg-card border border-border rounded-xl shadow-xl py-1 z-50 min-w-[180px]">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground px-3 pt-1 pb-0.5">选择工作流</p>
              {workflows.map(w => (
                <button key={w.id} onClick={() => select(w.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${selectedId === w.id ? 'text-primary' : 'text-foreground'}`}>
                  {selectedId === w.id ? '✓ ' : ''}{w.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
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

  const [loginStatus,   setLoginStatus]  = useState<LoginStatus>('unknown');
  const [loginQr,       setLoginQr]      = useState<string | null>(null);
  const [loginLog,      setLoginLog]     = useState<string>('');
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookiePaste,   setCookiePaste]  = useState('');
  const [cookieSaving,  setCookieSaving] = useState(false);

  // 插件凭证（clientId → Supabase）
  const [clientId,       setClientId]      = useState('');
  const [pluginFetching, setPluginFetching] = useState(false);
  const [pluginCookie,   setPluginCookie]  = useState<string | null>(null);
  const [pluginMsg,      setPluginMsg]     = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [stages,       setStages]       = useState<StageState[]>([]);
  const [logs,         setLogs]         = useState<string[]>([]);
  const [qrCode,       setQrCode]       = useState<string | null>(null);
  const [resultMsg,    setResultMsg]    = useState('');

  const [taskId,       setTaskId]       = useState(initTaskId);
  const taskIdRef = useRef(initTaskId);
  const updateTaskId = useCallback((id: string) => { taskIdRef.current = id; setTaskId(id); }, []);

  const [isMinimized,  setIsMinimized]  = useState(false);  // 返回表单但不停止任务
  const abortRef = useRef<AbortController | null>(null);    // 停止发布

  const [expandedStage,   setExpandedStage]   = useState<string | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; label: string; isQr?: boolean } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── 初始化 ─────────────────────────────────────────────────

  // 页面加载时自动检测插件，获取 clientId 并自动拉取登录信息
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'DOUYIN_CLIENT_ID') return;
      const id = event.data.clientId as string | null;
      if (!id) return;
      window.removeEventListener('message', handler);
      setClientId(id);
      // 自动拉取登录信息
      fetch(`/api/login/supabase?clientId=${encodeURIComponent(id)}`)
        .then(r => r.json())
        .then((d: { found?: boolean; expired?: boolean; cookieStr?: string | null; account?: string | null; message?: string }) => {
          if (d.found && !d.expired && d.cookieStr) {
            setPluginCookie(d.cookieStr);
            setLoginStatus('logged_in');
            setPluginMsg({ type: 'ok', text: d.message ?? '已通过插件自动登录' });
          } else if (d.found && d.expired) {
            setPluginMsg({ type: 'warn', text: d.message ?? 'Cookie 可能已过期' });
          }
        })
        .catch(() => {});
    };
    window.addEventListener('message', handler);
    // 向插件发送请求
    window.postMessage({ type: 'DOUYIN_GET_CLIENT_ID' }, '*');
    // 2s 超时，无响应说明未安装插件
    const timer = setTimeout(() => window.removeEventListener('message', handler), 2000);
    return () => { clearTimeout(timer); window.removeEventListener('message', handler); };
  }, []);

  useEffect(() => { fetch('/api/materials').then(r => r.json()).then(setMaterials).catch(() => {}); }, []);
  // 页面加载：本地 Cookie 文件只是"可能有效"，不直接亮绿灯
  // 真正已登录需要通过插件凭证验证或扫码确认
  useEffect(() => {
    fetch('/api/login').then(r => r.json())
      .then(d => {
        // 只有本地 cookie 且未被插件验证覆盖时，才做初始状态判断
        // 保守策略：cookie 存在但未验证 → 'unknown'（灰色），待用户主动验证
        setLoginStatus(d.loggedIn ? 'unknown' : 'not_logged_in');
      }).catch(() => {});
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

  const loginAbortRef = useRef<AbortController | null>(null);

  async function handleCheckLogin() {
    // 如果正在扫码，点击"取消"
    if (loginStatus === 'scanning') {
      loginAbortRef.current?.abort();
      setLoginStatus('unknown'); setLoginQr(null);
      return;
    }
    if (loginStatus === 'checking') return;
    setLoginStatus('scanning'); setLoginQr(null); setLoginLog('正在打开浏览器...');
    const ctrl = new AbortController();
    loginAbortRef.current = ctrl;
    const scanStartTime = Date.now();

    // 轮询检测：每 5s 查一次 cookie 是否在本次扫码后更新（防止 SSE 断连漏掉 done 事件）
    const pollTimer = setInterval(async () => {
      try {
        const r = await fetch('/api/login');
        const d = await r.json() as { loggedIn: boolean; updatedAtMs?: number };
        // 只有 cookie 更新时间晚于本次扫码开始时间，才视为本次扫码成功
        if (d.loggedIn && (d.updatedAtMs ?? 0) > scanStartTime) {
          clearInterval(pollTimer); ctrl.abort();
          setLoginStatus('logged_in'); setLoginQr(null); setLoginLog('');
        }
      } catch { /* ignore */ }
    }, 5000);

    try {
      const res = await fetch('/api/login/qrcode', { signal: ctrl.signal });
      if (!res.ok || !res.body) { setLoginStatus('unknown'); setLoginLog(''); return; }
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
              setLoginLog(payload.replace(/^[^\s]+ /, ''));
            } else if (type === 'qrcode' || type === 'refresh') {
              // 'refresh' = 110s 后自动刷新的新二维码
              setLoginQr(payload);
              if (type === 'qrcode') setLoginLog('请用抖音 App 扫码，扫后在 App 内点击确认授权');
            } else if (type === 'done') {
              // 新流程：done 携带 { clientId, loggedIn }
              let newClientId = '';
              try { const d = JSON.parse(payload) as { clientId?: string }; newClientId = d.clientId ?? ''; } catch { /* old format */ }
              setLoginStatus('logged_in');
              setLoginQr(null);
              setLoginLog('');
              if (newClientId) {
                setClientId(newClientId);
                setPluginMsg({ type: 'ok', text: `✅ 登录成功，凭证已自动填入：${newClientId}` });
              }
            } else if (type === 'error') {
              setLoginStatus('not_logged_in'); setLoginQr(null); setLoginLog('');
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') { setLoginStatus('not_logged_in'); setLoginLog(''); }
    } finally {
      clearInterval(pollTimer);
    }
  }

  async function handleSaveCookie() {
    if (!cookiePaste.trim() || cookieSaving) return;
    setCookieSaving(true);
    try {
      const res = await fetch('/api/login/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieStr: cookiePaste.trim() }),
      });
      const d = await res.json() as { ok?: boolean; error?: string; cookieCount?: number };
      if (d.ok) {
        setLoginStatus('logged_in');
        setCookiePaste('');
        setShowCookieInput(false);
      } else {
        alert(d.error ?? '保存失败');
      }
    } catch { alert('请求失败'); }
    finally { setCookieSaving(false); }
  }

  async function handleFetchPlugin() {
    const id = clientId.trim();
    if (!id || pluginFetching) return;
    setPluginFetching(true);
    setPluginMsg(null);
    setPluginCookie(null);
    try {
      const res = await fetch(`/api/login/supabase?clientId=${encodeURIComponent(id)}`);
      const d = await res.json() as {
        found?: boolean; expired?: boolean; cookieStr?: string | null;
        account?: string | null; message?: string; error?: string;
      };
      if (d.error) {
        setPluginMsg({ type: 'error', text: d.error });
        setLoginStatus('not_logged_in');
        return;
      }
      if (!d.found) {
        setPluginMsg({ type: 'error', text: '未找到登录信息，请先安装插件并同步' });
        setLoginStatus('not_logged_in');
        return;
      }
      if (d.expired || !d.cookieStr) {
        setPluginMsg({ type: 'warn', text: d.message ?? 'Cookie 可能已过期，建议重新同步' });
        setLoginStatus('not_logged_in');  // 与插件验证结果保持一致
        return;
      }
      setPluginCookie(d.cookieStr);
      setLoginStatus('logged_in');
      setPluginMsg({ type: 'ok', text: d.message ?? '登录信息有效' });
    } catch { setPluginMsg({ type: 'error', text: '请求失败，请检查网络' }); }
    finally { setPluginFetching(false); }
  }

  function handleStop() {
    abortRef.current?.abort();
    setPublishState('error'); setResultMsg('用户已手动停止发布');
    setIsMinimized(false);
    setStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
  }

  async function handlePublish() {
    if (!ossUrl.trim() || !title.trim()) return;
    setPublishState('publishing'); setIsMinimized(false); setStages(initStages()); setLogs([]); setQrCode(null); setResultMsg(''); updateTaskId('');
    const tagList = tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: ossUrl, title, description, tags: tagList, clientId: clientId.trim() || undefined, cookieStr: pluginCookie && !clientId.trim() ? pluginCookie : undefined }),
        signal: ctrl.signal,
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
            if (type === 'taskId') {
              updateTaskId(payload); // 独立 taskId 事件，直接赋值，无需正则
            } else if (type === 'log') {
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
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return; // 用户主动停止，不覆盖状态
      setPublishState('error'); setResultMsg(e instanceof Error ? e.message : '网络错误');
    }
  }

  function selectMaterial(url: string, t: string) { setOssUrl(url); setTitle(t); setShowDrawer(false); }
  function toggleStage(key: string) { setExpandedStage(prev => prev === key ? null : key); }

  const isPublishing = publishState === 'publishing';
  const hasResult    = publishState === 'done' || publishState === 'error';
  const isMonitor    = (isPublishing || hasResult) && !isMinimized; // 监控布局（最小化时回到表单）

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
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? 'hover:bg-muted cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                <StageIcon status={stage.status} />
                {idx < stages.length - 1 && (
                  <div className={`w-px mt-0.5 ${stage.status === 'ok' ? 'bg-green-500/40' : 'bg-border'}`} style={{ height: 12 }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-tight ${
                  stage.status === 'ok'    ? 'text-green-500' : stage.status === 'running' ? 'text-primary' :
                  stage.status === 'error' ? 'text-red-500'   : stage.status === 'warn' || stage.status === 'skip' ? 'text-yellow-500' : 'text-muted-foreground'
                }`}>{stage.label}</p>
                {stage.message && stage.status !== 'pending' && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5 leading-tight">{stage.message}</p>
                )}
              </div>
              {isActive && <span className="text-muted-foreground flex-shrink-0 text-xs">{isLoginQr || hasShot ? '📷' : isExpanded ? '▴' : '▾'}</span>}
            </button>

            {isExpanded && isActive && (
              <div className="mx-3 mb-1">
                {isLoginQr ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <p className="text-xs text-yellow-500">扫码登录（可直接扫）</p>
                    <button onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                      className="bg-white rounded-lg p-2 shadow-sm hover:shadow-md transition-shadow">
                      <img src={qrCode!} alt="QR Code" className="w-36 h-36 object-contain block" />
                    </button>
                    <button onClick={() => setScreenshotModal({ url: qrCode!, label: '抖音扫码登录', isQr: true })}
                      className="text-xs text-yellow-600 hover:text-yellow-500 underline">全屏放大</button>
                  </div>
                ) : hasShot ? (
                  <button onClick={() => setScreenshotModal({ url: stage.screenshotUrl!, label: stage.label })} className="block w-full group">
                    <img src={stage.screenshotUrl} alt={stage.label}
                      className="w-full rounded-lg border border-border group-hover:border-primary object-contain max-h-44 transition-colors" />
                    <p className="text-xs text-muted-foreground text-center mt-1">点击放大</p>
                  </button>
                ) : (
                  <div className="py-3 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
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
            isPublishing ? 'bg-primary/20 text-primary' :
            publishState === 'done' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
          }`}>
            {isPublishing ? '发布中' : publishState === 'done' ? '✓ 发布成功' : '✕ 发布失败'}
          </span>
          <p className="text-sm font-medium text-foreground truncate flex-1 min-w-0">{title}</p>
          {taskId && <span className="text-xs text-muted-foreground font-mono flex-shrink-0 hidden sm:block">ID: {taskId}</span>}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 发布中：停止 + 返回（最小化） */}
            {isPublishing && (
              <>
                <button
                  onClick={handleStop}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-600 px-3 py-1 rounded-lg transition-colors"
                >
                  停止
                </button>
                <button
                  onClick={() => setIsMinimized(true)}
                  className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground/30 px-3 py-1 rounded-lg transition-colors"
                >
                  返回
                </button>
              </>
            )}
            {/* 完成/失败：重新发布 */}
            {hasResult && (
              <button
                onClick={() => { setPublishState('idle'); setStages([]); setLogs([]); updateTaskId(''); setQrCode(null); setIsMinimized(false); }}
                className="text-xs text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 px-3 py-1 rounded-lg transition-colors"
              >
                重新发布
              </button>
            )}
          </div>
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

          {/* ── 实时日志 (左) ── */}
          <div className="flex-1 min-w-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">实时日志</span>
                <span className="text-xs text-muted-foreground/60">({logs.length} 行)</span>
                {isPublishing && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
              </div>
              {resultMsg && (
                <span className={`text-xs truncate ml-2 ${publishState === 'done' ? 'text-green-500' : 'text-red-500'}`}>
                  {resultMsg.slice(0, 60)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-primary dark:text-green-400 space-y-0.5 bg-muted/30">
              {logs.length === 0
                ? <p className="text-muted-foreground text-center mt-8">等待日志...</p>
                : logs.map((l, i) => <div key={i} className="leading-relaxed">{l}</div>)
              }
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* ── 阶段进度 (右) ── */}
          <div className="w-64 flex-shrink-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="px-3 py-2 border-b border-border flex-shrink-0">
              <p className="text-xs font-medium text-foreground/80">发布进度</p>
              {taskId && <p className="text-xs text-muted-foreground/60 font-mono mt-0.5 truncate" title={taskId}>#{taskId.slice(-12)}</p>}
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
  //  表单布局（idle / 最小化）
  // ══════════════════════════════════════════════════════════
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">

      {/* 后台任务进行中 / 已完成 提示条 */}
      {isMinimized && (
        <div className={`mb-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${
          isPublishing
            ? 'bg-pink-950 border-pink-800'
            : publishState === 'done'
            ? 'bg-green-950 border-green-800'
            : 'bg-red-950 border-red-800'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            {isPublishing && <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse flex-shrink-0" />}
            <div className="min-w-0">
              <p className={`text-sm font-medium truncate ${
                isPublishing ? 'text-pink-300' : publishState === 'done' ? 'text-green-300' : 'text-red-300'
              }`}>
                {isPublishing ? '发布任务进行中...' : publishState === 'done' ? '✓ 发布成功' : '✕ 发布失败'}
              </p>
              {title && <p className="text-xs text-gray-500 truncate mt-0.5">{title}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isPublishing && (
              <button
                onClick={handleStop}
                className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-2.5 py-1 rounded-lg transition-colors"
              >
                停止
              </button>
            )}
            <button
              onClick={() => setIsMinimized(false)}
              className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                isPublishing
                  ? 'text-pink-400 hover:text-pink-300 border-pink-800 hover:border-pink-600'
                  : publishState === 'done'
                  ? 'text-green-400 hover:text-green-300 border-green-800 hover:border-green-600'
                  : 'text-red-400 hover:text-red-300 border-red-800 hover:border-red-600'
              }`}
            >
              查看进度
            </button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">视频发布</h1>
        <p className="mt-1 text-muted-foreground text-sm">将视频发布到抖音账号，实时追踪每个发布阶段</p>
      </div>
      <div className="space-y-4">

        {/* 登录状态 */}
        <div className={`border rounded-xl p-4 transition-colors ${
          loginStatus === 'logged_in'
            ? 'bg-green-500/5 border-green-500/20'
            : loginStatus === 'not_logged_in'
            ? 'bg-yellow-500/5 border-yellow-500/20'
            : 'bg-card border-border'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">抖音账号</span>
              <span className={`text-xs font-semibold ${loginStatusColor[loginStatus]}`}>{loginStatusLabel[loginStatus]}</span>
              {loginStatus === 'logged_in' && (
                <span className="text-xs text-green-700">· Cookie 有效，发布将跳过登录检测</span>
              )}
              {loginStatus === 'unknown' && (
                <span className="text-xs text-muted-foreground">· 请通过插件凭证获取或扫码确认登录状态</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => { setShowCookieInput(v => !v); setLoginQr(null); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="直接粘贴浏览器 Cookie，无需扫码"
              >
                粘贴 Cookie
              </button>
              <span className="text-border">|</span>
              <button onClick={handleCheckLogin}
                disabled={loginStatus === 'checking'}
                className="text-xs text-primary hover:text-primary/80 disabled:text-muted-foreground/50 disabled:cursor-not-allowed transition-colors font-medium">
                {loginStatus === 'scanning' ? '取消' : loginStatus === 'logged_in' ? '重新扫码' : '扫码登录'}
              </button>
            </div>
          </div>


          {/* 插件凭证 → Supabase 获取登录信息 */}
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground mb-1">通过插件凭证获取登录信息（推荐）</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={clientId}
                onChange={e => { setClientId(e.target.value); setPluginMsg(null); setPluginCookie(null); }}
                placeholder="粘贴插件凭证 dy_xxxxxxxx"
                className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary font-mono transition-colors"
              />
              <button
                onClick={handleFetchPlugin}
                disabled={!clientId.trim() || pluginFetching}
                className="text-xs px-3 py-1.5 bg-primary text-white hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/50 rounded-lg transition-colors flex-shrink-0 font-medium"
              >
                {pluginFetching ? '获取中...' : '获取'}
              </button>
            </div>
            {pluginMsg && (
              <p className={`text-xs ${pluginMsg.type === 'ok' ? 'text-green-500' : pluginMsg.type === 'warn' ? 'text-yellow-500' : 'text-red-500'}`}>
                {pluginMsg.type === 'ok' ? '✓ ' : pluginMsg.type === 'warn' ? '⚠ ' : '✗ '}{pluginMsg.text}
              </p>
            )}
          </div>
          {/* 粘贴 Cookie 面板 */}
          {showCookieInput && (
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground">从浏览器插件复制抖音 Cookie 字符串，粘贴到下方：</p>
              <textarea
                rows={3}
                value={cookiePaste}
                onChange={e => setCookiePaste(e.target.value)}
                placeholder="sessionid=xxx; uid_tt=xxx; ..."
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary resize-none font-mono transition-colors"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveCookie}
                  disabled={!cookiePaste.trim() || cookieSaving}
                  className="text-xs px-3 py-1.5 bg-primary text-white hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/50 rounded-lg transition-colors font-medium"
                >
                  {cookieSaving ? '保存中...' : '保存并登录'}
                </button>
                <button onClick={() => { setShowCookieInput(false); setCookiePaste(''); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors">取消</button>
                <span className="text-xs text-muted-foreground/60 ml-auto">需包含 sessionid 字段</span>
              </div>
            </div>
          )}
          {loginStatus === 'not_logged_in' && !loginQr && (
            <p className="text-xs text-yellow-600 mt-2">请先扫码登录，否则发布时会中途弹出二维码</p>
          )}
          {loginStatus === 'scanning' && loginLog && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
              {!loginQr && <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />}
              {loginQr && <span className="text-xs">📱</span>}
              <span className="text-xs text-primary font-medium">{loginLog}</span>
            </div>
          )}
          {loginQr && (
            <div className="mt-4 flex flex-col items-center gap-3 pt-3 border-t border-border">
              <p className="text-xs text-yellow-400 font-medium">请用抖音 App 扫描下方二维码</p>
              <button onClick={() => setScreenshotModal({ url: loginQr, label: '抖音扫码登录', isQr: true })}
                className="bg-white rounded-xl p-2 hover:shadow-lg transition-shadow">
                <img src={loginQr} alt="扫码登录"
                  style={{ width: 'min(50vw, 200px)', height: 'min(50vw, 200px)' }}
                  className="object-contain block" />
              </button>
              <p className="text-xs text-yellow-600">扫码后自动保存 Cookie，发布无需再次登录</p>
              <div className="flex items-center gap-4">
                <button onClick={() => setScreenshotModal({ url: loginQr, label: '抖音扫码登录', isQr: true })}
                  className="text-xs text-yellow-500 hover:text-yellow-600 underline transition-colors">全屏放大</button>
                <button onClick={() => { setLoginQr(null); setLoginStatus('unknown'); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors">取消</button>
              </div>
            </div>
          )}
        </div>

        {/* OSS URL */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground font-medium">视频地址 (OSS URL)</label>
            <button onClick={() => setShowDrawer(true)}
              className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 font-medium">
              从素材库选择
              {materials.length > 0 && <span className="bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-xs leading-none">{materials.length}</span>}
            </button>
          </div>
          <input type="text" value={ossUrl} onChange={e => setOssUrl(e.target.value)}
            placeholder="https://articel.oss-cn-hangzhou.aliyuncs.com/..."
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary transition-colors" />
        </div>

        {/* Title */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
          <label className="text-xs text-muted-foreground font-medium block mb-2">标题（最多 30 字）</label>
          <input type="text" maxLength={30} value={title} onChange={e => setTitle(e.target.value)} placeholder="输入发布标题..."
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors" />
          <p className="text-right text-xs text-muted-foreground/60 mt-1">{title.length}/30</p>
        </div>

        {/* Description */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
          <label className="text-xs text-muted-foreground font-medium block mb-2">正文（可选）</label>
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="输入正文内容..."
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none resize-none focus:border-primary transition-colors" />
        </div>

        {/* Tags */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
          <label className="text-xs text-muted-foreground font-medium block mb-2">话题标签（逗号分隔，不含 #）</label>
          <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：情感,治愈,日常"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors" />
        </div>

        {/* 发布按钮 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handlePublish}
            disabled={!ossUrl.trim() || !title.trim() || isPublishing}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-white disabled:bg-muted disabled:text-muted-foreground/50 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-all shadow-lg shadow-primary/20 active:scale-[0.98]"
          >
            {isPublishing ? '发布中...' : '开始发布'}
          </button>

          <DebugWorkflowButton ossUrl={ossUrl} title={title} description={description} tags={tags} clientId={clientId} disabled={!ossUrl.trim() || !title.trim() || isPublishing} />
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

export default function PublishPage() {
  return <Suspense><PublishPageInner /></Suspense>;
}
