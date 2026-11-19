#!/usr/bin/env bash
# Archive and retire the application. Never restores or starts trading services.
set -euo pipefail
[[ $EUID == 0 && ${1:-} == --approved ]] || {
  echo 'Usage: retire-kalshi.sh --approved (requires explicit retirement approval)' >&2; exit 1;
}
exec 9>/run/zoomerlip-migration.lock
flock -n 9
[[ ! -e /var/lib/zoomerlip-ops/retirement ]]
[[ -d /opt/kalshi-trader ]]
for service in snap.certbot.renew.service certbot.service; do
  if systemctl is-active --quiet "$service"; then echo 'Certificate renewal is active; retry after it finishes.' >&2; exit 1; fi
done
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
nginx -t
umask 077
archive="/var/backups/kalshi-retired/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 /var/backups/kalshi-retired "$archive" "$archive/fallback-tls" /var/lib/zoomerlip-ops
printf '%s\n' "$archive" > /var/lib/zoomerlip-ops/retirement-in-progress
for unit in kalshi-trader kalshi-deploy-webhook snap.certbot.renew.timer certbot.timer; do
  systemctl show "$unit" -p FragmentPath -p DropInPaths -p ActiveState -p UnitFileState > "$archive/$unit.state"
done
# Stop writers before archiving data. Failure leaves them stopped.
systemctl disable --now kalshi-deploy-webhook kalshi-trader
systemctl disable --now snap.certbot.renew.timer
[[ -z $(ss -H -ltn '( sport = :8000 or sport = :9000 )') ]]
tar -czf "$archive/retired.tar.gz" -C / \
  opt/kalshi-trader etc/nginx etc/letsencrypt \
  etc/systemd/system/kalshi-trader.service \
  etc/systemd/system/kalshi-deploy-webhook.service
tar -dzf "$archive/retired.tar.gz" -C / > "$archive/archive-compare.log" 2>&1
(cd "$archive"; sha256sum retired.tar.gz > SHA256SUMS; sha256sum --check SHA256SUMS)
cp -L /etc/letsencrypt/live/kalshitrader.kirancodes.me/fullchain.pem "$archive/fallback-tls/fullchain.pem"
cp -L /etc/letsencrypt/live/kalshitrader.kirancodes.me/privkey.pem "$archive/fallback-tls/privkey.pem"
chmod 0600 "$archive"/fallback-tls/*
# Replace nginx's live application route before the port handover.
sed "s|@RETIREMENT_ARCHIVE@|$archive|g" /usr/local/lib/zoomerlip-ops/nginx-retired.conf \
  > /etc/nginx/sites-available/zoomerlip-retired-fallback
chmod 0644 /etc/nginx/sites-available/zoomerlip-retired-fallback
rm -f /etc/nginx/sites-enabled/kalshitrader /etc/nginx/sites-available/kalshitrader
ln -s /etc/nginx/sites-available/zoomerlip-retired-fallback /etc/nginx/sites-enabled/zoomerlip-retired-fallback
nginx -t
systemctl reload nginx
# Archive verification succeeded; remove live units, app, data and renewal config.
rm -f /etc/systemd/system/kalshi-trader.service /etc/systemd/system/kalshi-deploy-webhook.service
systemctl daemon-reload
systemctl mask --now kalshi-trader kalshi-deploy-webhook
rm -rf -- /opt/kalshi-trader
rm -f /etc/letsencrypt/renewal/kalshitrader.kirancodes.me.conf
date -u > "$archive/retired"
mv /var/lib/zoomerlip-ops/retirement-in-progress /var/lib/zoomerlip-ops/retirement
/usr/local/lib/zoomerlip-ops/verify-retirement.sh
echo "Recoverable root-only archive: $archive"
