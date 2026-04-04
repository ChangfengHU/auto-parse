#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "playwright",
#     "requests"
# ]
# ///
"""
Meta AI 生图/生视频 节点执行脚本
供 doouyin 的 Node.js 工作流直接调用。
执行结束后会在 stdout 最后一行打印 JSON 格式的文件路径数组。
用法: uv run metaai_generate.py --prompt "..." --output-dir "/tmp/metaai" --json
"""
import os
import sys
import argparse
import time
import json
from datetime import datetime
import requests

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print(json.dumps({"error": "缺少 playwright"}))
    sys.exit(1)

DEFAULT_OUTPUT_DIR = os.path.expanduser("~/Downloads/meta_ai")
DEFAULT_PROFILE_ID = os.getenv("ADS_PROFILE_ID", "k1aomp3q")
DEFAULT_API_KEY    = os.getenv("ADS_API_KEY", "")
DEFAULT_API_URL    = os.getenv("ADS_API_URL", "http://local.adspower.net:50325")

def get_cdp_url(profile_id: str, api_key: str, api_url: str = DEFAULT_API_URL) -> str:
    headers = {"Authorization": f"Bearer {api_key}"}
    for endpoint in ["/api/v1/browser/active", "/api/v1/browser/start"]:
        try:
            r = requests.get(f"{api_url}{endpoint}", params={"user_id": profile_id}, headers=headers, timeout=30)
            if r.status_code == 200 and r.text.strip():
                data = r.json()
                if data.get("code") == 0:
                    ws = data["data"]["ws"]
                    cdp = ws.get("puppeteer") or (f"ws://{ws['selenium']}" if ws.get("selenium") else None)
                    if cdp:
                        return cdp
        except Exception:
            pass
    raise RuntimeError("无法获取 AdsPower CDP 地址")


def submit_prompt(page, prompt: str) -> tuple[str, int]:
    page.wait_for_timeout(3000)
    initial_count = page.locator('[aria-label="Download"]').count()

    try:
        vid_btn = page.locator('div[role="button"]:has-text("Create video"), span:has-text("Create video")').first
        if vid_btn.count() > 0:
            vid_btn.click(force=True)
            page.wait_for_timeout(1000)
    except:
        pass

    input_box = page.locator('[data-testid="composer-input"]').first
    if input_box.count() > 0:
        input_box.fill(prompt, force=True)
        page.wait_for_timeout(500)

        send_btn = page.locator('button[aria-label="Send message"], button:has(svg circle)').first
        if send_btn.count() > 0:
            send_btn.click(force=True)
        else:
            page.keyboard.press("Enter")
    else:
        raise RuntimeError("未找到输入框 [data-testid='composer-input']")

    start_time = time.time()
    prompt_url = ""
    while time.time() - start_time < 30:
        current_url = page.url
        if "/prompt/" in current_url:
            prompt_url = current_url
            break
        page.wait_for_timeout(1000)
        
    if not prompt_url:
        raise RuntimeError("等待专属 URL 跳转超时！")
        
    return prompt_url, initial_count


def wait_and_download(page, initial_count: int, output_dir: str):
    page.wait_for_timeout(60_000)
    current_count = page.locator('[aria-label="Download"]').count()
    if current_count < initial_count + 4:
        page.wait_for_timeout(30_000)
        current_count = page.locator('[aria-label="Download"]').count()

    os.makedirs(output_dir, exist_ok=True)
    buttons = page.locator('[aria-label="Download"]').all()
    new_buttons_qty = current_count - initial_count
    qty_to_download = max(4, new_buttons_qty) if new_buttons_qty > 0 else 4
    
    recent_buttons = buttons[-qty_to_download:] if len(buttons) >= qty_to_download else buttons

    saved = []
    for i, btn in enumerate(recent_buttons, 1):
        try:
            btn.evaluate("el => el.scrollIntoView({block: 'center'})")
            page.wait_for_timeout(500)
            with page.expect_download(timeout=15_000) as dl_info:
                btn.evaluate("el => el.click()")
            dl = dl_info.value
            ts = datetime.now().strftime("%H%M%S")
            dest = os.path.join(output_dir, f"AI_{ts}_{dl.suggested_filename}")
            dl.save_as(dest)
            saved.append(dest)
            page.wait_for_timeout(500)
        except Exception:
            pass
    return saved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--profile-id", default=DEFAULT_PROFILE_ID)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--json", action="store_true", help="严格 JSON 输出")
    args = parser.parse_args()

    if not args.api_key:
        print(json.dumps({"error": "缺少 ADS_API_KEY"}))
        sys.exit(1)

    try:
        cdp_url = get_cdp_url(args.profile_id, args.api_key, args.api_url)
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0]
            context.set_default_timeout(15_000)
            page = context.new_page()

            page.goto("https://meta.ai", wait_until="domcontentloaded", timeout=40_000)
            prompt_url, initial_count = submit_prompt(page, args.prompt)
            saved = wait_and_download(page, initial_count, args.output_dir)
            page.close()

        # 最后一行输出 JSON 数组
        if args.json:
            print(json.dumps({"files": saved}))
        else:
            print("\n".join(saved))
            
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
