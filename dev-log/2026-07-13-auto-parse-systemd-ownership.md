# Auto Parse Systemd Ownership

## Problem

`auto-parse-65.service` accumulated more than 83,000 restart attempts because port 1007 was held by a `nohup ./restart.sh` process launched from SSH session 9382 on 2026-07-09. The script used `pkill -f "next dev"` and then started another development server, creating two competing process-management paths.

## Decision

- systemd is the only production process owner on machine 65.
- production uses a completed Next.js build and `next start`.
- `restart.sh` delegates to systemd when a known unit exists and refuses to create a second process when port 1007 is occupied.
- the service uses `KillMode=control-group` so all Next.js child processes stop together.

## Validation

- The legacy SSH session cgroup was terminated.
- Port 1007 moved into `/system.slice/auto-parse-65.service`.
- systemd restart count reset to zero.
- Isolated `npm run build` completed successfully before production cutover.
- Production build completed and `/etc/systemd/system/auto-parse-65.service` was installed from `ops/auto-parse-65.service`.
- Service runs `npm run start` under `/system.slice/auto-parse-65.service` with restart count zero.
- Local and public `/parse` returned HTTP 200.
- A real Douyin parse for `v.douyin.com/yWSaXEDgMec/` returned video and cover successfully.
- After the real parse, the service cgroup used about 573 MB with a 726 MB peak; the machine retained about 4.1 GB available memory and load average remained near 1.0.

## 2026-07-15 Secret Environment Follow-up

The first production unit omitted the proxy authentication token inherited by the old SSH process. Existing cached mini program sessions continued to work, but a later JWT refresh failed before task creation because `/api/suqu/wechat-code2session` returned 401. The unit now loads `/etc/auto-parse-65.env`; deployment must keep that file mode 600 with `SUQU_WECHAT_PROXY_TOKEN` matching the `suqu-api` upload token.
