import sys
import json
import urllib.request
import urllib.error
import os
import re

# --- Constants & Config ---
API_BASE = os.getenv("VYIBC_API_BASE", "https://parse.vyibc.com")
DISPATCHER_API = f"{API_BASE}/api/gemini-web/image/ads-dispatcher"

# --- Style / Preset Loader ---
def load_preset(preset_name):
    """
    从 resources/presets 目录加载预置 Prompt 段落
    """
    paths = [
        os.path.join(os.getcwd(), "resources", "presets"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "resources", "presets")
    ]
    for p in paths:
        file_path = os.path.join(p, f"{preset_name}.md")
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read().strip()
    return ""

# --- HTML Template (Professional Model Sheet Viewer) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>Character Model Sheet Viewer v1.0</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Space Grotesk', sans-serif; background: #0a0a0c; color: #eee; }
        .blueprint-grid {
            background-image: 
                linear-gradient(to right, rgba(40, 40, 50, 0.5) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(40, 40, 50, 0.5) 1px, transparent 1px);
            background-size: 40px 40px;
        }
        .glass-panel { background: rgba(20, 20, 25, 0.8); backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.05); }
        .accent-border { border-left: 4px solid #3b82f6; }
    </style>
</head>
<body class="blueprint-grid min-h-screen p-8">
    <div class="max-w-7xl mx-auto">
        <header class="mb-12 flex justify-between items-start">
            <div class="accent-border pl-6">
                <h1 class="text-4xl font-bold tracking-tighter uppercase italic">Character Asset v1.0</h1>
                <p class="text-blue-400 font-mono text-xs mt-1">INTERNAL MODEL SHEET // REF: {{TASK_ID}}</p>
            </div>
            <div class="glass-panel px-6 py-4 rounded-xl text-right">
                <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Status</p>
                <p id="overall-status" class="text-lg font-bold text-blue-500 animate-pulse">GENERATING BLUEPRINT...</p>
            </div>
        </header>

        <main id="container" class="space-y-12">
            <!-- Result will be injected here -->
            <div id="result-area" class="hidden">
                 <div class="glass-panel rounded-3xl overflow-hidden shadow-2xl transition-all hover:scale-[1.01]">
                    <img id="main-image" src="" class="w-full h-auto object-contain">
                 </div>
                 <div class="mt-8 grid grid-cols-3 gap-6">
                    <div class="glass-panel p-6 rounded-2xl">
                        <h3 class="text-xs font-bold text-slate-500 uppercase mb-2">Subject Context</h3>
                        <p id="prompt-snippet" class="text-sm font-light text-slate-300 italic"></p>
                    </div>
                    <div class="glass-panel p-6 rounded-2xl">
                        <h3 class="text-xs font-bold text-slate-500 uppercase mb-2">Reference Angles</h3>
                        <div class="flex gap-2">
                            <span class="px-2 py-1 bg-blue-900/30 text-blue-400 text-[10px] rounded border border-blue-500/30">FRONT</span>
                            <span class="px-2 py-1 bg-blue-900/30 text-blue-400 text-[10px] rounded border border-blue-500/30">SIDE</span>
                            <span class="px-2 py-1 bg-blue-900/30 text-blue-400 text-[10px] rounded border border-blue-500/30">BACK</span>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <script>
        const TASK_ID = "{{TASK_ID}}";
        const API_URL = "https://parse.vyibc.com/api/gemini-web/image/ads-dispatcher/tasks/" + TASK_ID + "/summary";

        async function poll() {
            try {
                const res = await fetch(API_URL);
                const data = await res.json();
                
                if (data.items && data.items.length > 0) {
                    const item = data.items[0];
                    if (item.status === 'success' && item.primaryImageUrl) {
                        document.getElementById("main-image").src = item.primaryImageUrl;
                        document.getElementById("prompt-snippet").innerText = item.prompt;
                        document.getElementById("result-area").classList.remove("hidden");
                        document.getElementById("overall-status").innerText = "ASSET SECURED";
                        document.getElementById("overall-status").classList.remove("animate-pulse", "text-blue-500");
                        document.getElementById("overall-status").classList.add("text-emerald-500");
                    } else if (item.status === 'failed') {
                        document.getElementById("overall-status").innerText = "ASSET CORRUPTED";
                        document.getElementById("overall-status").classList.add("text-rose-500");
                    }
                }
            } catch (e) { console.error(e); }
        }

        setInterval(poll, 4000);
        poll();
    </script>
</body>
</html>
"""

def call_api(url, data):
    headers = {"Content-Type": "application/json", "User-Agent": "ModelSheetGenerator/1.0"}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)

def run_gen(image_url, preset_name):
    # 加载专家级专家预置
    preset_content = load_preset(preset_name or "realistic_standard")
    
    # 工业级核心关键词锁
    core_locking = "Character model sheet, orthographic turnaround, standing, full body, multiple views showing front and side and back, consistent clothing and facial features, centered, white background, detailed anatomy, masterpiece, high resolution."
    
    # 如果 preset 里已经有了，就不重复加
    final_prompt = f"{core_locking} {preset_content}"

    print(f"🧬 Initializing Professional Model Sheet Generation...")
    print(f"🔍 Preset: {preset_name or 'Default'}")

    payload = {
        "runs": [
            {
                "prompt": final_prompt,
                "sourceImageUrls": [image_url]
            }
        ],
        "workflowId": "4a163587-6e5e-4176-8178-0915f0429ee0", # 复用成熟的工作流 ID
        "maxAttemptsPerPrompt": 5,
        "force": True,
        "forceReason": f"model-sheet-asset-gen-{preset_name}"
    }

    result, error = call_api(DISPATCHER_API, json.dumps(payload).encode("utf-8"))

    if result and result.get("taskId"):
        tid = result["taskId"]
        print(f"✅ Submission Success! Task ID: {tid}")
        
        # 保存查看器
        html = HTML_TEMPLATE.replace("{{TASK_ID}}", tid)
        viewer_path = f"model_sheet_viewer_{tid}.html"
        with open(viewer_path, "w", encoding="utf-8") as f:
            f.write(html)
        
        print(f"🌐 Pro Viewer: file://{os.getcwd()}/{viewer_path}")
        return result
    else:
        print(f"❌ API Error: {error}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python model_sheet_gen.py <image_url> [preset_name]")
        sys.exit(1)
        
    img = sys.argv[1]
    pst = sys.argv[2] if len(sys.argv) > 2 else "realistic_standard"
    run_gen(img, pst)
