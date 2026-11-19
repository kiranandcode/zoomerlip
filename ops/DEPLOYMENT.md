# Zoomerlip operations

Target: `root@178.156.241.44`. Domains: `zoomerlip.kirancodes.me` and the preserved `kalshitrader.kirancodes.me`.

## Prepare

Copy `ops/` to `/root/zoomerlip-deploy/ops/`, then run `bash ops/prepare.sh` there. This downloads Caddy **2.11.9**, verifies its upstream SHA-512 checksum, installs a dedicated service, validates configuration, and leaves it stopped/disabled. It refuses to overwrite an existing Caddy installation. Update the pinned version only after checking the upstream release and advisories.

The server listens with HTTP/1.1 only. Both domains use automatic Let's Encrypt. The static site's CSP matches Vite's policy and adds `frame-ancestors 'none'`. HTML revalidates; hashed assets cache for a year; missing assets return 404. Caddy's state, ACME keys, and permissioned admin socket are outside `/srv/zoomerlip`. The service runs as `caddy`; release files belong to root.

Run `bash ops/smoke-stage.sh` on the server for loopback-only routing checks using a temporary static fixture. This never binds ports 80/443 or requests certificates. It performs only a GET against the existing Kalshi dashboard.

## Stage the fresh build

Build on `kirans-macbook-pro` in an isolated checkout. Copy only the reviewed `dist/` into a private server staging directory. Do not include the checkout, local credentials, themes, source maps, or Android output. Record the source commit and artifact digest.

```sh
/usr/local/lib/zoomerlip-ops/stage-release.sh /root/zoomerlip-artifact/dist COMMIT-TIMESTAMP
```

This writes `/srv/zoomerlip/releases/COMMIT-TIMESTAMP` and its checksum manifest. It does not change `/srv/zoomerlip/current` or public routing.

## Initial migration — explicit approval required

Obtain approval to briefly stop the shared nginx frontend and suspend its Certbot renewal timer. Caddy will preserve Kalshi's dashboard, exact webhook route, and WebSocket support. Neither Kalshi backend service is stopped or restarted. No Kalshi redirect is configured.

Confirm DNS A records point to this host and no stale AAAA records exist. Current Zoomerlip DNS already points to `178.156.241.44`. No DNS mutation is part of these scripts.

After approval, execute through systemd so the operation survives SSH loss and has a four-minute runtime limit:

```sh
systemd-run --unit=zoomerlip-cutover --collect --wait \
  --property=RuntimeMaxSec=240 --property=TimeoutStopSec=10 \
  /usr/local/lib/zoomerlip-ops/cutover.sh --approved COMMIT-TIMESTAMP
```

The script backs up nginx/Let's Encrypt configuration, captures service/timer state, arms an independent five-minute rollback, and switches the release symlink atomically. It stops nginx and starts Caddy. Initial certificate issuance may extend the interruption. Failure invokes rollback. The watchdog restores nginx after a killed or timed-out migration.

Successful checks disable nginx startup, enable Caddy startup, and cancel rollback. Old nginx files/certificates remain intact. Certbot's nginx renewal timer stays disabled because Caddy owns certificate renewal. Do not run nginx's Certbot renewal manually while Caddy owns ports 80/443.

Inspect `journalctl -u caddy` and run `ops/verify.sh` on the server. Also verify the public URL externally and inspect TLS ALPN: offering `h2,http/1.1` must negotiate `http/1.1`; certificates must be trusted and issued by Let's Encrypt. Never POST to the production webhook or a real Zulip organization for testing.

## Rollback

The cutover prints its exact root-only backup directory:

```sh
/usr/local/lib/zoomerlip-ops/rollback.sh /var/backups/zoomerlip/TIMESTAMP
```

This stops/disables Caddy, restores the previous release pointer, validates/starts nginx, and restores previous nginx startup and Certbot timer states. It does not restart Kalshi backends. Initial rollback removes Zoomerlip's public endpoint because the original nginx configuration serves only Kalshi.

Backups contain TLS private keys. Keep them root-only and out of Git. Do not delete nginx or these backups during the migration.

For later static releases, stage first, then atomically replace `/srv/zoomerlip/current` using a temporary symlink and `mv -Tf`. Keep the previous release path for rollback. No web-server restart is required. Existing browser tabs may need a refresh after an asset-changing release.

## References

- [Caddy 2.11.9 release and security fixes](https://github.com/caddyserver/caddy/releases/tag/v2.11.9)
- [Caddy advisories](https://github.com/caddyserver/caddy/security/advisories)
- [HTTP protocols and ACME configuration](https://caddyserver.com/docs/caddyfile/options)
- [systemd operation](https://caddyserver.com/docs/running)
