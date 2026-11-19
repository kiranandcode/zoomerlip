#!/usr/bin/env bash
# Restores the original frontend/service states. Configs were never overwritten.
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
state=${1:?Usage: rollback.sh BACKUP_DIRECTORY}
[[ $state == /var/backups/zoomerlip/* && -f $state/ready ]] || exit 1
exec 9>/run/zoomerlip-migration.lock
flock 9
systemctl stop caddy
systemctl disable caddy
if [[ -s $state/previous-release ]]; then
  ln -s -- "$(cat "$state/previous-release")" /srv/zoomerlip/.rollback-current
  mv -Tf /srv/zoomerlip/.rollback-current /srv/zoomerlip/current
else
  rm -f /srv/zoomerlip/current
fi
nginx -t
systemctl start nginx
if [[ $(cat "$state/nginx-enabled") == enabled ]]; then systemctl enable nginx; fi
while read -r timer enabled active; do
  [[ $enabled != enabled ]] || systemctl enable "$timer"
  [[ $active != active ]] || systemctl start "$timer"
done < "$state/timers"
date -u > "$state/rolled-back"
echo 'nginx restored. Kalshi application services were not restarted.'
