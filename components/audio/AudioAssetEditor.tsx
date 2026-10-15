"use client";
import { useState } from "react";
import {
  studioApi,
  mediaUrl,
  durationLabel,
  type StudioAsset,
} from "@/lib/audio-studio";

const field =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-pink-500";
export default function AudioAssetEditor({
  asset,
  onClose,
  onChanged,
}: {
  asset: StudioAsset;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState(asset.title);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [scene, setScene] = useState(asset.scene);
  const [mood, setMood] = useState(asset.mood);
  const [bpm, setBpm] = useState(asset.bpm?.toString() || "");
  const [vocals, setVocals] = useState(asset.vocals);
  const [loop, setLoop] = useState(!!asset.loop_verified);
  const [quality, setQuality] = useState(!!asset.quality_confirmed);
  const [rights, setRights] = useState(!!asset.rights_confirmed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function save(decision?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await studioApi("update_asset", {
        id: asset.id,
        title,
        tags: tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        scene,
        mood,
        bpm: bpm ? Number(bpm) : null,
        vocals,
        loopVerified: loop,
      });
      if (decision)
        await studioApi("review_asset", {
          id: asset.id,
          decision,
          qualityConfirmed: quality,
          rightsConfirmed: rights,
        });
      await onChanged();
      setMessage(
        decision === "approved"
          ? "已验收入库，可以复用"
          : decision === "rejected"
            ? "已标记不采用"
            : "标签已保存",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-2xl border border-pink-200 bg-white p-5 sm:p-7"
      aria-label="素材验收与标签编辑"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-pink-600">
            REVIEW · 私有素材
          </p>
          <h2 className="mt-2 text-xl font-bold">试听、标记，再入库</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          关闭
        </button>
      </div>
      <audio
        key={asset.id}
        controls
        preload="metadata"
        src={mediaUrl(asset.id)}
        className="mt-5 w-full"
      />
      <p className="mt-2 text-xs text-slate-500">
        {durationLabel(asset.duration_ms)} · {asset.mime} ·{" "}
        {(asset.bytes / 1024 / 1024).toFixed(2)} MiB · {asset.source}
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          标题
          <input
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          标签（逗号分隔）
          <input
            className={field}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="搞笑, 反转, 办公室"
          />
        </label>
        <label className="text-sm">
          适用场景
          <input
            className={field}
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="text-sm">
          情绪
          <input
            className={field}
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="text-sm">
          BPM（未知可留空）
          <input
            className={field}
            type="number"
            min={20}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
          />
        </label>
        <label className="text-sm">
          人声
          <select
            className={field}
            value={vocals}
            onChange={(e) => setVocals(e.target.value)}
          >
            <option value="unknown">未检查</option>
            <option value="none">已试听：无人声</option>
            <option value="present">有人声</option>
          </select>
        </label>
      </div>
      <div className="mt-5 space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="mt-1"
          />
          已实际试听首尾衔接，确认可循环
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={quality}
            onChange={(e) => setQuality(e.target.checked)}
            className="mt-1"
          />
          已试听并确认音质、内容和用途匹配
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            className="mt-1"
          />
          已核对来源条款、署名及当前用途权限；不将此库作为第三方素材分发库
        </label>
      </div>
      <div className="mt-5 rounded-xl bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        <p>
          {asset.license} · {asset.rights_scope}
        </p>
        <p className="break-words">{asset.attribution}</p>
        <div className="flex gap-4">
          {asset.source_url ? (
            <a
              href={asset.source_url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              来源页
            </a>
          ) : null}
          {asset.license_url ? (
            <a
              href={asset.license_url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              授权条款
            </a>
          ) : null}
        </div>
      </div>
      {asset.prompt ? (
        <p className="mt-4 text-xs leading-5 text-slate-500">
          生成提示：{asset.prompt}
        </p>
      ) : null}
      <p className="mt-3 break-all font-mono text-[10px] text-slate-400">
        SHA256: {asset.sha256}
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-4 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          disabled={busy}
          onClick={() => save()}
          className="rounded-xl border px-4 py-2.5 text-sm disabled:opacity-40"
        >
          保存标签
        </button>
        <button
          disabled={busy || !quality || !rights}
          onClick={() => save("approved")}
          className="rounded-xl bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          验收通过并入库
        </button>
        <button
          disabled={busy}
          onClick={() => save("rejected")}
          className="rounded-xl px-4 py-2.5 text-sm text-slate-500 disabled:opacity-40"
        >
          不采用
        </button>
      </div>
    </section>
  );
}
