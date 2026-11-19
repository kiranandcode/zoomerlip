# Zoomerlip

An independent, chat Zulip client. React, Vite, TypeScript. Static files only; the browser talks directly to each organization’s REST API.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Sign in with an organization URL, email, and password, or paste a Zulip API key for SSO. Add more organizations with **+**. The home icon opens DMs for the selected organization.

API keys are saved in localStorage. Passwords are used only to obtain an API key and are never saved. Remove an organization with the sign-out button to delete its saved credentials. Use a trusted browser profile. Remote organizations require HTTPS and CORS support for Authorization; HTTP is accepted only on loopback.

## Build and test

```sh
npm run build       # dist/: deploy these static files
npm run preview
npm test           # credential handling and HTML sanitization
```

Features: concurrent organization event queues, subscribed channels, nested topics, individual/group DM history, member list, grouped messages, reactions, replies, editing your messages, and older-message pagination. Failed sends retain the draft. Queue expiration re-registers; connection failures back off. Rendered HTML passes through DOMPurify. Private uploads use Zulip’s temporary-URL endpoint; signed URLs are fetched immediately and never persisted.

## Local Zulip

Only use the included harness against localhost. It never posts to a real organization.

```sh
node scripts/setup-local.mjs
docker compose -p zoomerlip-local -f local/compose.yaml up -d
sh scripts/local-http.sh
node scripts/seed-local.mjs
npm run test:local           # requires Chrome; npm run dev in another terminal
```

The checked-in configuration comes from official [docker-zulip](https://github.com/zulip/docker-zulip), using Zulip 13.3. Setup generates ignored local secrets. Port 8080 binds only to 127.0.0.1. The HTTP helper disables production hostname/HTTPS and proxy checks **inside the disposable test container**. Re-run it after restarting the container. Do not use this configuration in production. Initial database migrations take several minutes.

Local login: `http://localhost:8080`, `morgan@zoomerlip.test`, password `Zoomerlip-local-only-2026!`. Test credentials are also written to ignored `local/test-account.json`. The browser suite covers login, live messages, expired queues, reactions, editing, attachments, DMs, concurrent sessions, reload, and mobile layout. Screenshots go to ignored `test-results/`. Stop the test stack without deleting data:

```sh
docker compose -p zoomerlip-local -f local/compose.yaml down
```

## Deploy

Run `npm ci && npm run build`; serve `dist/` over HTTPS with any static server. No API proxy, Node runtime, or server credentials are needed. Set `index.html` to revalidate; hashed `/assets/` files can be cached for a year. Do not cache API responses. Configure `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `frame-ancestors 'none'` in CSP.

Planned host: **zoomerlip.kirancodes.me**, server **178.156.241.44**. Before deployment, separately obtain approval to inspect SSH/web-server configuration, publish the static build, change DNS, and stop or remove any kalshitrader service/configuration. No hosting, DNS, or kalshitrader changes are included in this repository setup.

The interface and original lime bolt logo belong to Zoomerlip. No chat brand assets are used. Zulip API reference: [authentication](https://zulip.com/api/fetch-api-key), [events](https://zulip.com/api/register-queue), [private attachments](https://zulip.com/api/get-file-temporary-url).
