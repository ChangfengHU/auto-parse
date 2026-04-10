#!/usr/bin/env bash
set -euo pipefail

ADS_API="${ADS_API:-http://127.0.0.1:50325}"
CACHE_BASE="${CACHE_BASE:-/home/adspower/.config/adspower_global/cwd_global/source/cache}"
LAUNCH_ARGS_JSON="${LAUNCH_ARGS_JSON:-[\"--no-sandbox\",\"--disable-dev-shm-usage\"]}"

SOURCE_ID="${SOURCE_ID:-}"
TARGETS_CSV="${TARGETS_CSV:-}"
COPY_LOGIN="${COPY_LOGIN:-1}"
COPY_PROXY="${COPY_PROXY:-1}"
START_AFTER="${START_AFTER:-1}"
VERIFY_IP="${VERIFY_IP:-1}"
PROXY_TYPE="${PROXY_TYPE:-http}"
PROXY_HOST="${PROXY_HOST:-}"
PROXY_PORT="${PROXY_PORT:-}"
PROXY_USER="${PROXY_USER:-}"
PROXY_PASSWORD="${PROXY_PASSWORD:-}"
PROXY_URL="${PROXY_URL:-}"

log() { echo "[$(date '+%F %T')] $*"; }

usage() {
  cat <<'EOF'
Usage:
  sync-state.sh --source-id <id> --targets <id1,id2,...> [options]

Options:
  --source-id <id>         母版分身ID（必填）
  --targets <csv>          目标分身ID列表（必填）
  --copy-login <0|1>       是否复制登录态，默认1
  --copy-proxy <0|1>       是否复制代理配置，默认1
  --start-after <0|1>      完成后是否自动启动，默认1
  --verify-ip <0|1>        是否校验真实出口IP，默认1
  --proxy-host <host>      指定目标代理host（可选，填了则不再从source复制）
  --proxy-port <port>      指定目标代理port
  --proxy-user <user>      指定目标代理账号
  --proxy-password <pass>  指定目标代理密码
  --proxy-type <type>      指定代理类型，默认http
  --proxy-url <url>        指定代理URL（可选）
  --ads-api <url>          Ads API地址，默认 http://127.0.0.1:50325
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-id) SOURCE_ID="$2"; shift 2 ;;
    --targets) TARGETS_CSV="$2"; shift 2 ;;
    --copy-login) COPY_LOGIN="$2"; shift 2 ;;
    --copy-proxy) COPY_PROXY="$2"; shift 2 ;;
    --start-after) START_AFTER="$2"; shift 2 ;;
    --verify-ip) VERIFY_IP="$2"; shift 2 ;;
    --proxy-host) PROXY_HOST="$2"; shift 2 ;;
    --proxy-port) PROXY_PORT="$2"; shift 2 ;;
    --proxy-user) PROXY_USER="$2"; shift 2 ;;
    --proxy-password) PROXY_PASSWORD="$2"; shift 2 ;;
    --proxy-type) PROXY_TYPE="$2"; shift 2 ;;
    --proxy-url) PROXY_URL="$2"; shift 2 ;;
    --ads-api) ADS_API="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${SOURCE_ID}" || -z "${TARGETS_CSV}" ]]; then
  usage
  exit 1
fi

mapfile -t TARGETS < <(echo "${TARGETS_CSV}" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | awk 'NF')
if [[ "${#TARGETS[@]}" -eq 0 ]]; then
  echo "targets empty" >&2
  exit 1
fi

fetch_user_list() {
  local i=1
  while (( i <= 5 )); do
    local j
    j="$(curl -sS -m 20 "${ADS_API}/api/v1/user/list?page_size=1000" || true)"
    if echo "${j}" | jq -e '.code == 0 and .data.list != null' >/dev/null 2>&1; then
      echo "${j}"
      return 0
    fi
    sleep "${i}"
    i=$((i + 1))
  done
  return 1
}

USER_LIST_JSON="$(fetch_user_list || true)"
if [[ -z "${USER_LIST_JSON}" ]]; then
  echo "failed to fetch user list from ${ADS_API}" >&2
  exit 1
fi

exists_profile() {
  local pid="$1"
  echo "${USER_LIST_JSON}" | jq -e --arg id "${pid}" '.data.list[] | select(.user_id==$id)' >/dev/null
}

for id in "${TARGETS[@]}"; do
  exists_profile "${id}" || { echo "target not exists: ${id}" >&2; exit 1; }
done
exists_profile "${SOURCE_ID}" || { echo "source not exists: ${SOURCE_ID}" >&2; exit 1; }

SOURCE_PROXY_JSON="$(echo "${USER_LIST_JSON}" | jq -c --arg id "${SOURCE_ID}" '.data.list[] | select(.user_id==$id) | .user_proxy_config')"
SOURCE_IPCHECKER="$(echo "${USER_LIST_JSON}" | jq -r --arg id "${SOURCE_ID}" '.data.list[] | select(.user_id==$id) | .ipchecker // "ip2location"')"

resolve_cache_dir() {
  local pid="$1"
  find "${CACHE_BASE}" -maxdepth 1 -type d -name "${pid}_*" | head -n 1
}

stop_profile() {
  local pid="$1"
  curl -sS -m 10 "${ADS_API}/api/v1/browser/stop?user_id=${pid}" >/dev/null || true
}

start_profile() {
  local pid="$1"
  local launch_enc
  launch_enc="$(python3 - <<PY
import urllib.parse, json
print(urllib.parse.quote(json.dumps(${LAUNCH_ARGS_JSON})))
PY
)"
  curl -sS -m 25 "${ADS_API}/api/v1/browser/start?user_id=${pid}&launch_args=${launch_enc}" || true
}

if [[ "${COPY_LOGIN}" == "1" ]]; then
  src_dir="$(resolve_cache_dir "${SOURCE_ID}")"
  if [[ -z "${src_dir}" ]]; then
    echo "source cache not found: ${SOURCE_ID}" >&2
    exit 1
  fi

  log "复制登录态：source=${SOURCE_ID} (${src_dir})"
  stop_profile "${SOURCE_ID}"
  for id in "${TARGETS[@]}"; do stop_profile "${id}"; done
  sleep 1

  for id in "${TARGETS[@]}"; do
    dst_dir="$(resolve_cache_dir "${id}")"
    if [[ -z "${dst_dir}" ]]; then
      log "跳过 ${id}：找不到缓存目录"
      continue
    fi
    backup_dir="${dst_dir}.bak.$(date +%s)"
    cp -a "${dst_dir}" "${backup_dir}"
    rm -rf "${dst_dir}"
    mkdir -p "${dst_dir}"
    rsync -a "${src_dir}/" "${dst_dir}/"
    chown -R adspower:adspower "${dst_dir}"
    log "已复制登录态 ${SOURCE_ID} -> ${id}"
  done
fi

if [[ "${COPY_PROXY}" == "1" ]]; then
  if [[ -n "${PROXY_HOST}" && -n "${PROXY_PORT}" ]]; then
    SOURCE_PROXY_JSON="$(jq -n \
      --arg proxy_soft "other" \
      --arg proxy_type "${PROXY_TYPE}" \
      --arg proxy_host "${PROXY_HOST}" \
      --arg proxy_port "${PROXY_PORT}" \
      --arg proxy_user "${PROXY_USER}" \
      --arg proxy_password "${PROXY_PASSWORD}" \
      --arg proxy_url "${PROXY_URL}" \
      '{proxy_soft:$proxy_soft,proxy_type:$proxy_type,proxy_host:$proxy_host,proxy_port:$proxy_port,proxy_user:$proxy_user,proxy_password:$proxy_password,proxy_url:$proxy_url}')"
    log "复制代理配置：使用显式代理 ${PROXY_HOST}:${PROXY_PORT}"
  else
    log "复制代理配置：source=${SOURCE_ID}"
  fi
  for id in "${TARGETS[@]}"; do
    body="$(jq -n \
      --arg id "${id}" \
      --arg ipchecker "${SOURCE_IPCHECKER}" \
      --argjson proxy "${SOURCE_PROXY_JSON}" \
      '{user_id:$id, ipchecker:$ipchecker, user_proxy_config:$proxy}')"
    resp="$(curl -sS -m 20 -X POST "${ADS_API}/api/v1/user/update" -H 'Content-Type: application/json' -d "${body}")"
    log "proxy update ${id}: ${resp}"
  done
fi

if [[ "${START_AFTER}" == "1" ]]; then
  log "启动分身..."
  start_profile "${SOURCE_ID}" >/dev/null || true
  sleep 1
  for id in "${TARGETS[@]}"; do
    start_profile "${id}" >/dev/null || true
    sleep 1
  done
fi

log "状态验证："
for id in "${SOURCE_ID}" "${TARGETS[@]}"; do
  echo "[${id}]"
  curl -sS -m 10 "${ADS_API}/api/v1/browser/active?user_id=${id}" || true
  echo
  sleep 1
done

if [[ "${VERIFY_IP}" == "1" ]]; then
  log "出口IP验证（ipify）："
  for id in "${SOURCE_ID}" "${TARGETS[@]}"; do
    ws="$(curl -sS -m 10 "${ADS_API}/api/v1/browser/active?user_id=${id}" | jq -r '.data.ws.puppeteer // empty' 2>/dev/null || true)"
    if [[ -z "${ws}" ]]; then
      echo "${id}: no ws"
      continue
    fi
    ip="$(node - <<'NODE' "${ws}" 2>/dev/null || true
const { chromium } = require('/root/auto-parse/node_modules/playwright');
const ws = process.argv[2];
(async()=>{
  try {
    const b = await chromium.connectOverCDP(ws);
    const c = b.contexts()[0];
    const p = c.pages()[0] || await c.newPage();
    await p.goto('https://api.ipify.org?format=json',{waitUntil:'domcontentloaded',timeout:30000});
    const txt = (await p.textContent('body')) || '';
    await b.close();
    process.stdout.write(txt.trim());
  } catch (e) {
    process.stdout.write('error');
  }
})();
NODE
)"
    echo "${id}: ${ip:-error}"
    sleep 1
  done
fi

if command -v sqlite3 >/dev/null 2>&1; then
  log "Google/Gemini Cookie计数："
  for id in "${SOURCE_ID}" "${TARGETS[@]}"; do
    d="$(resolve_cache_dir "${id}")"
    cdb="${d}/Default/Cookies"
    if [[ -f "${cdb}" ]]; then
      cp "${cdb}" "/tmp/${id}.cookies.db" || true
      n="$(sqlite3 "/tmp/${id}.cookies.db" "select count(*) from cookies where host_key like '%google.com%' or host_key like '%gemini.google.com%';" 2>/dev/null || echo 0)"
      echo "${id}: ${n}"
    else
      echo "${id}: no cookie db"
    fi
  done
fi

log "同步完成"
