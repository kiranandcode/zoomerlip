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
