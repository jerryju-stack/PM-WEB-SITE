#!/bin/bash
# Root-only systemd entry point. Both this job and deployment take this lock.
set -euo pipefail
export PATH=/opt/pm-node/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec 9>/run/lock/pm-web-maintenance.lock
flock -n 9 || { echo 'Another maintenance operation holds the lock'; exit 1; }
app=/WWW/pm-web-current
data='/WWW/PM WEB SITE/data'
root=/WWW/pm-web-backups/managed
cd "$app"
systemctl is-active --quiet pm-web
started=$(date +%s)
stopped=0
restart() {
  result=$?
  trap - EXIT
  if [ "$stopped" = 1 ]; then
    systemctl start pm-web || result=1
    ready=0
    for attempt in $(seq 1 40); do
      if curl -fsS --max-time 2 http://127.0.0.1:3000/ -o /dev/null; then ready=1; break; fi
      sleep 0.5
    done
    [ "$ready" = 1 ] || result=1
  fi
  elapsed=$(( $(date +%s) - started ))
  echo "backup_exit=$result total_maintenance_seconds=$elapsed"
  [ "$elapsed" -le 300 ] || result=1
  exit "$result"
}
trap restart EXIT
stopped=1
systemctl stop pm-web
timeout --signal=TERM --kill-after=5s 235s node --experimental-strip-types scripts/backup-policy.ts run \
  --data "$data" --root "$root" --offline-confirmed yes --manual yes
