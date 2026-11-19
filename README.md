<p align="center"><img src="public/logo.svg" width="128" alt="Zoomerlip" /></p>
<h1 align="center">Zoomerlip</h1>

A [Zulip](https://github.com/zulip/zulip) client suitable for zoomers.

[![Channels](docs/screenshots/channels.png)](docs/screenshots/channels.png)

[![Appearance](docs/screenshots/appearance.png)](docs/screenshots/appearance.png)

[Website](https://zoomerlip.kirancodes.me) · [Source](https://github.com/kiranandcode/zoomerlip)

## Setup

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>.

Sign in with your organisation URL, email and password, or paste an API key for SSO.

The client calls each organisation directly over HTTPS. The organisation must allow CORS requests with an Authorization header.

API keys stay in browser storage; the client discards passwords after login.

Custom palettes stay on your device.

## Build and test

```sh
npm test
npm run build       # static files in dist/
npm run preview
npm run test:ui
npm run test:themes
npm run test:safety
npm run test:scale
# Workstream B preview uses port 4182:
ZOOMERLIP_TEST_URL=http://127.0.0.1:4182 npm run test:organisation
```

Browser tests use Chrome and intercepted Zulip responses.

Run large builds on the MacBook Pro.

Do not use Docker or post test messages to real organisations.

## Search and organisation controls

Message search includes sender, channel, topic, date and attachment filters, paged results and message context. `/` opens search; `*` opens starred messages; `@` opens mentions outside text fields.

Topic controls support moves, resolution and server preferences. Channel and organisation controls follow server permissions and confirm access-changing operations. See [verified coverage and integration dependencies](docs/progress/organisation.md).

## Android

Requires Java 17 and Android SDK 35.

```sh
./scripts/build-android.sh
# android/app/build/outputs/apk/release/app-release-unsigned.apk
```

The Android app bundles the same client.

Sign release APKs on the trusted Mac and distribute them through Vibux Approver.

## Deploy

Serve `dist/` over HTTPS.

See [ops/](ops/) for Caddy configuration, release staging and rollback.
