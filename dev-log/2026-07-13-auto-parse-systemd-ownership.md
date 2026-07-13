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
- Final production-mode checks pending.
