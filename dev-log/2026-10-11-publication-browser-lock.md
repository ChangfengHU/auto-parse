# RUNTIME-004 — Publication / maintenance cross-process activity lock

## Evidence and scope

2026-10-10T20:54:30.366Z: image-service memory_watchdog_restart on browser-2/9223,
usedMb=3708, highMb=3800, pressure=98. At 20:54:30.703Z the approved workflow
task 6bce169e-fdf1-4710-bf37-dcda7f949db0 failed in file upload with target closed.
Its later cleanup is not the cause. The identical video subsequently published.

The workflow's lease is process-local. Maintenance restart has no shared flock.
Fix the direct managed CDP path on84 and both maintenance restart paths. Retain
logins, original Supabase workflow, publication ledger, existing material edits.
Remote forwarded CDP tunnels need an owner-host lease; this local lock must not
be represented as protecting a different host. No additional publication here.

## Plan / status

Implemented: acquire stable activity-port flock before CDP bootstrap and release
after cleanup; maintenance must acquire same lock through restart/readiness;
CDP guard must skip held/missing locks. Test real competing processes, cleanup,
maintenance exclusion and existing publication regressions. Deploy only idle
HTTP services, never restart logged-in browsers for acceptance.

## Implementation / acceptance

- Workflow manual direct CDP now acquires activity-port flock before bootstrap,
  retains it through all nodes and cleanup, releases in finally. Busy/missing
  locks fail closed. Original workflow and request/receipt reconciliation unchanged.
- Installed image service hard restart and soft tab recycle acquire the same
  flock. Busy/unavailable locks defer maintenance. Failed/deferred restarts no
  longer consume the watchdog restart cooldown or produce a successful event.
- CDP guard holds the same lock throughout probes/restart; held or missing locks
  skip maintenance. No lock file/inode is deleted or replaced.
- 97/97 directed regressions pass, including real competing processes, holder
  death, task success/failure/stop/bootstrap failure, hard/soft maintenance and
  CDP guard held/idle/missing cases. systemctl/browser actions are mocks in tests.
- Targeted ESLint, full tsc --noEmit --incremental false, build, node --check,
  bash -n and git diff --check pass. No new dependencies installed.
- Production switched to .next-publication-lock-20261011 via the additive
  zz-publication-lock.conf EnvironmentFile. Previous builds/drop-ins retained.
  Only idle auto-parse and image HTTP services restarted. Browser-1 PID2103072
  and browser-2 PID2088434 unchanged before/after deployment and acceptance.
- Real approved 13-node preview task a2492b2a-04fa-45a2-9bbf-18ed9c6ff38b:
  acquired at 19:14:02.426Z, done19:18:03.256Z, released19:18:03.392Z onOct11.
  Native video upload135727ms, content check66586ms; prepared=true,
  published=false, creation receipt=null. Publish confirmation nodes skipped.
  Lock visible in lslocks during upload and independently reacquired afterwards.
  This is upload/preview acceptance, NOT a new public publication or proof that
  arbitrary network/platform outages have disappeared. No new work published.
- Production health/capabilities are checked separately from startup readiness;
  immediate startup connection refusal was transient, later protected API200
  and health200 pass. Existing account/login and material edits retained.

## Reproduction / rollback

ops/browser-maintenance-activity-lock.patch records exact changes to the two
installed maintenance files. Apply only against a matching base after idle
verification: sudo patch -d / -p1 --dry-run < ops/browser-maintenance-activity-lock.patch,
then apply and restart the idle image HTTP service. guard reads its shell file
per run; no logged-in browser restart is needed. Upgrades must preserve/reapply
this fix and rerun regression; do not assume an older package contains it.

Local backups retained under .data/browser-lock-repair-20261011; publication
ledger and all historical failure/receipt evidence preserved. Rollback requires
idle tasks, reverse maintenance patch, remove only our zz-publication-lock.conf,
daemon-reload/restart HTTP services to the preserved previous build. Never
remove user profiles or publication ledger. New live build is not a temp file.

Only this task's source/test/docs/build-config changes are staged. Preexisting
.materials.json changes excluded. GitHub repo identity/push permission checked
via the exact Vault record; credentials remain in process memory, not Git.
