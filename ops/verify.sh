#!/usr/bin/env bash
set -euo pipefail
domain=zoomerlip.kirancodes.me
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
curl --fail --silent --show-error --max-time 10 --http1.1 --resolve "$domain:443:127.0.0.1" -D "$tmp/headers" "https://$domain/" -o "$tmp/index"
grep -q 'Zoomerlip' "$tmp/index"
grep -qi '^HTTP/1.1 200' "$tmp/headers"
grep -qi '^cache-control: no-cache' "$tmp/headers"
grep -qi '^x-content-type-options: nosniff' "$tmp/headers"
grep -qi '^referrer-policy: no-referrer' "$tmp/headers"
grep -qi "frame-ancestors 'none'" "$tmp/headers"
if grep -qi '^alt-svc:' "$tmp/headers"; then echo 'Unexpected alternate protocol.' >&2; exit 1; fi
for tls_domain in zoomerlip.kirancodes.me kalshitrader.kirancodes.me; do
  timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$tls_domain" -alpn 'h2,http/1.1' </dev/null > "$tmp/tls" 2>/dev/null
  grep -q 'ALPN protocol: http/1.1' "$tmp/tls"
  openssl x509 -in "$tmp/tls" -noout -issuer | grep -q "Let's Encrypt"
done
asset=$(grep -oE '/assets/[^" ]+\.js' "$tmp/index" | head -1)
[[ -n $asset ]]
curl --fail --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" -D "$tmp/asset-headers" "https://$domain$asset" -o /dev/null
grep -qi '^cache-control: public, max-age=31536000, immutable' "$tmp/asset-headers"
for path in /.env /.git/config /local/test-account.json /assets/does-not-exist.js; do
  [[ $(curl --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$domain$path") == 404 ]]
done
curl --silent --show-error --max-time 10 --resolve "$domain:80:127.0.0.1" -D "$tmp/redirect" "http://$domain/" -o /dev/null
grep -qi "^location: https://$domain/" "$tmp/redirect"
# Preserve path and query on both retired-domain listeners. No webhook POSTs.
for spec in http:80 https:443; do
  scheme=${spec%:*}; port=${spec#*:}
  code=$(curl --silent --show-error --max-time 10 --resolve "kalshitrader.kirancodes.me:$port:127.0.0.1" -D "$tmp/old-domain" -o /dev/null -w '%{http_code}' "$scheme://kalshitrader.kirancodes.me/channels/example?topic=release%20check")
  [[ $code == 308 ]]
  tr -d '\r' < "$tmp/old-domain" | grep -iFx 'location: https://zoomerlip.kirancodes.me/channels/example?topic=release%20check'
done
systemctl is-active --quiet caddy
/usr/local/lib/zoomerlip-ops/verify-retirement.sh
echo 'Verified Zoomerlip HTTPS/HTTP1, certificates, assets, headers, redirects and retirement.'
