#!/bin/sh
# Test-only override. Zulip computed settings override SILENCED_SYSTEM_CHECKS.
# Never use this with a publicly exposed server.
set -eu
docker compose -p zoomerlip-local -f local/compose.yaml exec -T zulip sed -i '/SILENCED_SYSTEM_CHECKS = \[/a\    "zulip.E002", "zulip.E004",' /home/zulip/deployments/current/zproject/computed_settings.py
docker compose -p zoomerlip-local -f local/compose.yaml restart zulip
# Wait for startup to finish regenerating nginx configuration.
attempt=0
until docker compose -p zoomerlip-local -f local/compose.yaml exec -T zulip supervisorctl status nginx 2>/dev/null | grep -q RUNNING; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 180 ] || { echo 'Startup timed out; inspect docker compose logs.'; exit 1; }
  sleep 2
done
docker compose -p zoomerlip-local -f local/compose.yaml exec -T zulip sh -c 'sed -i '\''s/\$x_proxy_misconfiguration/""/g'\'' /etc/nginx/uwsgi_params /etc/nginx/zulip-include/proxy && nginx -t && nginx -s reload'
