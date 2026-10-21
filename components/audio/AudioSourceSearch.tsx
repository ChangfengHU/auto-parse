'use client';

import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  MagnifyingGlassIcon,
  MusicalNoteIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AudioAsset, AudioAssetKind, AudioSearchResponse } from '@/lib/audio-assets';

const PRESETS: Record<AudioAssetKind, Array<{ label: string; query: string }>> = {
  music: [
    { label: '钢琴', query: 'piano' },
    { label: '电影感', query: 'cinematic' },
    { label: '轻松', query: 'relaxing' },
    { label: '温暖', query: 'warm acoustic' },
    { label: '悬疑', query: 'suspense' },
    { label: '励志', query: 'inspiring' },
    { label: '科技', query: 'technology electronic' },
  ],
  sound_effect: [
    { label: '脚步', query: 'footsteps' },
    { label: '敲门', query: 'knocking door' },
    { label: '转场', query: 'transition whoosh' },
    { label: '掌声', query: 'applause' },
    { label: '雨声', query: 'rain ambience' },
    { label: '键盘', query: 'keyboard typing' },
  ],
};

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return '--:--';
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
function sourceName(source: string) {
  if (source === 'freesound') return 'Freesound';
  if (source === 'jamendo') return 'Jamendo';
  return source;
}

function ResultSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-slate-100" />
        <div className="flex-1 space-y-2"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/3 rounded bg-slate-100" /></div>
      </div>
      <div className="h-12 rounded-xl bg-slate-100" />
    </div>
  );
}
export default function AudioSourceSearch({ onImport }: { onImport: (asset: AudioAsset) => void }) {
  const [kind, setKind] = useState<AudioAssetKind>('music');
  const [input, setInput] = useState('piano');
  const [query, setQuery] = useState('piano');
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('Openverse 搜索暂时停用，当前使用 Wikimedia。');
  const [resultQuery, setResultQuery] = useState('');
  const [length, setLength] = useState('');
  const [license, setLicense] = useState('commercial');
  const [items, setItems] = useState<AudioAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AudioAsset | null>(null);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const search = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ kind, q: query, pageSize: '12', page: String(page), provider: 'wikimedia', license });
      if (length) params.set('length', length);
      if (license) params.set('license', license);
      const timeout = AbortSignal.timeout(12000);
      const response = await fetch(`/api/audio/search?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const data = await response.json().catch(() => { throw new Error('搜索服务暂时不可用，请稍后重试（返回格式异常）'); }) as AudioSearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || '搜索失败');
      if (!Array.isArray(data.items)) throw new Error('搜索结果格式异常，请重试');
      if (signal?.aborted) return;
      setItems(data.items);
      setTotal(data.total);
      setHasNext(data.hasNext);
      setNotice(data.notice || '');
      setResultQuery(query);
    } catch (searchError) {
      if (signal?.aborted) return;
      setHasNext(false);
      setError(searchError instanceof Error && ['TimeoutError', 'AbortError'].includes(searchError.name)
        ? '搜索等待超时，请重试或更换关键词。保留上次结果。'
        : `${searchError instanceof Error ? searchError.message : '搜索失败，请稍后重试'}。保留上次结果。`);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [kind, query, length, license, page]);

  useEffect(() => {
    const controller = new AbortController();
    search(controller.signal);
    return () => controller.abort();
  }, [search, revision]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  function switchKind(nextKind: AudioAssetKind) {
    audioRef.current?.pause();
    setPlayingId(null);
    setKind(nextKind);
    const nextQuery = nextKind === 'music' ? 'piano' : 'footsteps';
    setPage(1);
    setInput(nextQuery);
    setQuery(nextQuery);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = input.trim();
    if (nextQuery) { setQuery(nextQuery); setPage(1); setRevision(r => r + 1); }
  }

  function applyPreset(preset: { label: string; query: string }) {
    setInput(preset.label);
    setQuery(preset.query);
    setPage(1);
    setRevision(r => r + 1);
  }

  async function togglePreview(asset: AudioAsset) {
    if (playingId === asset.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(asset.previewUrl);
    audioRef.current = audio;
    audio.addEventListener('ended', () => setPlayingId(null), { once: true });
    audio.addEventListener('error', () => {
      setPlayingId(null);
      setError('该素材的试听地址暂时不可用，请尝试其他素材');
    }, { once: true });
    try {
      await audio.play();
      setPlayingId(asset.id);
    } catch {
      setError('浏览器未能播放该素材，请打开素材原页试听');
    }
  }

  async function copyPreviewUrl() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.previewUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setError('复制失败，请打开素材原页获取链接'); }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-10 lg:px-10 lg:py-14">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700">
                <SpeakerWaveIcon className="h-3.5 w-3.5" /> Audio Assets · Beta
              </span>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">找到视频需要的那段声音</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500 sm:text-base">检索背景音乐与音效，在线试听并核对来源。合适的素材可导入私有候选库，验收后重复使用。</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3"><p className="text-xs text-slate-400">本页匹配</p><p className="mt-1 text-xl font-semibold">{loading ? '—' : total.toLocaleString()}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3"><p className="text-xs text-slate-400">素材来源</p><p className="mt-1 text-sm font-semibold">Wikimedia</p></div>
            </div>
          </div>

          <div className="mt-9 inline-flex rounded-xl bg-slate-100 p-1">
            {([
              ['music', '背景音乐', MusicalNoteIcon],
              ['sound_effect', '音效', SpeakerWaveIcon],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" onClick={() => switchKind(value)} aria-pressed={kind === value} className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition ${kind === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-10">
        <p role="status" className="mb-4 text-sm text-amber-800">{notice}</p>
        <form onSubmit={submitSearch} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">搜索音频素材</span>
              <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={kind === 'music' ? '搜索情绪、场景或曲风，如 cinematic' : '搜索动作或环境，如 footsteps'} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm outline-none transition focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-100" />
            </label>
            <button type="submit" className="h-12 rounded-xl bg-slate-950 px-7 text-sm font-semibold text-white transition hover:bg-pink-600 focus:outline-none focus:ring-4 focus:ring-pink-100">搜索素材</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-3">
            <span className="mr-1 text-xs font-medium text-slate-400">快速搜索</span>
            {PRESETS[kind].map((preset) => <button key={preset.label} type="button" onClick={() => applyPreset(preset)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700">{preset.label}</button>)}
          </div>
        </form>

        <div className="mt-6 flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
          <div><h2 className="text-lg font-semibold">“{resultQuery || query}” 的搜索结果</h2><p className="mt-1 text-xs text-slate-400">点击播放试听；使用前请再次核对素材原页授权范围</p></div>
          <div className="flex gap-2">
            <select aria-label="时长筛选" value={length} onChange={(event) => { setLength(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none focus:border-pink-400">
              <option value="">全部时长</option><option value="shortest">小于 30 秒</option><option value="short">30 秒–4 分钟</option><option value="medium">4–10 分钟</option><option value="long">10 分钟以上</option>
            </select>
            <select aria-label="授权筛选" value={license} onChange={(event) => { setLicense(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none focus:border-pink-400">
              <option value="">全部授权</option><option value="commercial">允许商业使用</option><option value="cc0">CC0 / 公共领域</option>
            </select>
          </div>
        </div>

        {error ? <div role="alert" className="mt-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setRevision(r => r + 1)} className="font-semibold">重试</button></div> : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? Array.from({ length: 6 }, (_, index) => <ResultSkeleton key={index} />) : items.map((asset) => (
            <article key={asset.id} className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/60">
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => togglePreview(asset)} aria-label={playingId === asset.id ? `暂停 ${asset.title}` : `播放 ${asset.title}`} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${playingId === asset.id ? 'bg-pink-600 text-white' : 'bg-slate-950 text-white group-hover:bg-pink-600'}`}>
                  {playingId === asset.id ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold" title={asset.title}>{asset.title}</h3><p className="mt-1 truncate text-xs text-slate-400">{asset.creator}</p></div>
                <span className="text-xs tabular-nums text-slate-400">{formatDuration(asset.durationMs)}</span>
              </div>
              <div className="my-5 flex h-10 min-w-0 items-end gap-1 overflow-hidden rounded-lg bg-slate-50 px-3 py-2" aria-hidden="true">
                {Array.from({ length: 28 }, (_, index) => <span key={index} className={`min-w-0 flex-1 rounded-full transition ${playingId === asset.id ? 'bg-pink-400' : 'bg-slate-300'}`} style={{ height: `${20 + ((index * 37 + asset.id.charCodeAt(0)) % 75)}%` }} />)}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{sourceName(asset.source)}</span><span className="truncate rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">{asset.license}</span></div>
                <button type="button" onClick={() => setSelected(asset)} className="shrink-0 text-xs font-semibold text-slate-600 hover:text-pink-600">查看详情</button>
              </div>
            </article>
          ))}
        </div>

        {!loading && !error && items.length === 0 ? <div className="py-24 text-center"><SpeakerWaveIcon className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-4 font-semibold">没有找到匹配素材</h3><p className="mt-2 text-sm text-slate-400">试试更短的英文关键词，或取消时长与授权筛选。</p></div> : null}
        <div className="mt-6 flex justify-center gap-4">
          <button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>第 {page} 页</span>
          <button disabled={loading || !hasNext} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      </main>

      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" role="dialog" aria-modal="true" aria-label="音频素材详情" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.2em] text-pink-600">Asset detail</span><button type="button" onClick={() => setSelected(null)} aria-label="关闭详情" className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XMarkIcon className="h-5 w-5" /></button></div>
            <div className="mt-10 flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-950 to-slate-700 text-white"><MusicalNoteIcon className="h-10 w-10 opacity-80" /></div>
            <h2 className="mt-6 text-2xl font-bold leading-tight">{selected.title}</h2><p className="mt-2 text-sm text-slate-500">{selected.creator} · {sourceName(selected.source)}</p>
            <button type="button" onClick={() => togglePreview(selected)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 py-3 text-sm font-semibold text-white hover:bg-pink-700">{playingId === selected.id ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}{playingId === selected.id ? '暂停试听' : '试听素材'}</button>
            <dl className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-200 px-4 text-sm">
              <div className="flex justify-between gap-4 py-4"><dt className="text-slate-400">时长</dt><dd>{formatDuration(selected.durationMs)}</dd></div>
              <div className="flex justify-between gap-4 py-4"><dt className="text-slate-400">许可证</dt><dd className="text-right font-medium">{selected.license}</dd></div>
              <div className="flex justify-between gap-4 py-4"><dt className="text-slate-400">文件格式</dt><dd>{selected.fileType?.toUpperCase() || '未知'}</dd></div>
              <div className="flex justify-between gap-4 py-4"><dt className="text-slate-400">素材来源</dt><dd>{sourceName(selected.source)}</dd></div>
            </dl>
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800"><strong className="block">授权提醒</strong><span className="mt-1 block">聚合信息仅供检索参考。下载、发布或商用前，请在素材原页确认署名方式、使用范围及最新条款。</span></div>
            <p className="mt-6 break-words text-xs leading-5 text-slate-400">{selected.attribution}</p>
            <button type="button" onClick={() => onImport(selected)} className="mt-5 w-full rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700">核对授权并导入候选库</button>
            <p className="mt-2 text-xs leading-5 text-slate-500">{selected.fileNote || "导入来源提供的文件，NC / ND 或未知授权不会导入。"}</p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button type="button" onClick={copyPreviewUrl} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-semibold hover:bg-slate-50">{copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <ClipboardDocumentIcon className="h-4 w-4" />}{copied ? '已复制' : '复制链接'}</button>
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800">打开原页<ArrowTopRightOnSquareIcon className="h-4 w-4" /></a>
            </div>
            {selected.licenseUrl ? <a href={selected.licenseUrl} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-center gap-1 text-xs font-medium text-pink-600 hover:text-pink-700">查看许可证全文 <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /></a> : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
