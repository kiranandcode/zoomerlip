#!/usr/bin/env bash
# Requires explicit approval for the shared nginx/kalshitrader frontend handover.
set -euo pipefail
[[ $EUID == 0 && ${1:-} == --approved ]] || {
  echo 'Usage: cutover.sh --approved RELEASE_ID (only after explicit approval)' >&2; exit 1;
}
release=${2:?Fresh reviewed release ID required}
[[ $release =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]]
[[ -s /srv/zoomerlip/releases/$release/index.html ]]
[[ ! -e /srv/zoomerlip/current || -L /srv/zoomerlip/current ]]
exec 9>/run/zoomerlip-migration.lock
flock -n 9
systemctl is-active --quiet nginx
for service in caddy snap.certbot.renew.service certbot.service; do
  if systemctl is-active --quiet "$service"; then echo "$service is already active; aborting." >&2; exit 1; fi
done
nginx -t
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl --fail --silent --show-error --max-time 15 https://kalshitrader.kirancodes.me/ -o /dev/null
[[ $(dig +short A zoomerlip.kirancodes.me | tail -1) == 178.156.241.44 ]]
[[ -z $(dig +short AAAA zoomerlip.kirancodes.me) ]]
state="/var/backups/zoomerlip/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$state"
umask 077
tar -czf "$state/nginx-letsencrypt.tar.gz" /etc/nginx /etc/letsencrypt
cp /etc/caddy/Caddyfile "$state/Caddyfile"
systemctl is-enabled nginx > "$state/nginx-enabled" || true
readlink /srv/zoomerlip/current > "$state/previous-release" || true
: > "$state/timers"
for timer in snap.certbot.renew.timer certbot.timer; do
  if systemctl cat "$timer" >/dev/null 2>&1; then
    enabled=$(systemctl is-enabled "$timer" || true)
    active=$(systemctl is-active "$timer" || true)
    printf '%s %s %s\n' "$timer" "$enabled" "$active" >> "$state/timers"
  fi
done
touch "$state/ready"
echo "Rollback: /usr/local/lib/zoomerlip-ops/rollback.sh $state"
# Survives an SSH disconnect or a killed cutover process.
watchdog="zoomerlip-rollback-$(date +%s)"
systemd-run --unit="$watchdog" --on-active=5m /usr/local/lib/zoomerlip-ops/rollback.sh "$state"
rollback_on_error() {
  local result=$1
  trap - EXIT
  flock -u 9
  /usr/local/lib/zoomerlip-ops/rollback.sh "$state"
  systemctl stop "$watchdog.timer"
  exit "$result"
}
trap 'rollback_on_error "$?"' EXIT
while read -r timer enabled active; do
  if [[ $enabled != masked ]]; then systemctl disable --now "$timer"; fi
done < "$state/timers"
ln -s -- "/srv/zoomerlip/releases/$release" /srv/zoomerlip/.next-current
mv -Tf /srv/zoomerlip/.next-current /srv/zoomerlip/current
systemctl stop nginx
systemctl start caddy
# Wait for both public certificates. All requests are GETs, never webhook POSTs.
healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent --max-time 3 --resolve 'zoomerlip.kirancodes.me:443:127.0.0.1' https://zoomerlip.kirancodes.me/ -o /dev/null &&
     curl --fail --silent --max-time 3 --resolve 'kalshitrader.kirancodes.me:443:127.0.0.1' https://kalshitrader.kirancodes.me/ -o /dev/null; then healthy=true; break; fi
  sleep 5
done
[[ $healthy == true ]]
timeout 60 /usr/local/lib/zoomerlip-ops/verify.sh
systemctl disable nginx
systemctl enable caddy
systemctl stop "$watchdog.timer"
trap - EXIT
date -u > "$state/completed"
echo "Cutover verified. Rollback state: $state"
