#!/bin/bash
set -euo pipefail
export PATH=/opt/pm-node/bin:/usr/sbin:/usr/bin:/sbin:/bin
systemctl is-active --quiet pm-web nginx
curl -fsS --max-time 10 https://www.l-sopp.com/ -o /dev/null
available=$(df -Pk '/WWW/PM WEB SITE/data' | awk 'NR==2 {print $4}')
test "$available" -ge 1048576
cd /WWW/pm-web-current
node --experimental-strip-types scripts/backup-policy.ts status --root /WWW/pm-web-backups/managed
