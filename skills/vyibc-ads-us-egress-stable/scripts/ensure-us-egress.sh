#!/usr/bin/env bash
set -euo pipefail

ADS_API="${ADS_API:-http://127.0.0.1:50325}"
TARGET_IDS_CSV="${TARGET_IDS_CSV:-k1b908rw,k1b8yqxe,k1ba8vac}"
PROXY_HOST="${PROXY_HOST:-direct.miyaip.online}"
PROXY_PORT="${PROXY_PORT:-8001}"
PROXY_USER="${PROXY_USER:-sqzaceacxr}"
PROXY_PASS="${PROXY_PASS:-orwmoyumoopmoot}"
MAX_RETRY="${MAX_RETRY:-3}"
PERSIST_AUTOSTART="${PERSIST_AUTOSTART:-1}"

log() { echo "[$(date '+%F %T')] $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }
}

urlencode_json() {
  local json="$1"
  python3 - <<PY
import urllib.parse
print(urllib.parse.quote("""$json"""))
PY
}

wait_api() {
  local i=0
  while (( i < 20 )); do
    if curl -fsS -m 3 "${ADS_API}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

update_proxy_config() {
  local id="$1"
  local body
  body="$(jq -n \
    --arg user_id "${id}" \
    --arg proxy_host "${PROXY_HOST}" \
    --arg proxy_port "${PROXY_PORT}" \
    --arg proxy_user "${PROXY_USER}" \
    --arg proxy_password "${PROXY_PASS}" \
    --arg proxy_url "http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}" \
    '{
      user_id:$user_id,
      ipchecker:"ip2location",
      user_proxy_config:{
        proxy_soft:"other",
        proxy_type:"http",
        proxy_host:$proxy_host,
        proxy_port:$proxy_port,
        proxy_user:$proxy_user,
        proxy_password:$proxy_password,
        proxy_url:$proxy_url
      }
    }')"
  curl -sS -m 20 -X POST "${ADS_API}/api/v1/user/update" -H 'Content-Type: application/json' -d "${body}" >/dev/null
}

stop_profile() {
  local id="$1"
  curl -sS -m 12 "${ADS_API}/api/v1/browser/stop?user_id=${id}" >/dev/null || true
}

start_profile_forced_proxy() {
  local id="$1"
  local launch_json launch_enc
  launch_json="$(jq -nc \
    --arg proxy_server "--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}" \
    '["--no-sandbox","--disable-dev-shm-usage",$proxy_server,"--proxy-bypass-list=<-loopback>","--disable-quic"]')"
  launch_enc="$(urlencode_json "${launch_json}")"
  curl -sS -m 25 "${ADS_API}/api/v1/browser/start?user_id=${id}&launch_args=${launch_enc}" >/dev/null
}

get_ws() {
  local id="$1"
  curl -sS -m 12 "${ADS_API}/api/v1/browser/active?user_id=${id}" | jq -r '.data.ws.puppeteer // empty'
}

get_browser_ip() {
  local ws="$1"
  node - <<'NODE' "${ws}"
const { chromium } = require('/root/auto-parse/node_modules/playwright');
const ws = process.argv[2];
(async()=>{
  const b = await chromium.connectOverCDP(ws);
  const c = b.contexts()[0];
  const p = c.pages()[0] || await c.newPage();
  await p.goto('https://api.ipify.org?format=json',{waitUntil:'domcontentloaded',timeout:45000});
  const raw = ((await p.textContent('body'))||'').trim();
  await b.close();
  try {
    const j = JSON.parse(raw);
    process.stdout.write((j.ip || '').trim());
  } catch {
    process.stdout.write('');
  }
})().catch(()=>{ process.stdout.write(''); process.exit(2); });
NODE
}

ip_country_code() {
  local ip="$1"
  curl -sS -m 15 "http://ip-api.com/json/${ip}?fields=status,countryCode" | jq -r '.countryCode // ""'
}

ensure_one_us() {
  local id="$1"
  local attempt=1
  while (( attempt <= MAX_RETRY )); do
    log "[${id}] attempt ${attempt}/${MAX_RETRY}"
    update_proxy_config "${id}"
    stop_profile "${id}"
    sleep 1
    start_profile_forced_proxy "${id}"
    sleep 4

    local ws ip cc
    ws="$(get_ws "${id}")"
    if [[ -z "${ws}" ]]; then
      log "[${id}] no ws, retrying"
      attempt=$((attempt + 1))
      continue
    fi
    ip="$(get_browser_ip "${ws}")"
    if [[ -z "${ip}" ]]; then
      log "[${id}] no ip, retrying"
      attempt=$((attempt + 1))
      continue
    fi
    cc="$(ip_country_code "${ip}")"
    log "[${id}] ip=${ip} country=${cc:-unknown}"
    if [[ "${cc}" == "US" ]]; then
      return 0
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

escape_sed() {
  printf '%s' "$1" | sed -e 's/[&@]/\\&/g'
}

persist_autostart_policy() {
  local svc="/etc/systemd/system/adspower-instance-autostart.service"
  local ensure_script="/usr/local/bin/adspower-ensure-instances.sh"
  local ids launch_csv
  ids="${TARGET_IDS_CSV}"
  launch_csv="--no-sandbox,--disable-dev-shm-usage,--proxy-server=http://${PROXY_HOST}:${PROXY_PORT},--proxy-bypass-list=<-loopback>,--disable-quic"

  if [[ -f "${svc}" ]]; then
    if grep -q '^Environment=ADS_INSTANCE_IDS=' "${svc}"; then
      sed -i "s@^Environment=ADS_INSTANCE_IDS=.*@Environment=ADS_INSTANCE_IDS=$(escape_sed "${ids}")@" "${svc}"
    else
      printf '\nEnvironment=ADS_INSTANCE_IDS=%s\n' "${ids}" >> "${svc}"
    fi
    if grep -q '^Environment=ADS_LAUNCH_ARGS_CSV=' "${svc}"; then
      sed -i "s@^Environment=ADS_LAUNCH_ARGS_CSV=.*@Environment=ADS_LAUNCH_ARGS_CSV=$(escape_sed "${launch_csv}")@" "${svc}"
    else
      printf 'Environment=ADS_LAUNCH_ARGS_CSV=%s\n' "${launch_csv}" >> "${svc}"
    fi
  fi

  if [[ -f "${ensure_script}" ]]; then
    sed -i "s@^ADS_INSTANCE_IDS=.*@ADS_INSTANCE_IDS=\"\${ADS_INSTANCE_IDS:-$(escape_sed "${ids}")}\"@" "${ensure_script}"
    sed -i "s@^ADS_LAUNCH_ARGS_CSV=.*@ADS_LAUNCH_ARGS_CSV=\"\${ADS_LAUNCH_ARGS_CSV:---no-sandbox,--disable-dev-shm-usage,--proxy-server=http://$(escape_sed "${PROXY_HOST}"):$(escape_sed "${PROXY_PORT}"),--proxy-bypass-list=<-loopback>,--disable-quic}\"@" "${ensure_script}"
  fi

  systemctl daemon-reload
}

main() {
  need_cmd curl
  need_cmd jq
  need_cmd node
  need_cmd python3

  if ! wait_api; then
    echo "Ads API not ready: ${ADS_API}" >&2
    exit 1
  fi

  IFS=',' read -r -a ids <<< "${TARGET_IDS_CSV}"
  local rc=0
  for raw in "${ids[@]}"; do
    id="$(echo "${raw}" | xargs)"
    [[ -z "${id}" ]] && continue
    if ! ensure_one_us "${id}"; then
      rc=1
      log "[${id}] failed to get US egress"
    fi
  done

  if [[ "${PERSIST_AUTOSTART}" == "1" ]]; then
    persist_autostart_policy
    systemctl restart adspower-instance-autostart.service || true
  fi

  for raw in "${ids[@]}"; do
    id="$(echo "${raw}" | xargs)"
    [[ -z "${id}" ]] && continue
    ws="$(get_ws "${id}")"
    if [[ -n "${ws}" ]]; then
      ip="$(get_browser_ip "${ws}")"
      cc="$(ip_country_code "${ip:-}")"
      echo "${id}: ${ip:-unknown} (${cc:-unknown})"
    else
      echo "${id}: no ws"
    fi
  done

  exit "${rc}"
}

main "$@"

