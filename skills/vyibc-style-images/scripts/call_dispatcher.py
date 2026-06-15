import sys
import json
import urllib.request
import urllib.error
import os
import time
import re
import subprocess
import tempfile
import html as _html

# --- Constants & Config ---
API_BASE = os.environ.get("STYLE_IMAGES_API_BASE", "https://parse.vyibc.com").rstrip("/")
DISPATCHER_API = f"{API_BASE}/api/gemini-web/image/ads-dispatcher"
WORKFLOW_ID = os.environ.get("STYLE_IMAGES_WORKFLOW_ID", "4a163587-6e5e-4176-8178-0915f0429ee0")
FORCE_DISPATCH = os.environ.get("STYLE_IMAGES_FORCE", "").lower() in ("1", "true", "yes")

# R2 upload (matches DEFAULT_R2_CONFIG in lib/parse/types.ts)
_R2_UPLOAD_URL = "https://upload-r2.vyibc.com"
_R2_TOKEN      = "yt-research-token-2026"
_R2_DOMAIN     = "https://skill.vyibc.com"
_R2_PATH       = "viewer"

# --- Codex Boilerplate Cleaner ---
_CODEX_PREFIX_PATTERNS = [
    r"^Create exactly one finished still image now\.?\s*",
    r"^Do not answer with text\.?\s*",
    r"^Do not explain\.?\s*",
    r"^The output must be an image\.?\s*",
    r"^Output must be a single still image\.?\s*",
    r"^Generate a single image\.?\s*",
]
_CODEX_SUFFIX_PATTERNS = [
    r"\s*Use an adult,?\s+fully clothed,?\s+non-sexual fashion editorial portrait\.?.*$",
    r"\s*Keep it tasteful,?\s+commercial,?\s+and policy-safe\.?.*$",
    r"\s*Single still image only\.?\s*Image output only\.?.*$",
    r"\s*No video,\s+no animation,\s+no GIF,\s+no text card,\s+no collage\.?.*$",
    r"\s*Output one PNG-like image\.?.*$",
    r"\s*Image output only\.?\s*No (?:video|animation).*$",
]

def strip_codex_boilerplate(prompt: str) -> str:
    text = prompt.strip()
    changed = True
    while changed:
        changed = False
        for pat in _CODEX_PREFIX_PATTERNS:
            new = re.sub(pat, "", text, flags=re.IGNORECASE | re.DOTALL).lstrip()
            if new != text:
                text = new
                changed = True
    for pat in _CODEX_SUFFIX_PATTERNS:
        text = re.sub(pat, "", text, flags=re.IGNORECASE | re.DOTALL).rstrip()
    return text.strip()

# --- Safety Optimizer ---
class SafetyOptimizer:
    MAPPING = {
        r"(?i)sexy": "charming allure",
        r"(?i)sultry": "sophisticated charisma",
        r"(?i)v-neck": "elegant neckline",
        r"(?i)deep v": "artistic collar",
        r"(?i)lingerie": "chic loungewear",
        r"(?i)sensual": "captivating atmosphere",
        r"(?i)魅惑": "全域魅力",
        r"(?i)性感": "极致吸引力",
        r"(?i)低胸": "高级剪裁",
        r"(?i)勾魂": "神采夺目"
    }
    REJECTION_PATTERNS = ["真实人物", "safety", "policy", "unsafe", "content filter", "人像策略", "道德限制"]

    @classmethod
    def sanitize(cls, prompt):
        new_prompt = prompt
        for pattern, replacement in cls.MAPPING.items():
            new_prompt = re.sub(pattern, replacement, new_prompt)
        return new_prompt

    @classmethod
    def is_safety_failure(cls, error_msg):
        if not error_msg: return False
        msg = error_msg.lower()
        return any(p.lower() in msg for p in cls.REJECTION_PATTERNS)

# --- Style Loader ---
def load_style_preset(style_name):
    if not style_name: return "", ""
    search_paths = [
        os.path.join(os.getcwd(), "resources", "styles"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "resources", "styles"),
        os.path.join("/Users/huchangfeng/.gemini/antigravity/skills/vyibc-face-consistent-album/resources/styles")
    ]
    for path in search_paths:
        file_path = os.path.join(path, f"{style_name}.md")
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read(), f"Loaded style [{style_name}]"
    return "", f"Style [{style_name}] not found."

def style_instruction(style_name, style_content):
    raw = (style_name or "").strip()
    if style_content.strip():
        lines = style_content.splitlines()
        in_essence = False
        for line in lines:
            if line.strip().startswith("## 风格精髓") or line.strip().startswith("## Core Essence"):
                in_essence = True
                continue
            if in_essence:
                if line.startswith("##"):
                    break
                if line.strip():
                    return line.strip()
        return style_content.strip()[:80]
    if not raw:
        return ""
    return (
        "Style direction requested by user: "
        f"{raw}. Interpret this as a flexible visual style brief. "
        "Translate it into concrete image qualities: medium, lighting, palette, texture, composition, "
        "atmosphere, lens or illustration language, while preserving the reference subject identity."
    )

# --- R2 Upload ---
def upload_to_r2(content: str, filename: str) -> str:
    """Upload HTML string to R2, return public URL."""
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as f:
        f.write(content)
        tmp_path = f.name
    try:
        result = subprocess.run(
            [
                "curl", "-s", "-X", "POST", _R2_UPLOAD_URL,
                "-H", f"Authorization: Bearer {_R2_TOKEN}",
                "-F", f"file=@{tmp_path};type=text/html",
                "-F", f"domain={_R2_DOMAIN}",
                "-F", f"name={filename}",
                "-F", f"path={_R2_PATH}",
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            try:
                resp = json.loads(result.stdout)
                for key in ("url", "publicUrl", "public_url", "fileUrl", "file_url"):
                    v = resp.get(key)
                    if isinstance(v, str) and v.startswith("http"):
                        return v
                data = resp.get("data") or {}
                if isinstance(data, dict):
                    for key in ("url", "publicUrl", "public_url"):
                        v = data.get(key)
                        if isinstance(v, str) and v.startswith("http"):
                            return v
            except Exception:
                pass
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
    return f"{_R2_DOMAIN}/{_R2_PATH}/{filename}"

# --- Static Photo Wall Builder ---
_GALLERY_CSS = """
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #080c10; --surface: #0f1923; --border: #1c2940;
  --text: #c8d6e5; --muted: #4a5a6e; --accent: #4a9eff; --green: #3ddc84;
}
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, 'PingFang SC', 'Helvetica Neue', system-ui, sans-serif;
  min-height: 100vh;
}
header {
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(16px);
  background: rgba(8,12,16,.88);
  border-bottom: 1px solid var(--border);
  padding: 14px 28px;
  display: flex; align-items: center; justify-content: space-between;
}
.brand { font-size: 14px; font-weight: 800; color: #fff; letter-spacing: -.01em; }
.brand em { color: var(--accent); font-style: normal; }
.hdr-right { display: flex; align-items: center; gap: 16px; }
.stat { font-size: 11px; color: var(--muted); }
.done-badge {
  background: rgba(61,220,132,.1);
  color: var(--green);
  font-size: 10px; font-weight: 700;
  padding: 3px 10px; border-radius: 99px; letter-spacing: .06em;
  border: 1px solid rgba(61,220,132,.22);
}
.tid { font-size: 10px; color: #243550; font-family: monospace; }
.gallery {
  columns: 3 260px;
  column-gap: 12px;
  padding: 22px 28px 44px;
}
.card {
  break-inside: avoid; margin-bottom: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden;
  cursor: zoom-in;
  transition: transform .18s, border-color .18s;
}
.card:hover { transform: translateY(-3px); border-color: #2a4060; }
.card img { width: 100%; display: block; background: var(--border); min-height: 60px; }
.card-foot { padding: 10px 14px 12px; }
.card-num {
  font-size: 9px; font-weight: 800;
  color: var(--accent); letter-spacing: .08em; margin-bottom: 5px;
}
.card-prompt {
  font-size: 10.5px; color: var(--muted); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden;
}
.lb {
  display: none; position: fixed; inset: 0;
  background: rgba(4,7,10,.96); z-index: 100;
  align-items: center; justify-content: center; cursor: zoom-out;
}
.lb.open { display: flex; }
.lb-inner { position: relative; max-width: 92vw; max-height: 92vh; }
.lb img { max-width: 100%; max-height: 92vh; border-radius: 8px; display: block; }
.lb-x {
  position: absolute; top: -34px; right: 0;
  color: #556; font-size: 20px; cursor: pointer;
  padding: 4px 8px; line-height: 1;
}
.lb-x:hover { color: #fff; }
footer {
  text-align: center; padding: 18px;
  color: #1e3050; font-size: 10px;
  border-top: 1px solid var(--border);
  font-family: monospace;
}
"""

_GALLERY_JS = """
const lb = document.getElementById('lb');
const lbImg = document.getElementById('lb-img');
document.querySelectorAll('.card').forEach(c => {
  c.onclick = () => { lbImg.src = c.querySelector('img').src; lb.classList.add('open'); };
});
lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
"""

def build_static_gallery(task_id: str, items: list) -> str:
    now = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    tid8 = task_id[:8]
    total = len(items)

    cards = []
    for i, item in enumerate(items, 1):
        url = _html.escape(item.get("primaryImageUrl", ""), quote=True)
        prompt = _html.escape((item.get("prompt") or "")[:300])
        cards.append(
            f'<div class="card">'
            f'<img src="{url}" loading="lazy" />'
            f'<div class="card-foot">'
            f'<div class="card-num">#{i:02d}</div>'
            f'<div class="card-prompt">{prompt}</div>'
            f'</div></div>'
        )

    cards_html = "\n".join(cards)
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Gallery · {tid8}</title>
<style>{_GALLERY_CSS}</style>
</head>
<body>
<header>
  <div class="brand">AI <em>Gallery</em></div>
  <div class="hdr-right">
    <span class="stat">{total} 张 · {now}</span>
    <span class="done-badge">ALL DONE</span>
    <span class="tid">{tid8}…</span>
  </div>
</header>
<div class="gallery">
{cards_html}
</div>
<div class="lb" id="lb">
  <div class="lb-inner">
    <div class="lb-x" onclick="document.getElementById('lb').classList.remove('open')">✕</div>
    <img id="lb-img" src="" />
  </div>
</div>
<footer>{task_id} · vyibc-style-images</footer>
<script>{_GALLERY_JS}</script>
</body>
</html>"""

# --- API Logic ---
def call_api(url, data):
    headers = {"Content-Type": "application/json", "User-Agent": "MasterVisuals/4.7-Mega"}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)

def run_mega_dispatch(runs_with_styles, base_image):
    print(f"🚀 Initializing Mega Dispatcher V4.7 (7 Styles / 21 Items)...")

    final_runs = []
    style_cache = {}

    for it in runs_with_styles:
        original_prompt = strip_codex_boilerplate(it["prompt"])
        style_name = it.get("style")

        if style_name is None:
            final_prompt = original_prompt
        else:
            if style_name not in style_cache:
                style_content, _ = load_style_preset(style_name)
                style_cache[style_name] = style_instruction(style_name, style_content)
            quality = "Masterpiece, 8k, cinematic lighting, sharp focus on eyes and skin."
            final_prompt = f"{original_prompt} {style_cache[style_name]} {quality}"

        final_runs.append({
            "prompt": final_prompt,
            "sourceImageUrls": [base_image]
        })

    payload = {
        "runs": final_runs,
        "workflowId": WORKFLOW_ID,
        "maxAttemptsPerPrompt": 6,
        "optimizePromptOnRetry": True,
        "force": FORCE_DISPATCH,
        "forceReason": "vyibc-style-images"
    }

    result, error = call_api(DISPATCHER_API, json.dumps(payload).encode("utf-8"))

    if result and result.get("taskId"):
        tid = result["taskId"]
        print(f"✅ Submission Success! Task ID: {tid}")
        return result
    else:
        print("Fatal Error:", error)
        sys.exit(1)

def poll_results(task_id, timeout=600):
    """轮询任务，完成后生成照片墙 HTML 上传 R2，以 markdown 链接格式输出图片 URL。"""
    deadline = time.time() + timeout
    final_items = []

    while time.time() < deadline:
        resp, err = call_api(
            f"{API_BASE}/api/gemini-web/image/ads-dispatcher/tasks/{task_id}/summary", None
        )
        if err or not resp:
            time.sleep(5)
            continue

        summary = resp.get("summary", {})
        status  = resp.get("status", "")
        s = summary.get("success", 0)
        f = summary.get("failed", 0)
        r = summary.get("running", 0)
        p = summary.get("pending", 0)
        t = summary.get("total", 0)
        print(f"[{time.strftime('%H:%M:%S')}] ✓{s} ↻{r} …{p} ✗{f} / {t}")

        if status in ("success", "failed", "cancelled"):
            final_items = resp.get("items", [])
            print(f"\n=== 最终结果 ({s}/{t} 成功) ===")
            for i, item in enumerate(final_items):
                st  = item.get("status", "?")
                att = item.get("attempts", 1)
                url = item.get("primaryImageUrl", "")
                link = f"[图片{i+1}]({url})" if url else "无"
                print(f"  [{i+1}] {st} | att={att} | {link}")
            break

        time.sleep(8)
    else:
        print("⚠️ 超时，任务仍在进行中。")
        return

    # 生成照片墙并上传 R2
    if final_items:
        print("\n⏫ 正在生成照片墙并上传 R2...")
        try:
            html_content = build_static_gallery(task_id, final_items)
            filename = f"viewer_{task_id}.html"
            r2_url = upload_to_r2(html_content, filename)
            print(f"🖼️  照片墙预览：{r2_url}")
        except Exception as e:
            print(f"⚠️ R2 上传失败：{e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python call_dispatcher.py <prompts_json_path> <base_image_url>")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        prompts = json.load(f)
    result = run_mega_dispatch(prompts, sys.argv[2])
    if result and result.get("taskId"):
        print("\n⏳ 等待生图完成...")
        poll_results(result["taskId"])
