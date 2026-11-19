# Zoomerlip operations

Host: `root@178.156.241.44`. Canonical domain: `zoomerlip.kirancodes.me`. The retired `kalshitrader.kirancodes.me` domain redirects to it, preserving path and query.

Caddy 2.11.9 serves static files with HTTP/1.1 and automatic Let's Encrypt certificates for both domains. HTML revalidates; hashed assets cache for a year. CSP denies framing. State and ACME keys stay outside `/srv/zoomerlip`; the admin API uses a permissioned Unix socket.

## Prepare and stage

`prepare.sh` installs the pinned upstream Caddy archive after checking its SHA-512 manifest. It validates configuration and leaves Caddy stopped. It refuses to overwrite an existing installation. Review upstream releases and advisories before changing the version.

Build in an isolated checkout on the MacBook Pro. Copy only the verified `dist/`, then stage it:

```sh
/usr/local/lib/zoomerlip-ops/stage-release.sh /root/artifact/dist RELEASE_ID
/usr/local/lib/zoomerlip-ops/smoke-stage.sh /srv/zoomerlip/releases/RELEASE_ID
```

Staging records SHA-256 checksums without changing `current`. The smoke test binds only loopback ports, checks routes and redirects, and compares every served release file against its source. It never posts to a webhook or Zulip organisation.

## Retirement and cutover

These actions require explicit retirement and cutover authorisation. `retire-kalshi.sh --approved` stops/disables both Kalshi services, stops the old Certbot renewal timer, and creates a root-only archive under `/var/backups/kalshi-retired/TIMESTAMP`. It verifies the archive against disk before deleting the application tree and live unit files. Both services are then masked. Their environment files and local data remain recoverable inside the archive. Original nginx and Let's Encrypt configuration is archived too.

The live nginx configuration becomes an emergency fallback with no upstream proxies. Its old-domain listeners redirect to Zoomerlip; other HTTP requests receive 503. TLS fallback material is kept root-only alongside the archive. The old Certbot renewal configuration is removed. SSH configuration, accounts and authorised keys are outside these scripts' scope.

After retirement, execute the bounded cutover:

```sh
systemd-run --unit=zoomerlip-cutover --collect --wait \
  --property=RuntimeMaxSec=240 --property=TimeoutStopSec=10 \
  /usr/local/lib/zoomerlip-ops/cutover.sh --approved RELEASE_ID
```

The script verifies retirement and release checksums, arms a five-minute rollback timer, selects the release atomically, stops nginx and starts Caddy. Certificate issuance may briefly extend the interruption. After verification passes, it disables nginx, enables Caddy and cancels rollback.

## Verification and rollback

Run `verify.sh` on the server, then verify public HTTPS externally. It checks trusted HTTPS, Let's Encrypt issuers, HTTP/1.1 negotiation, assets, security/cache headers and redirects with a path and query. `verify-retirement.sh` confirms both retired services are masked/inactive, their main PIDs are zero, ports 8000/9000 are closed, and live application/configuration paths are absent.

On cutover failure, rollback runs automatically. Manual invocation:

```sh
/usr/local/lib/zoomerlip-ops/rollback.sh /var/backups/zoomerlip/TIMESTAMP
```

Rollback enables only the emergency nginx frontend. It never restores trading services, app files, original proxy routes or Certbot timers. It refuses nginx configurations containing upstream proxies. Zoomerlip HTTPS may be unavailable until Caddy is repaired; the fallback is not a second production deployment. Archived fallback certificates retain their original expiry.

Recovery of retired application data is manual and requires separate authorisation. Keep the archive root-only and out of Git. Do not extract it into a live application path during frontend rollback.

Later static releases need only a staged directory and an atomic `current` symlink replacement. Keep the previous release for reversal; no web-server restart is required.

## References

- [Caddy 2.11.9 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9)
- [Security advisories](https://github.com/caddyserver/caddy/security/advisories)
- [Protocols and ACME options](https://caddyserver.com/docs/caddyfile/options)
- [systemd operation](https://caddyserver.com/docs/running)
