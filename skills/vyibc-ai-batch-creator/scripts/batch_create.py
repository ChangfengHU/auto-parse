import sys
import json
import urllib.request
import urllib.error
import os
import time

# --- Constants & Config ---
API_BASE = os.getenv("VYIBC_API_BASE", "https://parse.vyibc.com")
DISPATCHER_API = f"{API_BASE}/api/gemini-web/image/ads-dispatcher"

# --- HTML Template (Batch Progress Viewer) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>AI Batch Creation Progress</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; }
        .success-glow { box-shadow: 0 0 20px rgba(16, 185, 129, 0.2); }
    </style>
</head>
<body class="p-8">
    <div class="max-w-6xl mx-auto">
        <header class="mb-10 flex justify-between items-center">
            <div>
                <h1 class="text-3xl font-black tracking-tight text-white">批量出图任务</h1>
                <p class="text-slate-400 text-sm mt-1">Task ID: <span class="font-mono text-cyan-400">{{TASK_ID}}</span></p>
            </div>
            <div id="status-card" class="glass px-6 py-3 text-right">
                <p id="overall-status" class="text-xs font-bold uppercase tracking-wider text-slate-500">正在同步状态...</p>
                <div class="flex gap-4 mt-1">
                    <span class="text-emerald-400 font-bold" id="count-success">0</span>
                    <span class="text-blue-400 font-bold" id="count-running">0</span>
                    <span class="text-rose-400 font-bold" id="count-failed">0</span>
                </div>
            </div>
        </header>

        <div id="grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"></div>
    </div>

    <script>
        const TASK_ID = "{{TASK_ID}}";
        const API_URL = "https://parse.vyibc.com/api/gemini-web/image/ads-dispatcher/tasks/" + TASK_ID + "/summary";

        async function poll() {
            try {
                const res = await fetch(API_URL);
                const data = await res.json();
                render(data);
                if (data.done) {
                    document.getElementById("overall-status").innerText = "任务已完成";
                    document.getElementById("overall-status").classList.add("text-emerald-400");
                } else {
                    document.getElementById("overall-status").innerText = "生成中...";
                }
            } catch (e) { console.error(e); }
        }

        function render(data) {
            const grid = document.getElementById("grid");
            const items = data.items || [];
            
            let success = 0, running = 0, failed = 0;
            items.forEach(it => {
                if(it.status === 'success') success++;
                if(it.status === 'running' || it.status === 'pending') running++;
                if(it.status === 'failed') failed++;
            });
            
            document.getElementById("count-success").innerText = success + " DONE";
            document.getElementById("count-running").innerText = running + " RUNNING";
            document.getElementById("count-failed").innerText = failed + " FAILED";

            if (grid.children.length !== items.length) {
                grid.innerHTML = "";
                items.forEach((it, i) => grid.appendChild(createCard(it, i)));
            } else {
                items.forEach((it, i) => updateCard(grid.children[i], it));
            }
        }

        function createCard(item, i) {
            const div = document.createElement("div");
            div.className = "glass overflow-hidden flex flex-col group transition-all hover:scale-[1.02]";
            div.innerHTML = `
                <div class="aspect-square bg-slate-800 relative overflow-hidden">
                    <div class="img-container w-full h-full flex items-center justify-center">
                        <span class="text-4xl font-bold text-slate-700">#${i+1}</span>
                    </div>
                    <div class="status-badge absolute top-2 right-2 px-2 py-1 text-[10px] font-bold rounded uppercase"></div>
                </div>
                <div class="p-4 flex-grow">
                    <p class="text-xs text-slate-400 line-clamp-3 italic">"${item.prompt}"</p>
                </div>
            `;
            updateCard(div, item);
            return div;
        }

        function updateCard(card, item) {
            const imgContainer = card.querySelector(".img-container");
            const badge = card.querySelector(".status-badge");
            
            if (item.primaryImageUrl && !card.dataset.loaded) {
                imgContainer.innerHTML = `<img src="${item.primaryImageUrl}" class="w-full h-full object-cover">`;
                card.dataset.loaded = "true";
                card.classList.add("success-glow");
            }

            badge.innerText = item.status;
            let theme = "bg-slate-700 text-slate-400";
            if (item.status === "success") theme = "bg-emerald-500 text-slate-900";
            if (item.status === "running") theme = "bg-blue-600 text-white animate-pulse";
            if (item.status === "failed") theme = "bg-rose-600 text-white";
            badge.className = "status-badge absolute top-2 right-2 px-2 py-1 text-[10px] font-bold rounded uppercase " + theme;
        }

        setInterval(poll, 5000);
        poll();
    </script>
</body>
</html>
"""

def call_api(url, data):
    headers = {"Content-Type": "application/json", "User-Agent": "BatchCreator/1.0"}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)

def main():
    if len(sys.argv) < 2:
        print("Usage: python batch_create.py <prompts_json_or_text> [source_image_url]")
        sys.exit(1)

    input_data = sys.argv[1]
    source_image_url = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Parse prompts
    prompts = []
    if input_data.startswith("[") or input_data.startswith("{"):
        try:
            parsed = json.loads(input_data)
            if isinstance(parsed, list):
                prompts = parsed
            elif isinstance(parsed, dict) and "prompts" in parsed:
                prompts = parsed["prompts"]
        except:
            prompts = [input_data]
    elif os.path.exists(input_data):
        with open(input_data, "r") as f:
            content = f.read()
            try:
                prompts = json.loads(content)
            except:
                prompts = [line.strip() for line in content.split("\n") if line.strip()]
    else:
        prompts = [line.strip() for line in input_data.split("\n") if line.strip()]

    if not prompts:
        print("Error: No prompts found.")
        sys.exit(1)

    print(f"📦 Starting batch creation for {len(prompts)} prompts...")

    runs = []
    for p in prompts:
        run = {"prompt": p}
        if source_image_url:
            run["sourceImageUrls"] = [source_image_url]
        runs.append(run)

    payload = {
        "runs": runs,
        "maxAttemptsPerPrompt": 3,
        "force": True,
        "forceReason": "batch-creation-v1"
    }

    result, error = call_api(DISPATCHER_API, json.dumps(payload).encode("utf-8"))

    if result and result.get("taskId"):
        tid = result["taskId"]
        print(f"✅ Submission Success! Task ID: {tid}")
        
        # Generate viewer
        html = HTML_TEMPLATE.replace("{{TASK_ID}}", tid)
        viewer_path = os.path.join(os.getcwd(), f"batch_viewer_{tid}.html")
        with open(viewer_path, "w", encoding="utf-8") as f:
            f.write(html)
        
        print(f"🌐 Progress Viewer: file://{viewer_path}")
        print(f"🔗 API Status: {API_BASE}/ads-dispatcher/{tid}")
    else:
        print(f"❌ API Error: {error}")
        sys.exit(1)

if __name__ == "__main__":
    main()
