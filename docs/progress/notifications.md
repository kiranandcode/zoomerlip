# Workstream C: notifications, presence and Android

Owner: notifications worktree. Parent integration only; no deployment, branch push or APK distribution.

## Rules and environment

- Read AGENTS.md. Work is on Kirans-MacBook-Pro, isolated branch `features/notifications`.
- Node 22: `/opt/homebrew/opt/node@22/bin`; 158 GiB free before `npm ci`.
- No Docker, production writes, credentials in Git, backend or permanent polling service.
- Browser fixtures use port 4183. Physical-device testing waived; mocks do not establish delivery reliability.

## Slice 1: typing

Implemented compose-input throttling, ordered start/stop, idle timeout, blur/hidden/navigation/unmount cleanup, server typing preferences and feature gates. Remote indicators have bounded state, expiry, conversation and account isolation. Revocation and private membership loss clear live state.

Integration: `useSession` registers typing/presence/status/settings and forwards registration/events to `src/live/store.ts`. Composer calls `useTyping`; App renders `TypingIndicator`. These small edits must survive A/B integration. No SessionModel shape changes.

Validation: 10 focused unit tests passed (typing and existing session tests). Production build pending below.

## API audit

Checked official documentation and upstream implementation on 2026-11-19:

- https://zulip.com/api/set-typing-status
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/views/typing.py
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/actions/typing.py
- https://zulip.com/api/update-presence
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/views/presence.py
- https://zulip.com/api/update-status
- https://zulip.com/api/update-settings
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/lib/event_types.py

Current status API and upstream view have no expiry parameter. Do not claim server status expiry or emulate it with a browser timer.

## Remaining slices

Presence/status/read receipts, notification rules and deduplication, Android channels/permission/navigation/file picker, push infrastructure audit and regression validation.

## Slice 2: presence and status

Added minute-throttled visible-page presence updates, incremental updates at feature level 263, legacy slim format fallback, presence event updates and expiring online/idle display. Status/emoji and availability controls are reachable from My profile. Read receipts are fetched on demand from message actions, with server privacy enforcement, empty/error/refresh states, abort on close and invalidation on membership loss.

API references: https://zulip.com/api/get-read-receipts and https://zulip.com/api/register-queue. Status expiry remains unavailable in the audited upstream API.

Typing production build passed. Presence/status production build passed. Commit history identifies the first combined live-interaction increment.

## Slice 3: notification preferences and delivery

Implemented server-synced DM/mention, channel, followed-topic and sound preferences; channel overrides; device-local DM/mention filters; private previews by default; explicit permission action; own/read/muted suppression; delayed delivery to absorb read events; bounded Web Locks/localStorage deduplication and visible-tab leases. Unsupported Web Locks/storage disables delivery rather than risking duplicate alerts. Browser sounds require the explicit sound test per page lifetime.

Account-aware notification navigation resolves the message through the selected account's authenticated API, rejects removed accounts, and loads bounded message context. `OrgCache.load(view, force, requestedAnchor?)` is the only cache API extension. Preserve the Workspace `notificationTarget` integration when merging B.

Validation: 133 web unit tests pass; production build passes. Browser fixture under development caught and removed a duplicated typing indicator. The new suite is `scripts/test-notifications.mjs` on port 4183.

Additional audited sources:

- https://zulip.com/api/update-subscription-settings
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/views/user_settings.py
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/views/read_receipts.py
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/lib/notification_data.py
- https://zulip.readthedocs.io/en/latest/subsystems/notifications.html

Commit `fa3626d`: typing/presence/status/receipts, 126 unit tests and production build passed at that increment.

## Slice 4: Android

Implemented audible/silent notification channels with private lock-screen content, explicit Android 13+ permission requests and system settings access. The origin- and main-frame-restricted bridge accepts only bounded account IDs, message IDs and notification text; it never receives an API key. Clicks use immutable explicit PendingIntents and single-use random routing tokens. Account removal, read/deleted messages and permission loss prevent or clear delivery. Native account and route data is backup-excluded with the existing app policy.

Extended ACTION_OPEN_DOCUMENT MIME handling for images, documents, audio, video and arbitrary attachments; supports up to 20 selected content URIs. No file:// or network picker results, broad filesystem permission, persistent URI grant or navigation-policy relaxation.

Validation: 9 Robolectric unit tests, release lint and release APK build passed on this MBP. Tests cover channel privacy, permission-on-action, forged/replayed/removed-account routes, picker MIME/URI bounds, rotation retaining the WebView, keyboard insets and the Back dispatch contract. Android WebView JavaScript execution and physical delivery still require device validation; waived physical testing is not a reliability claim. Gradle emits an existing SDK XML version warning; checks succeed.

## Exact push dependency for the parent

Closed-app push is **not implemented**. There is no polling service, Firebase dependency, service credential or new backend in this change. Current Android alerts consume live events only while the WebView remains running; Android may suspend it.

To enable reliable closed-app push, an operator must supply an authorized Firebase project configured for Android application ID `me.kirancodes.zoomerlip`, its Android client configuration (project/sender/application identifiers), and a compatible server/bouncer delivery arrangement using FCM sender credentials for that same project. FCM rejects a registration token from another sender/project. Service-account credentials belong only on operator infrastructure, never in the APK, static assets or Git.

Zulip's hosted bouncer cannot be assumed to send for this custom Firebase project. Its documented registration payload has no Android application/project selector. Operator agreement to support the Zoomerlip project, or an explicitly approved compatible bouncer configured for it, is required. Merely registering a Zulip server with the standard service does not establish custom-app delivery.

For a supported bouncer: configure the selected Zulip server's `ZULIP_SERVICE_PUSH_NOTIFICATIONS = True`, monitored `ZULIP_ADMINISTRATOR`, outbound HTTPS and operator registration via `manage.py register_server`; the operator must select/configure the appropriate bouncer and accept its terms. Each participating organization must have push enabled. Do not change hosting/DNS or these settings from this worker.

Modern client work after infrastructure is supplied: `POST /register_client_device`; feature-gated `POST /mobile_push/register`; per-account SecretBox push keys and IDs, bouncer public key and encrypted token registration, token/key rotation, account removal/unregister, native FCM receipt/decryption and removal events. The current protocol was redesigned at feature level 468 (initial endpoint 406, current cryptosystem 432). The upstream registration view rejects servers without bouncer/ZILENCER support. Direct legacy FCM delivery uses operator `ANDROID_FCM_CREDENTIALS_PATH` and `/users/me/android_gcm_reg_id`, but that endpoint is deprecated from feature level 406; it is not an assumed replacement for modern E2EE deployment. Compatibility and migration require an operator decision before choosing the delivery mechanism.

Push audit references (read 2026-11-19):

- https://zulip.readthedocs.io/en/stable/production/mobile-push-notifications.html
- https://zulip.com/api/add-fcm-token
- https://zulip.com/api/register-push-device
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/views/push_notifications.py
- https://raw.githubusercontent.com/zulip/zulip/main/zerver/lib/push_notifications.py
- https://raw.githubusercontent.com/zulip/zulip/main/zilencer/views.py
- https://firebase.google.com/docs/cloud-messaging/error-codes
- https://developer.android.com/develop/ui/views/notifications/notification-permission
- https://developer.android.com/develop/ui/views/notifications/channels

Commit `0736251`: web notification preferences, deduplication and safe message-context navigation; 133 web unit tests and production build passed. Browser regression verification continues below.
