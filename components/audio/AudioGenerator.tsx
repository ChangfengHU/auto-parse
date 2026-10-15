"use client";
import { useRef, useState } from "react";
import {
  studioApi,
  type AudioQuote,
  type StudioCapabilities,
} from "@/lib/audio-studio";
const field =
  "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:outline-pink-500";
type Pending = { requestId: string; body: Record<string, unknown> };
export default function AudioGenerator({
  capabilities,
  onSubmitted,
}: {
  capabilities: StudioCapabilities;
  onSubmitted: () => Promise<void>;
}) {
  const [model, setModel] = useState("elevenlabs/music-v2");
  const [title, setTitle] = useState("温暖轻松的日常配乐");
  const [prompt, setPrompt] = useState(
    "Warm lighthearted instrumental background music for a daily-life comedy, soft piano and pizzicato strings, no vocals, gentle ending.",
  );
  const [seconds, setSeconds] = useState(15);
  const [tags, setTags] = useState("温馨, 日常");
  const [loop, setLoop] = useState(false);
  const [quote, setQuote] = useState<AudioQuote | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [recovered, setRecovered] = useState(false);
  const lock = useRef(false);
  const provider = capabilities.providers.find((p) => p.id === model);
  const body = {
    model,
    title,
    prompt,
    seconds,
    tags: tags
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
    loop,
  };
  function invalidate() {
    setQuote(null);
    setConfirmed(false);
  }
  async function getQuote() {
    setBusy(true);
    setError("");
    try {
      setQuote(await studioApi<AudioQuote>("quote", body));
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "报价失败");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || (!pending && (!quote || !confirmed))) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const request = pending || {
      requestId: crypto.randomUUID(),
      body: { ...body, confirmPaid: true, maxCostUsd: quote!.estimatedUsd },
    };
    setPending(request);
    sessionStorage.setItem(
      "audio-pending-generation-v1",
      JSON.stringify(request),
    );
    try {
      await studioApi("generate", {
        ...request.body,
        requestId: request.requestId,
      });
      sessionStorage.removeItem("audio-pending-generation-v1");
      setPending(null);
      invalidate();
      await onSubmitted();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "提交未确认"}。请求 ID：${request.requestId}。请先查任务；只使用此 ID 重试。`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Recover only on a user event; prompts are not sent until explicitly resumed.
  function recover() {
    const stored = sessionStorage.getItem("audio-pending-generation-v1");
    setRecovered(true);
    if (stored) {
      try {
        const r = JSON.parse(stored) as Pending;
        if (r.requestId && r.body) setPending(r);
      } catch {
        setError("暂存请求无法读取，请在任务列表核对，不要盲目新建");
      }
    }
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
      <p className="text-xs font-semibold tracking-widest text-pink-600">
        PAID FALLBACK
      </p>
      <h2 className="mt-2 text-2xl font-bold">缺的那段声音，再生成</h2>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        先查素材库。确认报价后才调用；生成结果进入候选区，不自动认定音质或版权通过。
      </p>
      {!recovered ? (
        <button
          onClick={recover}
          className="mt-4 text-sm font-medium text-pink-700 underline"
        >
          检查是否有上次未确认的提交
        </button>
      ) : null}
      <fieldset
        disabled={busy || !!pending}
        className="mt-6 grid gap-5 disabled:opacity-60 sm:grid-cols-2"
      >
        <label className="text-sm sm:col-span-2">
          生成线路
          <select
            className={field}
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setLoop(false);
              invalidate();
            }}
          >
            {capabilities.providers
              .filter((p) => p.id.includes("/"))
              .map((p) => (
                <option key={p.id} value={p.id} disabled={!p.ready}>
                  {p.name}
                  {!p.ready ? " · 暂不可用" : ""}
                </option>
              ))}
          </select>
          <span className="mt-2 block text-xs text-slate-500">
            {provider?.note}
          </span>
        </label>
        <label className="text-sm">
          素材标题
          <input
            className={field}
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className="text-sm">
          时长（秒）
          <input
            className={field}
            type="number"
            min={3}
            max={model === "elevenlabs/sound-effects" ? 30 : 120}
            value={seconds}
            disabled={model === "minimax/music-2.6"}
            onChange={(e) => {
              setSeconds(Number(e.target.value));
              invalidate();
            }}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          描述需求
          <textarea
            className={`${field} min-h-32`}
            value={prompt}
            minLength={10}
            maxLength={2000}
            onChange={(e) => {
              setPrompt(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          标签
          <input
            className={field}
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
              invalidate();
            }}
          />
        </label>
        {model === "elevenlabs/sound-effects" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => {
                setLoop(e.target.checked);
                invalidate();
              }}
            />
            请求循环音效（仍需试听验收）
          </label>
        ) : (
          <p className="text-xs text-slate-500 sm:col-span-2">
            音乐强制纯音乐生成；无人声与循环质量仍需人工试听。
          </p>
        )}
      </fieldset>
      <p className="mt-5 text-xs text-slate-500">
        每日预算 ${capabilities.dailyBudgetUsd.toFixed(2)} · 今日已预留 $
        {capabilities.reservedTodayUsd.toFixed(4)}（UTC 日界；未知结果仍占预算）
      </p>
      {quote ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold">
            本次预估 ${quote.estimatedUsd.toFixed(4)} USD · {quote.duration}
          </p>
          <p className="mt-2 text-xs leading-5 text-amber-900">
            不含{quote.excludes}。保存为私有内部资产。
          </p>
          <label className="mt-3 flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!!pending}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我确认本次费用，并同意生成后先验收
          </label>
        </div>
      ) : null}
      {pending ? (
        <p className="mt-4 break-all rounded-xl bg-amber-50 p-4 text-sm">
          已有未确认请求 {pending.requestId}
          。先查看任务列表；下方只重发同一请求，不新建订单。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 break-words text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={getQuote}
          disabled={busy || !!pending || !provider?.ready}
          className="rounded-xl border px-5 py-3 text-sm font-semibold disabled:opacity-40"
        >
          获取报价（不扣费）
        </button>
        <button
          onClick={submit}
          disabled={busy || (!pending && (!quote || !confirmed || !recovered))}
          className="rounded-xl bg-pink-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy
            ? "处理中…"
            : pending
              ? "使用原请求 ID 核对提交"
              : "确认付费生成"}
        </button>
      </div>
    </section>
  );
}
