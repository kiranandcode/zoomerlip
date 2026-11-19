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
npm test           # auth, sanitization, cache/event consistency
```

Use **My posts** or your name in the bottom-left corner to open your profile. Click a member or message sender for their posts. Profiles show channel posts by default; **Include DMs** adds only messages accessible to your account. Older posts load on demand.

The palette button beside your name opens **Appearance**: Graphite, Midnight, or Light; four accents; compact/cozy spacing; text size; and motion controls. Preferences persist on this device and respect system reduced motion. **Custom themes** lets you create named palettes, preview colours, and import/export theme JSON. Palettes stay in browser storage; exports contain only theme data. Appearance is also available before login.

Message and topic caches live in memory, separately per account. Warm navigation avoids requests for 60 seconds (topics: five minutes); stale views display cached content during refresh. Live events update cached messages directly. Queue recovery and topic moves reconcile with the server. Up to 24 recent views are retained; inactive histories are trimmed to 300 messages when updated. Drafts and scroll positions survive navigation within retained views, but not reloads. Member rendering is windowed for large organizations. Signing out clears the account cache and signs out other tabs. Revoked channel access purges affected history; invalid credentials lock the workspace.

Right-click a thread, press **Shift+F10**, or use its **…** button to mark it read or mute it for 15 minutes, 1 hour, 8 hours, 24 hours, or until unmuted. Muted threads fade and stop contributing to unread badges. These mutes apply in this browser, synchronize across its tabs, and expire automatically. Zulip’s existing mute preferences are also respected.

Features: concurrent organization event queues, subscribed channels, nested topics, individual/group DM history, member list, grouped messages, reactions, replies, editing your messages, and older-message pagination. Failed sends retain the draft. Queue expiration re-registers; connection failures back off. Rendered HTML passes through DOMPurify. Private uploads use Zulip’s temporary-URL endpoint; signed URLs are fetched immediately and never persisted.

## Testing and build location

Do not use Docker. Run large builds or heavy test services on **kirans-macbook-pro** in an isolated checkout. Keep local work lightweight.

The UI, theme and safety suites intercept Zulip requests and need no server or real credentials. Start the static preview, then run:

```sh
ZOOMERLIP_TEST_URL=http://127.0.0.1:4173 npm run test:ui
ZOOMERLIP_TEST_URL=http://127.0.0.1:4173 npm run test:themes
ZOOMERLIP_TEST_URL=http://127.0.0.1:4173 npm run test:safety
ZOOMERLIP_TEST_URL=http://127.0.0.1:4173 npm run test:scale
```

Browser suites require Chrome. They cover typing performance, keyboard/touch controls, thread mutes and expiry, theme conflicts, revoked access, muted users, cancelled login and cross-tab sign-out. Tests never post to a real organization. Screenshots, when generated, go to ignored `test-results/`.

The legacy local-server harness remains in `scripts/` for historical reproducibility. Do not run its Docker setup. Its fixtures and volumes are not part of the static application.

## Deploy

Run `npm ci && npm run build`; serve `dist/` over HTTPS with any static server. No API proxy, Node runtime, or server credentials are needed. Set `index.html` to revalidate; hashed `/assets/` files can be cached for a year. Do not cache API responses. Configure `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `frame-ancestors 'none'` in CSP.

Planned host: **zoomerlip.kirancodes.me**, server **178.156.241.44**. Before deployment, separately obtain approval to inspect SSH/web-server configuration, publish the static build, change DNS, and stop or remove any kalshitrader service/configuration. No hosting, DNS, or kalshitrader changes are included in this repository setup.

The interface and original Zoomerlip logo belong to Zoomerlip. No chat brand assets are used. Zulip API reference: [authentication](https://zulip.com/api/fetch-api-key), [events](https://zulip.com/api/register-queue), [private attachments](https://zulip.com/api/get-file-temporary-url).

Independent client reviews: [Claude](docs/reviews/claude.md), [Astra high](docs/reviews/astra.md), and [resolution status](docs/reviews/README.md).
