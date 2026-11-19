# Zulip feature coverage

Implement the gaps identified on 2026-11-19. This is a work plan, not a list of shipped features.

## Baseline

Start from d81da64. It includes profile editing, the mobile navigation drawer, bounded API responses, rendering protections and cache improvements. The MBP check runner passed unit tests, the production build, Android unit tests/lint/release build, and UI/theme/safety/scale browser suites. This commit has not yet been deployed.

Keep React, Vite and TypeScript. The web build stays static. Each client calls the selected organisation directly. No application backend, credential proxy or Docker. All test writes use intercepted fixtures. Never send test messages or modify accounts on real organisations.

## Workstreams

Three Codex Astra workers use separate MBP worktrees. Commit each working increment. Each worker maintains its own progress file under `docs/progress/`, recording commits, tests and unresolved dependencies. The parent integrates and owns deployment.

### A. Messaging and composition

1. Persistent drafts per account and destination, with a draft list, restore/delete, schema validation, quotas and explicit cleanup on account removal. Add server draft sync where supported; resolve conflicts without silently overwriting either version. Never queue a send automatically after reconnection.
2. File attachments: file picker, paste and drop; organisation size limits, progress, cancellation, retry and actionable failures. Insert returned upload links into the draft. Keep authentication on the selected organisation only. Coordinate Android picker MIME support with worker C.
3. Mention and emoji autocomplete, organisation emoji, accessible keyboard selection, formatting controls and a sanitised Markdown preview using Zulip's renderer. Preserve IME and mobile newline behaviour.
4. Message actions: delete with confirmation and permission errors; star/unstar; mark unread; view edit history; copy permanent links; quote replies. Existing edit and reaction behaviour must remain intact.
5. Scheduled messages, reminders and saved snippets: create/list/edit/delete; use server scheduling, not browser timers; preserve the draft when an operation fails. Display timezone and failed delivery states.
6. Interactive polls and to-do lists: create and participate using Zulip's documented submessage protocol. Handle live updates and permissions. Unsupported servers must get an explicit fallback rather than broken controls.

Own Composer, MessageRow and new messaging modules/tests/styles. For shared App/cache/session/type files, keep edits small and explain integration points. Use a dedicated messaging stylesheet rather than rewriting global theme rules.

### B. Search, topics and organisation

1. Full message search with text and sender/channel/topic/date/attachment filters, paged results, keyboard navigation and opening a result in context. Cancel stale searches; bound memory and isolate caches by account and permissions. Preserve the existing channel/people filter.
2. Topics: rename, move messages or whole topics with propagation choices, resolve/reopen, follow/unfollow and server-synchronised mute/unmute. Keep browser-only timed mutes clearly separate from server preferences. Respect organisation policy and feature levels.
3. Channel directory: search, inspect, join/leave and create. Add permission-aware settings for name, description, visibility and membership. Explain consequences before changing privacy or leaving a channel.
4. Organisation controls: invitations, member/role management, user groups and supported organisation settings. Only expose actions permitted to the current user. Require confirmation for destructive or privilege-changing actions. Do not pretend to support settings that depend on unavailable server APIs; document exact remaining coverage.
5. Add navigation to starred messages, mentions, drafts and scheduled items through agreed integration points with worker A. Improve keyboard shortcuts for these views and search. Maintain mobile drawer and Back behaviour.

Own search/topic/organisation modules, TopicMenu, NavigationRows and their tests/styles. This worker owns the main App navigation integration. Preserve worker A/C interfaces during integration; do not refactor unrelated shared code.

### C. Notifications, presence and Android

1. Typing indicators: send throttled start/stop events only while composing; stop on blur, navigation and unmount; render remote indicators with expiry and account isolation.
2. Presence and status: online/idle display, status text/emoji, availability and status expiry where supported. Use supported events and throttled updates. Add read receipts where permitted.
3. Notification preferences: mentions/DM/channel rules, mute/follow precedence, sound settings and browser notification permission requested only from an explicit user action. Avoid duplicate notifications across tabs; suppress own messages and already-read activity. Offer private notification previews.
4. Android: implement notification channels, runtime permission and safe account-aware navigation from notifications. Audit the upstream push registration/bouncer requirements before choosing a delivery mechanism. A static web page cannot provide reliable closed-app push by itself. Do not add a backend, embed service credentials, claim background reliability from foreground polling, or run a permanent polling service without a user decision. Implement what is possible within the architecture; write an exact deployment dependency if push needs operator registration or credentials.
5. Extend the native file chooser for worker A's attachment types without weakening URL navigation, file access, backup or WebView protections. Check Back, rotation, keyboard and notification navigation with automated Android tests.

Own notification/presence/native modules and related tests. Coordinate event registration/SessionModel/useSession changes with A/B. Keep native bridge capabilities narrow; never expose an API key to untrusted content.

## API and integration rules

- Check current official Zulip documentation and upstream code before implementing an endpoint or event schema. Record relevant links in each progress file. Feature-detect using the server's feature level and permissions; verify pagination, errors and event updates.
- Reuse the bounded request helper, content sanitiser and account lifecycle. Do not add raw HTML insertion, arbitrary CSS, unbounded caches, credentials in URLs/logs, or cross-origin authenticated downloads.
- Account removal, credential revocation and private-channel membership changes must clear or invalidate each new cache and stop associated background work.
- Prefer new feature modules with narrow exported interfaces. Keep App integration changes separate from feature implementation commits where practical. Workers may propose shared interfaces in their progress files; the parent resolves conflicts.
- Use unique preview ports: A 4181, B 4182, C 4183. Each worktree gets its own dependencies and build output. Do not alter another worker's checkout or use its preview server.
- Do not deploy, publish APKs, change DNS, or push branches from worker sessions. Keep credentials and personal themes out of all commits. Use only Zoomerlip branding.

## Delivery order

1. Preserve and commit the tested baseline; prepare worktrees and launch the three workers.
2. Deliver drafts, search, attachments, autocomplete and typing/presence first. Review these vertical slices before integrating the remaining management and productivity features.
3. Integrate message actions, topic operations, notifications and channel management. Then integrate scheduling, reminders, snippets, interactive messages and organisation settings.
4. Run cross-feature tests after integration: permissions, account switches/removal, overlapping requests, event reconnects, drafts with uploads, moved search results, mute rules and notification deduplication.
5. Run the full MBP unit/build/browser/Android suite. Test narrow touch layouts, keyboard access, long conversations and large organisations. Physical-device testing was waived by the user; record that limitation.
6. Update README and feature coverage with verified behaviour and any explicit server-dependent gaps. Review the combined security and performance changes. Commit integrated results before releasing.
7. Stage the static release and signed Android APK. The parent handles authorised web deployment and Vibux Approver distribution. Any new hosting/DNS/push infrastructure still needs an explicit user decision. Verify served assets and APK metadata; do not equate an offered APK with installation on the phone.

## Completion criteria

Each feature has a reachable UI, verified API behaviour, loading/empty/error states, mobile and keyboard support, permission checks, and regression coverage appropriate to its risk. Passing mocks alone does not establish physical-device or push-delivery reliability. Record blocked server dependencies explicitly; never mark a placeholder or a link to the native client as implemented parity.
