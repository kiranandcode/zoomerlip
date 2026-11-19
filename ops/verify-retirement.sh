#!/usr/bin/env bash
set -euo pipefail
[[ -s /var/lib/zoomerlip-ops/retirement ]]
archive=$(cat /var/lib/zoomerlip-ops/retirement)
[[ $archive == /var/backups/kalshi-retired/* && -f $archive/retired ]]
for unit in kalshi-trader kalshi-deploy-webhook; do
  [[ $(systemctl is-enabled "$unit" 2>/dev/null || true) == masked ]]
  if systemctl is-active --quiet "$unit"; then echo "$unit is active" >&2; exit 1; fi
  [[ $(systemctl show "$unit" -p MainPID --value) == 0 ]]
  [[ $(readlink "/etc/systemd/system/$unit.service") == /dev/null ]]
done
[[ -z $(ss -H -ltn '( sport = :8000 or sport = :9000 )') ]]
[[ ! -e /opt/kalshi-trader ]]
[[ ! -e /etc/nginx/sites-enabled/kalshitrader ]]
[[ ! -e /etc/nginx/sites-available/kalshitrader ]]
[[ ! -e /etc/letsencrypt/renewal/kalshitrader.kirancodes.me.conf ]]
echo 'Retired services masked/inactive; app and old configuration removed; ports 8000/9000 closed.'
