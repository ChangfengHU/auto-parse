#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/auto-parse"
APP_PORT="${APP_PORT:-1007}"
APP_LOG="/tmp/auto-parse-dev.log"
APP_PID_FILE="/tmp/auto-parse-dev.pid"
VNC_URL="https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote"

log() { echo "[$(date '+%F %T')] $*"; }

port_up() {
  local port="$1"
  ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"
}

ensure_kfmclient_shim() {
  if command -v kfmclient >/dev/null 2>&1; then
    return 0
  fi
  cat >/usr/local/bin/kfmclient <<'EOF'
#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "exec" ]]; then shift; fi
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$@" >/dev/null 2>&1 && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio open "$@" >/dev/null 2>&1 && exit 0; fi
SUNBROWSER="/home/adspower/.config/adspower_global/cwd_global/chrome_142/SunBrowser"
if [[ -x "${SUNBROWSER}" ]]; then "${SUNBROWSER}" --no-sandbox --disable-dev-shm-usage "$@" >/dev/null 2>&1 & disown || true; exit 0; fi
exit 0
EOF
  chmod +x /usr/local/bin/kfmclient
  log "已补齐 kfmclient 兼容命令"
}

fix_env_vnc_url() {
  local env_file="${APP_DIR}/.env.local"
  [[ -f "${env_file}" ]] || return 0
  if grep -q '^NEXT_PUBLIC_DEBUG_VNC_URL=' "${env_file}"; then
    sed -i 's#^NEXT_PUBLIC_DEBUG_VNC_URL=.*#NEXT_PUBLIC_DEBUG_VNC_URL=https://parseweb.vyibc.com/vnc.html?path=websockify\&autoconnect=1\&reconnect=1\&resize=remote#' "${env_file}"
  else
    echo 'NEXT_PUBLIC_DEBUG_VNC_URL=https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote' >> "${env_file}"
  fi
}

ensure_vnc_stack() {
  mkdir -p /tmp/reboot-init
  if [[ ! -S /tmp/.X11-unix/X1 ]]; then
    nohup Xvfb :1 -screen 0 1280x800x24 >/tmp/reboot-init/xvfb.log 2>&1 &
    sleep 1
    log "已启动 Xvfb :1"
  fi

  if ! pgrep -u root -f '^openbox$' >/dev/null 2>&1; then
    nohup env DISPLAY=:1 openbox >/tmp/reboot-init/openbox.log 2>&1 &
    sleep 1
    log "已启动 openbox"
  fi

  if ! port_up 5900; then
    nohup x11vnc -display :1 -nopw -forever -shared -rfbport 5900 >/tmp/reboot-init/x11vnc.log 2>&1 &
    sleep 1
    log "已启动 x11vnc :5900"
  fi

  # 清理重复 websockify 进程（保留最早一个）
  mapfile -t ws_pids < <(pgrep -f '/usr/local/bin/websockify --web=/usr/share/novnc 1006 localhost:5900' || true)
  if (( ${#ws_pids[@]} > 1 )); then
    for ((i=1; i<${#ws_pids[@]}; i++)); do
      kill "${ws_pids[$i]}" 2>/dev/null || true
    done
    sleep 1
  fi

  if ! port_up 1006 && ! pgrep -f '/usr/local/bin/websockify --web=/usr/share/novnc 1006 localhost:5900' >/dev/null 2>&1; then
    nohup /usr/local/bin/websockify --web=/usr/share/novnc 1006 localhost:5900 >/tmp/reboot-init/websockify.log 2>&1 &
    sleep 1
    log "已启动 websockify :1006"
  fi
}

cleanup_stale_root_adspower() {
  ps -eo pid,user,cmd | awk '$2=="root" && $0 ~ /\/opt\/AdsPower Global\// {print $1}' >/tmp/reboot-init/adspower-root-pids.txt
  while read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill "${pid}" 2>/dev/null || true
  done </tmp/reboot-init/adspower-root-pids.txt
}

ensure_adspower_services() {
  systemctl daemon-reload
  systemctl enable --now adspower-global.service
  systemctl enable --now adspower-instance-autostart.timer
  systemctl start adspower-instance-autostart.service || true
}

ensure_app() {
  if curl -fsS -m 4 "http://127.0.0.1:${APP_PORT}/image-generate" >/dev/null 2>&1; then
    log "项目已在 ${APP_PORT} 端口运行"
    return 0
  fi

  if [[ -f "${APP_PID_FILE}" ]]; then
    old_pid="$(cat "${APP_PID_FILE}" || true)"
    if [[ -n "${old_pid}" ]] && ps -p "${old_pid}" >/dev/null 2>&1; then
      kill "${old_pid}" 2>/dev/null || true
      sleep 1
    fi
  fi

  cd "${APP_DIR}"
  nohup env DISPLAY=:1 BROWSER_HEADLESS=false npm run dev >"${APP_LOG}" 2>&1 &
  echo $! >"${APP_PID_FILE}"
  sleep 4
  log "已启动项目开发服务（PID $(cat "${APP_PID_FILE}")）"
}

health_check() {
  echo "====== HEALTH ======"
  curl -sS -m 5 http://127.0.0.1:50325/status || true
  echo
  for id in k1b908rw k1b8yqxe k1ba8vac; do
    echo "[${id}]"
    curl -sS -m 8 "http://127.0.0.1:50325/api/v1/browser/active?user_id=${id}" || true
    echo
    sleep 1
  done
  echo "[local app]"
  local local_app
  local_app="$(curl -sS -m 5 "http://127.0.0.1:${APP_PORT}/image-generate" || true)"
  echo "${local_app:0:80}"
  echo
  echo "[public app]"
  local public_app
  public_app="$(curl -sS -m 8 "https://parses.vyibc.com/image-generate" || true)"
  echo "${public_app:0:80}"
  echo
  echo "[public vnc]"
  curl -sS -m 8 "${VNC_URL}" | grep -q 'noVNC' && echo "noVNC ok" || echo "noVNC check failed"
}

main() {
  ensure_kfmclient_shim
  fix_env_vnc_url
  ensure_vnc_stack
  cleanup_stale_root_adspower
  ensure_adspower_services
  ensure_app
  health_check
  log "重启恢复完成"
}

main "$@"
