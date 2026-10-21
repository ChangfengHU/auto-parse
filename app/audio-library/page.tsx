"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AudioAsset } from "@/lib/audio-assets";
import {
  studioApi,
  mediaUrl,
  durationLabel,
  jobLabels,
  type StudioAsset,
  type StudioJob,
  type StudioCapabilities,
} from "@/lib/audio-studio";
const SourceSearch = dynamic(
  () => import("@/components/audio/AudioSourceSearch"),
  { loading: () => <p className="p-8 text-slate-500">正在加载素材搜索…</p> },
);
const AssetEditor = dynamic(
  () => import("@/components/audio/AudioAssetEditor"),
);
const Generator = dynamic(() => import("@/components/audio/AudioGenerator"));
type Tab = "library" | "explore" | "generate" | "jobs";
type SourceResult = {
  id: string;
  kind: "music" | "sound_effect";
  title: string;
  creator: string;
  previewUrl: string;
  sourceUrl: string;
  license: string;
  provider: "wikimedia";
};
const button =
  "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium transition hover:border-pink-300 disabled:opacity-40";
const input =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-pink-500";

export default function AudioLibraryPage() {
  const [tab, setTab] = useState<Tab>("library");
  const [caps, setCaps] = useState<StudioCapabilities | null>(null);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<StudioAsset | null>(null);
  const [importing, setImporting] = useState(false);
  const importLock = useRef(false);
  const [importChoice, setImportChoice] = useState<{
    id: string;
    kind: string;
    title: string;
    sourceUrl: string;
    license: string;
    provider: "openverse" | "wikimedia";
  } | null>(null);
  const [importRights, setImportRights] = useState(false);
  const importRequest = useRef<string | null>(null);
  const authenticated = !!caps;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/audio/studio/session", { signal: controller.signal })
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setCaps(data.capabilities);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  const refreshLibrary = useCallback(
    async (signal?: AbortSignal) => {
      const data = await studioApi<{ items: StudioAsset[]; total: number }>(
        "library",
        {
          q: searchQ,
          kind: kind || undefined,
          status: status || undefined,
          page,
        },
        signal,
      );
      setAssets(data.items);
      setTotal(data.total);
    },
    [searchQ, kind, status, page],
  );
  const refreshJobs = useCallback(async (signal?: AbortSignal) => {
    const [data, capabilities] = await Promise.all([
      studioApi<{ jobs: StudioJob[] }>("jobs", {}, signal),
      studioApi<StudioCapabilities>("capabilities", {}, signal),
    ]);
    setJobs(data.jobs);
    setCaps(capabilities);
  }, []);
  useEffect(() => {
    if (!authenticated || !["library", "jobs"].includes(tab)) return;
    const controller = new AbortController();
    setLoading(true);
    (tab === "library"
      ? refreshLibrary(controller.signal)
      : refreshJobs(controller.signal)
    )
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authenticated, tab, refreshLibrary, refreshJobs]);
  const activeJobs = jobs.some((j) =>
    ["queued", "generating", "saving"].includes(j.status),
  );
  useEffect(() => {
    if (!authenticated || tab !== "jobs" || !activeJobs) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      refreshJobs(controller.signal).catch(() => {});
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [authenticated, tab, activeJobs, refreshJobs]);
  async function login(e: FormEvent) {
    e.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      const r = await fetch("/api/audio/studio/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCaps(data.capabilities);
      setToken("");
      setNotice("已连接私有工作室，8 小时后需要重新连接。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      setConnecting(false);
    }
  }
  async function logout() {
    await fetch("/api/audio/studio/session", { method: "DELETE" });
    setCaps(null);
    setAssets([]);
    setJobs([]);
    setSelected(null);
    setImportChoice(null);
    setNotice("已断开连接");
  }
  async function changed() {
    await refreshLibrary();
    if (selected)
      setSelected(
        await studioApi<StudioAsset>("get_asset", { id: selected.id }),
      );
  }
  async function submitted() {
    await refreshJobs();
    setTab("jobs");
    setNotice("任务已保存。完成后请到候选区试听、标记并验收。");
  }
  function chooseImport(
    asset: AudioAsset | SourceResult,
    provider: "openverse" | "wikimedia",
  ) {
    if (!authenticated) {
      setTab("library");
      setError("请先连接私有工作室，再导入候选库");
      return;
    }
    setImportRights(false);
    importRequest.current = crypto.randomUUID();
    setImportChoice({ ...asset, provider });
  }
  async function importAsset() {
    if (importLock.current || !importChoice || !importRights) return;
    importLock.current = true;
    setImporting(true);
    setError("");
    const requestId = importRequest.current!;
    try {
      await studioApi("import", {
        requestId,
        provider: importChoice.provider,
        sourceId: importChoice.id,
        kind: importChoice.kind,
        tags: [],
        rightsAcknowledged: true,
      });
      setImportChoice(null);
      await submitted();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "导入失败"}。重试会复用请求 ${requestId}`,
      );
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  }
  async function reuse(asset: StudioAsset) {
    const purpose = window.prompt(
      "这次用于什么视频或场景？",
      asset.scene || "",
    );
    if (!purpose?.trim()) return;
    try {
      await studioApi("use_asset", {
        id: asset.id,
        requestId: crypto.randomUUID(),
        purpose,
      });
      const link = document.createElement("a");
      link.href = mediaUrl(asset.id, true);
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      await refreshLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "复用失败");
    }
  }
  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-8 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.2em] text-pink-600">
                AUDIO STUDIO · PRIVATE LIBRARY
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                让好声音，越用越多
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                先复用，找不到再生成。背景音乐与音效统一保存、标记、验收；页面与
                MCP 共用一套能力。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p
                className={
                  authenticated ? "text-emerald-700" : "text-slate-500"
                }
              >
                {checking
                  ? "检查连接…"
                  : authenticated
                    ? "● 私有工作室已连接"
                    : "○ 未连接私有工作室"}
              </p>
              {caps ? (
                <>
                  <p className="mt-2 text-xs text-slate-500">
                    今日预留 ${caps.reservedTodayUsd.toFixed(4)} / $
                    {caps.dailyBudgetUsd.toFixed(2)}
                  </p>
                  <button onClick={logout} className="mt-3 text-xs underline">
                    断开连接
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <nav
            aria-label="音频工作室"
            className="mt-7 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1"
          >
            {(
              [
                ["library", "我的素材库"],
                ["explore", "发现素材"],
                ["generate", "按需生成"],
                ["jobs", "任务记录"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setError("");
                }}
                aria-current={tab === id ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-2.5 text-sm font-semibold sm:px-5 ${tab === id ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-10">
        {error ? (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <span className="break-words">{error}</span>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mb-5 flex justify-between gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"
          >
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        ) : null}
        {!authenticated && tab !== "explore" ? (
          <section className="grid gap-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-9 lg:grid-cols-2">
            <div>
              <h2 className="text-xl font-bold">连接你的私有声音库</h2>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                开放素材可以直接搜索试听。保存素材、生成付费音频与访问私有文件，需要工作室访问密钥。
              </p>
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-500">
                密钥保存在金库 <code>service:auto-parse-audio</code> 的{" "}
                <code>accessToken</code> 字段。这不是 Cloudflare
                管理密钥。浏览器仅使用 HttpOnly 会话，不把密钥写入本地存储。
              </p>
              <button
                onClick={() => setTab("explore")}
                className={`${button} mt-5`}
              >
                先浏览开放素材 →
              </button>
            </div>
            <form onSubmit={login} className="self-center">
              <label className="block text-sm font-medium" htmlFor="studio-key">
                工作室访问密钥
              </label>
              <input
                id="studio-key"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={`${input} mt-3 w-full`}
                placeholder="从金库读取，不要粘贴 CF 管理令牌"
                required
              />
              <button
                disabled={connecting || checking || !token}
                className="mt-4 w-full rounded-xl bg-pink-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {connecting ? "验证中…" : "连接工作室"}
              </button>
            </form>
          </section>
        ) : null}
        {authenticated && tab === "library" ? (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">我的素材库</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {total} 份素材 · 候选需验收，已入库可复用；所有文件保持私有。
                </p>
              </div>
              <button
                onClick={() => {
                  setStatus("candidate");
                  setPage(1);
                }}
                className={button}
              >
                查看待验收
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearchQ(q);
                setPage(1);
              }}
              className="mb-6 flex flex-wrap gap-3"
            >
              <input
                aria-label="搜索私有素材"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="标题、标签、场景、情绪"
                className={`${input} w-full min-w-0 basis-full sm:w-auto sm:flex-1 sm:basis-auto`}
              />
              <select
                aria-label="素材类型"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(1);
                }}
                className={input}
              >
                <option value="">全部类型</option>
                <option value="music">背景音乐</option>
                <option value="sound_effect">音效</option>
              </select>
              <select
                aria-label="验收状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className={input}
              >
                <option value="">全部状态</option>
                <option value="candidate">待验收</option>
                <option value="approved">已入库</option>
                <option value="rejected">不采用</option>
              </select>
              <button className={button}>搜索库</button>
            </form>
            {selected ? (
              <div className="mb-6">
                <AssetEditor
                  key={selected.id}
                  asset={selected}
                  onClose={() => setSelected(null)}
                  onChanged={changed}
                />
              </div>
            ) : null}
            {loading ? (
              <p role="status" className="py-12 text-center text-slate-500">
                加载私有素材…
              </p>
            ) : !assets.length ? (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
                <h3 className="text-lg font-semibold">
                  {total ? "这一页没有素材" : "从第一份可复用的声音开始"}
                </h3>
                <p className="mt-3 text-sm text-slate-500">
                  导入授权素材，或生成一段专属配乐。试听满意后，再标记入库。
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <button className={button} onClick={() => setTab("explore")}>
                    发现素材
                  </button>
                  <button className={button} onClick={() => setTab("generate")}>
                    按需生成
                  </button>
                </div>
              </section>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => (
                  <article
                    key={asset.id}
                    className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 break-words font-semibold">
                        {asset.title}
                      </h3>
                      <span
                        className={`shrink-0 rounded-md px-2 py-1 text-xs ${asset.status === "approved" ? "bg-emerald-50 text-emerald-700" : asset.status === "candidate" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-500"}`}
                      >
                        {asset.status === "approved"
                          ? "已入库"
                          : asset.status === "candidate"
                            ? "待验收"
                            : "不采用"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {asset.kind === "music" ? "背景音乐" : "音效"} ·{" "}
                      {durationLabel(asset.duration_ms)} · 已复用 {asset.uses}{" "}
                      次
                    </p>
                    <audio
                      controls
                      preload="none"
                      src={mediaUrl(asset.id)}
                      className="mt-5 w-full"
                    />
                    <div className="mt-4 flex min-h-6 flex-wrap gap-1.5">
                      {asset.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 truncate text-xs text-slate-400">
                      {asset.source} · {asset.license}
                    </p>
                    <div className="mt-5 flex gap-3">
                      <button
                        onClick={() => setSelected(asset)}
                        className="text-sm font-semibold text-pink-700"
                      >
                        标签与验收
                      </button>
                      <button
                        disabled={asset.status !== "approved"}
                        onClick={() => reuse(asset)}
                        className="text-sm font-semibold text-slate-700 disabled:text-slate-300"
                      >
                        记录用途并下载
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {total > 24 ? (
              <div className="mt-6 flex items-center justify-center gap-4">
                <button
                  className={button}
                  disabled={page <= 1}
                  onClick={() => setPage((x) => x - 1)}
                >
                  上一页
                </button>
                <span className="text-sm">第 {page} 页</span>
                <button
                  className={button}
                  disabled={page * 24 >= total}
                  onClick={() => setPage((x) => x + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {tab === "explore" ? (
          <SourceSearch onImport={(asset) => chooseImport(asset, asset.provider || "wikimedia")} />
        ) : null}
        {authenticated && tab === "generate" && caps ? (
          <Generator capabilities={caps} onSubmitted={submitted} />
        ) : null}
        {authenticated && tab === "jobs" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">任务与费用记录</h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  最近 50 条 · 运行中每 5 秒更新 ·
                  未知结果不会自动重新扣费；费用为预留估算，以账单为准。
                </p>
              </div>
              <button
                className={button}
                onClick={() => refreshJobs().catch((e) => setError(e.message))}
              >
                刷新
              </button>
            </div>
            {loading ? (
              <p className="mt-6 text-sm">加载任务…</p>
            ) : !jobs.length ? (
              <p className="py-14 text-center text-sm text-slate-400">
                还没有任务。导入或确认生成后会显示在这里。
              </p>
            ) : (
              <div className="mt-6 space-y-3">
                {jobs.map((job) => (
                  <article
                    key={job.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-3">
                      <h3 className="break-words text-sm font-semibold">
                        {job.payload.title ||
                          job.payload.sourceId ||
                          job.operation}
                      </h3>
                      <span
                        className={`text-xs ${job.status === "completed" ? "text-emerald-700" : job.status === "needs_review" || job.status === "failed" ? "text-red-700" : "text-amber-700"}`}
                      >
                        {jobLabels[job.status] || job.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      预留 ${(job.reserved_micros / 1e6).toFixed(4)} ·{" "}
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                    <p className="mt-2 break-all font-mono text-[10px] text-slate-400">
                      {job.id}
                    </p>
                    {job.error ? (
                      <p className="mt-3 text-xs leading-5 text-red-700">
                        {job.error}
                      </p>
                    ) : null}
                    {job.asset_id ? (
                      <button
                        onClick={async () => {
                          try {
                            setSelected(
                              await studioApi<StudioAsset>("get_asset", {
                                id: job.asset_id,
                              }),
                            );
                            setStatus("");
                            setTab("library");
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "读取失败",
                            );
                          }
                        }}
                        className="mt-3 text-sm font-semibold text-pink-700"
                      >
                        打开素材并验收 →
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {caps ? (
          <details className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              底层能力状态与使用边界
            </summary>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {caps.providers.map((p) => (
                <div key={p.id} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-medium">
                    {p.ready ? "●" : "○"} {p.name}{" "}
                    <span
                      className={
                        p.ready ? "text-emerald-600" : "text-amber-700"
                      }
                    >
                      {p.ready ? "已接入" : "未开放"}
                    </span>
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {p.note}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-6 text-slate-500">
              {caps.rights}
            </p>
          </details>
        ) : null}
      </main>
      {importChoice ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/40 p-5"
          role="dialog"
          aria-modal="true"
          aria-label="确认素材导入"
        >
          <section className="w-full max-w-lg rounded-2xl bg-white p-6">
            <h2 className="text-lg font-bold">核对授权后导入候选库</h2>
            <p className="mt-3 break-words text-sm">{importChoice.title}</p>
            <p className="mt-2 text-xs text-slate-500">
              {importChoice.license} ·
              保存当前来源提供的版本，并非都属于原始音质。
            </p>
            <a
              href={importChoice.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-sm text-pink-700 underline"
            >
              打开素材原页核对授权
            </a>
            <label className="mt-5 flex items-start gap-2 text-sm leading-6">
              <input
                type="checkbox"
                checked={importRights}
                onChange={(e) => setImportRights(e.target.checked)}
                className="mt-1"
              />
              我已核对来源允许下载及当前用途；导入不代表已完成试听验收。
            </label>
            <div className="mt-6 flex gap-3">
              <button
                className={button}
                disabled={importing}
                onClick={() => setImportChoice(null)}
              >
                取消
              </button>
              <button
                className="rounded-xl bg-pink-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
                disabled={importing || !importRights}
                onClick={importAsset}
              >
                {importing ? "保存任务…" : "确认导入（不生成扣费）"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
