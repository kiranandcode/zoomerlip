#!/usr/bin/env bash
# Emergency frontend fallback. Trading services remain retired and masked.
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
state=${1:?Usage: rollback.sh BACKUP_DIRECTORY}
[[ $state == /var/backups/zoomerlip/* && -f $state/ready && -s $state/retirement ]] || exit 1
exec 9>/run/zoomerlip-migration.lock
flock 9
# Never restore old application configs, units, data or renewal timers.
systemctl mask --now kalshi-trader kalshi-deploy-webhook
/usr/local/lib/zoomerlip-ops/verify-retirement.sh
nginx -T > "$state/fallback-validation.log" 2>&1
if grep -Eq 'proxy_pass|127\.0\.0\.1:(8000|9000)' "$state/fallback-validation.log"; then
  echo 'Refusing a fallback configuration containing upstream proxies.' >&2; exit 1
fi
systemctl stop caddy
systemctl disable caddy
if [[ -s $state/previous-release ]]; then
  ln -s -- "$(cat "$state/previous-release")" /srv/zoomerlip/.rollback-current
  mv -Tf /srv/zoomerlip/.rollback-current /srv/zoomerlip/current
else
  rm -f /srv/zoomerlip/current
fi
systemctl enable --now nginx
/usr/local/lib/zoomerlip-ops/verify-retirement.sh
date -u > "$state/rolled-back"
echo 'Emergency nginx fallback active. Zoomerlip needs repair; trading remains retired.'
