#!/usr/bin/env bash
# Loopback-only routing rehearsal. No public listeners, ACME, or webhook writes.
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
tmp=$(mktemp -d /var/tmp/zoomerlip-smoke.XXXXXX)
pid=
cleanup() {
  if [[ -n $pid ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/site/assets"
printf '<title>Zoomerlip fixture</title><script src="/assets/fixture.js"></script>\n' > "$tmp/site/index.html"
printf '/* static fixture */\n' > "$tmp/site/assets/fixture.js"
# Use the same routes, replacing only addresses, document root and ACME/admin.
sed \
  -e 's@admin unix//run/caddy/admin.sock@admin off@' \
  -e 's@acme_ca .*@auto_https off@' \
  -e 's@http://zoomerlip.kirancodes.me, http://kalshitrader.kirancodes.me {@http://zoomerlip.kirancodes.me:18081, http://kalshitrader.kirancodes.me:18081 {\n bind 127.0.0.1@' \
  -e 's@^zoomerlip.kirancodes.me {@http://zoomerlip.kirancodes.me:18080 {\n bind 127.0.0.1@' \
  -e 's@^kalshitrader.kirancodes.me {@http://kalshitrader.kirancodes.me:18080 {\n bind 127.0.0.1@' \
  -e "s@/srv/zoomerlip/current@$tmp/site@" \
  /etc/caddy/Caddyfile > "$tmp/Caddyfile"
/usr/local/bin/caddy run --config "$tmp/Caddyfile" --adapter caddyfile > "$tmp/log" 2>&1 &
pid=$!
ready=false
for _attempt in {1..20}; do
  if curl -fsS --max-time 1 -H 'Host: zoomerlip.kirancodes.me' http://127.0.0.1:18080/ -o "$tmp/index" 2>/dev/null; then ready=true; break; fi
  sleep 0.2
done
[[ $ready == true ]] || { cat "$tmp/log"; exit 1; }
curl -fsS -D "$tmp/headers" -H 'Host: zoomerlip.kirancodes.me' http://127.0.0.1:18080/ -o "$tmp/index"
grep -q 'Zoomerlip fixture' "$tmp/index"
grep -qi '^cache-control: no-cache' "$tmp/headers"
grep -qi "frame-ancestors 'none'" "$tmp/headers"
curl -fsS -D "$tmp/asset-headers" -H 'Host: zoomerlip.kirancodes.me' http://127.0.0.1:18080/assets/fixture.js -o /dev/null
grep -qi '^cache-control: public, max-age=31536000, immutable' "$tmp/asset-headers"
for path in /.env /.git/config /local/test-account.json /assets/missing.js; do
  [[ $(curl -sS -H 'Host: zoomerlip.kirancodes.me' -o /dev/null -w '%{http_code}' "http://127.0.0.1:18080$path") == 404 ]]
done
curl -fsS -H 'Host: zoomerlip.kirancodes.me' http://127.0.0.1:18080/a/deep/link -o "$tmp/fallback"
cmp "$tmp/index" "$tmp/fallback"
curl -fsS -H 'Host: kalshitrader.kirancodes.me' http://127.0.0.1:18080/ -o /dev/null
curl -sS -D "$tmp/redirect" -H 'Host: zoomerlip.kirancodes.me' http://127.0.0.1:18081/ -o /dev/null
grep -qi '^location: https://zoomerlip.kirancodes.me/' "$tmp/redirect"
echo 'Loopback routes, caching, CSP, private-path denial, SPA fallback, Kalshi proxy, and redirect passed.'
