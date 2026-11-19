#!/usr/bin/env bash
# Publish Zoomerlip after explicit approval and completed Kalshi retirement.
set -euo pipefail
[[ $EUID == 0 && ${1:-} == --approved ]] || {
  echo 'Usage: cutover.sh --approved RELEASE_ID' >&2; exit 1;
}
release=${2:?Verified release ID required}
[[ $release =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]]
[[ -s /srv/zoomerlip/releases/$release/index.html ]]
[[ ! -e /srv/zoomerlip/current || -L /srv/zoomerlip/current ]]
exec 9>/run/zoomerlip-migration.lock
flock -n 9
/usr/local/lib/zoomerlip-ops/verify-retirement.sh
systemctl is-active --quiet nginx
if systemctl is-active --quiet caddy; then echo 'Caddy is already active.' >&2; exit 1; fi
(cd "/srv/zoomerlip/releases/$release"; sha256sum --check "../$release.sha256" >/dev/null)
nginx -t
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
for domain in zoomerlip.kirancodes.me kalshitrader.kirancodes.me; do
  [[ $(dig +short A "$domain" | tail -1) == 178.156.241.44 ]]
  [[ -z $(dig +short AAAA "$domain") ]]
done
state="/var/backups/zoomerlip/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$state"
umask 077
# Only the retirement-safe nginx config is eligible for frontend rollback.
tar -czf "$state/nginx-retired.tar.gz" -C / etc/nginx
cp /etc/caddy/Caddyfile "$state/Caddyfile"
cp /var/lib/zoomerlip-ops/retirement "$state/retirement"
readlink /srv/zoomerlip/current > "$state/previous-release" || true
printf '%s\n' "$release" > "$state/release"
touch "$state/ready"
echo "Rollback: /usr/local/lib/zoomerlip-ops/rollback.sh $state"
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
ln -s -- "/srv/zoomerlip/releases/$release" /srv/zoomerlip/.next-current
mv -Tf /srv/zoomerlip/.next-current /srv/zoomerlip/current
systemctl stop nginx
systemctl start caddy
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
echo "Cutover verified. Frontend rollback state: $state"
