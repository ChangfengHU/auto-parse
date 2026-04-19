import sys
import json
import os
import time
from pathlib import Path

# 将供应商目录添加到路径
XHS_CLI_ROOT = Path(__file__).parent.parent / "python" / "vendors" / "xiaohongshu_cli"
sys.path.append(str(XHS_CLI_ROOT))

# 从供应商工具中导入所需组件
try:
    from xhs_cli.client import XhsClient
    from xhs_cli.qr_login import (
        _generate_a1, 
        _generate_webid, 
        _apply_session_cookies, 
        _complete_confirmed_session,
        _resolved_user_id,
        _build_saved_cookies,
        QR_SCANNED,
        QR_CONFIRMED
    )
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"导入供应商模块失败: {str(e)}"}))
    sys.exit(1)

def create_qr():
    a1 = _generate_a1()
    webid = _generate_webid()
    tmp_cookies = {"a1": a1, "webId": webid}
    
    with XhsClient(tmp_cookies, request_delay=0) as client:
        try:
            activate_data = client.login_activate()
            _apply_session_cookies(client, activate_data)
        except Exception:
            pass # 激活失败非致命
            
        qr_data = client.create_qr_login()
        # 将必要的状态返回给前端
        result = {
            "ok": True,
            "qr_id": qr_data["qr_id"],
            "code": qr_data["code"],
            "url": qr_data["url"],
            "a1": a1,
            "webid": webid,
            "cookies": client.cookies
        }
        print(json.dumps(result))

def poll_qr(qr_id, code, a1, webid, initial_cookies):
    with XhsClient(initial_cookies, request_delay=0) as client:
        try:
            status_data = client.check_qr_status(qr_id, code)
            code_status = status_data.get("codeStatus", -1)
            
            result = {
                "ok": True,
                "status": code_status,
                "status_text": "waiting",
                "cookies": client.cookies # 每次轮询都返回最新 Cookie
            }
            
            if code_status == QR_SCANNED:
                result["status_text"] = "scanned"
            elif code_status == QR_CONFIRMED:
                confirmed_user_id = status_data.get("userId", "")
                if not confirmed_user_id:
                     print(json.dumps({"ok": False, "error": "确认登录但未返回用户 ID"}))
                     return

                completion_data = _complete_confirmed_session(
                    client,
                    qr_id,
                    code,
                    confirmed_user_id,
                )
                user_id = _resolved_user_id(completion_data) or confirmed_user_id
                final_cookies = _build_saved_cookies(a1, webid, client.cookies)
                
                result["status_text"] = "success"
                result["user_id"] = user_id
                result["cookies"] = final_cookies
            
            print(json.dumps(result))
            
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
        
    cmd = sys.argv[1]
    if cmd == "create":
        create_qr()
    elif cmd == "poll":
        if len(sys.argv) < 7:
            sys.exit(1)
        # python worker.py poll <qr_id> <code> <a1> <webid> <initial_cookies_json>
        poll_qr(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], json.loads(sys.argv[6]))
