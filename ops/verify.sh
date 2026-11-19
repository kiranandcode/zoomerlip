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
timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$domain" -alpn 'h2,http/1.1' </dev/null > "$tmp/tls" 2>/dev/null
grep -q 'ALPN protocol: http/1.1' "$tmp/tls"
openssl x509 -in "$tmp/tls" -noout -issuer | grep -q "Let's Encrypt"
asset=$(grep -oE '/assets/[^" ]+\.js' "$tmp/index" | head -1)
[[ -n $asset ]]
curl --fail --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" -D "$tmp/asset-headers" "https://$domain$asset" -o /dev/null
grep -qi '^cache-control: public, max-age=31536000, immutable' "$tmp/asset-headers"
for path in /.env /.git/config /local/test-account.json /assets/does-not-exist.js; do
  [[ $(curl --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$domain$path") == 404 ]]
done
curl --silent --show-error --max-time 10 --resolve "$domain:80:127.0.0.1" -D "$tmp/redirect" "http://$domain/" -o /dev/null
grep -qi "^location: https://$domain/" "$tmp/redirect"
curl --fail --silent --show-error --max-time 10 --resolve 'kalshitrader.kirancodes.me:443:127.0.0.1' https://kalshitrader.kirancodes.me/ -o /dev/null
for service in kalshi-trader kalshi-deploy-webhook caddy; do systemctl is-active --quiet "$service"; done
echo 'Verified static page, asset, headers, private-path denial, HTTPS, and Kalshi health.'
