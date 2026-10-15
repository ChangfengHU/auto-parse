import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { parseBuffer } from "music-metadata";
import { type AudioEnv, generation, inputs, sha256 } from "./schema";
import {
  downloadAudio,
  readBounded,
  sourceById,
  type SourceAsset,
} from "./sources";
import type { Job } from "./core";

interface Receipt {
  asset: SourceAsset;
  url?: string;
  stagedKey?: string;
  model?: string;
  prompt?: string;
}
function findAudio(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== "object" || depth > 4) return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.audio === "string" && obj.audio.startsWith("https://"))
    return obj.audio;
  return findAudio(obj.result, depth + 1);
}
export class AudioJob extends WorkflowEntrypoint<AudioEnv, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const id = event.payload.jobId;
    try {
      const job = await step.do("load-job", async () => {
        const row = await this.env.DB.prepare("SELECT * FROM jobs WHERE id=?")
          .bind(id)
          .first<Job>();
        if (!row) throw new NonRetryableError("job_not_found");
        return row;
      });
      if (job.status === "completed") return { assetId: job.asset_id };
      // A paid request is never automatically retried, including after workflow replay.
      const receipt = await step.do(
        "obtain-audio-once",
        { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" },
        async (): Promise<Receipt> => {
          const current = await this.env.DB.prepare(
            "SELECT * FROM jobs WHERE id=?",
          )
            .bind(id)
            .first<Job>();
          if (current?.receipt) return JSON.parse(current.receipt) as Receipt;
          const claimed = await this.env.DB.prepare(
            "UPDATE jobs SET status='generating',updated_at=? WHERE id=? AND status='queued'",
          )
            .bind(new Date().toISOString(), id)
            .run();
          if (!claimed.meta.changes)
            throw new NonRetryableError("provider_result_unknown_do_not_retry");
          let receipt: Receipt;
          if (job.operation === "import") {
            const input = inputs.import.parse(JSON.parse(job.payload));
            const asset = await sourceById(
              input.provider,
              input.sourceId,
              input.kind,
            );
            receipt = {
              asset: {
                ...asset,
                tags: input.tags.length ? input.tags : asset.tags,
              },
              url: asset.previewUrl,
            };
          } else {
            const input = generation.parse(JSON.parse(job.payload));
            const isSfx = input.model === "elevenlabs/sound-effects";
            receipt = {
              model: input.model,
              prompt: input.prompt,
              asset: {
                id,
                provider: "openverse",
                kind: isSfx ? "sound_effect" : "music",
                title: input.title,
                creator: input.model,
                durationMs: null,
                previewUrl: "",
                source: isSfx ? "ElevenLabs API" : "Cloudflare AI",
                sourceUrl: isSfx
                  ? "https://elevenlabs.io/sound-effects"
                  : `https://developers.cloudflare.com/ai/models/${input.model}/`,
                license: "生成服务条款 · 仅内部库",
                licenseUrl: isSfx
                  ? "https://elevenlabs.io/terms-of-use"
                  : "https://elevenlabs.io/music-terms",
                attribution: `Generated with ${input.model}; internal asset library only`,
                tags: input.tags,
                fileNote: "生成文件原始字节；使用前人工验收并确认条款",
              },
            };
            if (input.model === "minimax/music-2.6")
              receipt.asset.licenseUrl =
                "https://www.minimax.io/terms-of-service";
            if (isSfx) {
              if (!this.env.ELEVENLABS_API_KEY)
                throw new NonRetryableError("sfx_not_configured");
              const r = await fetch(
                "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "xi-api-key": this.env.ELEVENLABS_API_KEY,
                  },
                  body: JSON.stringify({
                    text: input.prompt,
                    duration_seconds: input.seconds,
                    loop: input.loop,
                    model_id: "eleven_text_to_sound_v2",
                  }),
                  signal: AbortSignal.timeout(300000),
                },
              );
              const bytes = await readBounded(r);
              receipt.stagedKey = `staged/${id}`;
              await this.env.AUDIO.put(receipt.stagedKey, bytes, {
                httpMetadata: { contentType: "audio/mpeg" },
              });
            } else {
              const modelInput =
                input.model === "elevenlabs/music-v2"
                  ? {
                      prompt: input.prompt,
                      music_length_ms: input.seconds * 1000,
                      force_instrumental: true,
                      output_format: "mp3_48000_192",
                    }
                  : {
                      prompt: input.prompt,
                      is_instrumental: true,
                      lyrics_optimizer: false,
                    };
              // Unified AI's third-party model IDs can precede the generated Workers AI type catalog.
              const ai = this.env.AI as unknown as {
                run(
                  model: string,
                  input: Record<string, unknown>,
                ): Promise<unknown>;
              };
              const result = await ai.run(input.model, modelInput);
              const url = findAudio(result);
              if (!url)
                throw new NonRetryableError(
                  "provider_returned_no_audio_receipt",
                );
              receipt.url = url;
            }
          }
          await this.env.DB.prepare(
            "UPDATE jobs SET receipt=?,status='saving',updated_at=? WHERE id=?",
          )
            .bind(JSON.stringify(receipt), new Date().toISOString(), id)
            .run();
          return receipt;
        },
      );
      return await step.do(
        "save-and-index",
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "3 minutes",
        },
        async () => {
          const existing = await this.env.DB.prepare(
            "SELECT id FROM assets WHERE job_id=?",
          )
            .bind(id)
            .first<{ id: string }>();
          if (existing) {
            await this.env.DB.prepare(
              "UPDATE jobs SET status='completed',asset_id=?,updated_at=? WHERE id=?",
            )
              .bind(existing.id, new Date().toISOString(), id)
              .run();
            return { assetId: existing.id };
          }
          const staged = receipt.stagedKey
            ? await this.env.AUDIO.get(receipt.stagedKey)
            : null;
          const file = staged
            ? {
                bytes: new Uint8Array(await staged.arrayBuffer()),
                mime: staged.httpMetadata?.contentType || "audio/mpeg",
              }
            : await downloadAudio(receipt.url!);
          const metadata = await parseBuffer(
            file.bytes,
            { mimeType: file.mime || undefined, size: file.bytes.length },
            { duration: true, skipCovers: true },
          );
          const duration = metadata.format.duration;
          if (!duration || !Number.isFinite(duration) || duration <= 0)
            throw new NonRetryableError("audio_duration_unreadable");
          const mime =
            metadata.format.container === "WAVE"
              ? "audio/wav"
              : metadata.format.container === "FLAC"
                ? "audio/flac"
                : metadata.format.container?.includes("Ogg")
                  ? "audio/ogg"
                  : metadata.format.container === "MPEG"
                    ? "audio/mpeg"
                    : file.mime;
          if (!mime.startsWith("audio/"))
            throw new NonRetryableError("not_audio");
          const digest = await sha256(file.bytes);
          const key = `assets/${id}/original`;
          await this.env.AUDIO.put(key, file.bytes, {
            sha256: digest,
            httpMetadata: {
              contentType: mime,
              cacheControl: "private, no-store",
            },
          });
          const asset = receipt.asset;
          const now = new Date().toISOString();
          await this.env.DB.batch([
            this.env.DB.prepare(
              `INSERT OR IGNORE INTO assets(id,job_id,kind,title,tags,source,source_url,creator,license,license_url,attribution,prompt,model,cost_micros,object_key,sha256,mime,bytes,duration_ms,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ).bind(
              id,
              id,
              asset.kind,
              asset.title,
              JSON.stringify(asset.tags),
              asset.source,
              asset.sourceUrl,
              asset.creator,
              asset.license,
              asset.licenseUrl,
              `${asset.attribution}\n${asset.fileNote}`,
              receipt.prompt || null,
              receipt.model || null,
              job.reserved_micros,
              key,
              digest,
              mime,
              file.bytes.length,
              Math.round(duration * 1000),
              now,
            ),
            this.env.DB.prepare(
              "UPDATE jobs SET status='completed',asset_id=?,error=NULL,updated_at=? WHERE id=?",
            ).bind(id, now, id),
          ]);
          return {
            assetId: id,
            sha256: digest,
            durationMs: Math.round(duration * 1000),
          };
        },
      );
    } catch {
      await step.do("mark-needs-review", async () => {
        await this.env.DB.prepare(
          `UPDATE jobs SET status=CASE WHEN operation='generate' THEN 'needs_review' ELSE 'failed' END,
          error='未完成：请核对来源、媒体与上游结果。付费任务不自动重发；已预留费用保留至人工核账。',updated_at=? WHERE id=? AND status!='completed'`,
        )
          .bind(new Date().toISOString(), id)
          .run();
      });
      return { jobId: id, status: "needs_review" };
    }
  }
}
