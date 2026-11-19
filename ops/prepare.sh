#!/usr/bin/env bash
# Run as root on Ubuntu. Stages only; never stops or starts a service.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
cd -- "$(dirname -- "$0")"
version=2.11.9
archive="caddy_${version}_linux_amd64.tar.gz"
checksums="caddy_${version}_checksums.txt"
[[ $(uname -m) == x86_64 ]]
[[ ! -e /etc/caddy/Caddyfile && ! -e /usr/local/bin/caddy ]] || {
  echo 'Caddy already staged/installed; inspect before replacing.' >&2; exit 1;
}
work=$(mktemp -d /var/tmp/zoomerlip-caddy.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
base="https://github.com/caddyserver/caddy/releases/download/v${version}"
curl --fail --location --proto '=https' --tlsv1.2 "$base/$archive" -o "$work/$archive"
curl --fail --location --proto '=https' --tlsv1.2 "$base/$checksums" -o "$work/$checksums"
(cd "$work"; awk -v name="$archive" '$2 == name {print $1 "  " $2}' "$checksums" | sha512sum --check --strict -)
tar -xzf "$work/$archive" -C "$work" caddy
"$work/caddy" version
install -d -m 0755 /etc/caddy /srv/zoomerlip/releases /usr/local/lib/zoomerlip-ops
getent group caddy >/dev/null || groupadd --system caddy
id caddy >/dev/null 2>&1 || useradd --system --gid caddy --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
install -d -o caddy -g caddy -m 0700 /var/lib/caddy
install -m 0755 "$work/caddy" /usr/local/bin/caddy
install -m 0644 Caddyfile /etc/caddy/Caddyfile
install -m 0644 caddy.service /etc/systemd/system/caddy.service
install -m 0755 stage-release.sh cutover.sh rollback.sh verify.sh /usr/local/lib/zoomerlip-ops/
install -m 0644 "$work/$checksums" /usr/local/lib/zoomerlip-ops/caddy-checksums.txt
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemd-analyze verify /etc/systemd/system/caddy.service
systemctl daemon-reload
echo 'Prepared. Caddy remains stopped and disabled; nginx is unchanged.'
