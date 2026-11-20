# Feature parity follow-up

## Android smoothness — implemented and tested

The initial drawer appeared without motion, and the shell used only `100dvh`, which does not follow visual-only keyboard resizing. The shell now follows visual viewport height/offset in one animation frame, without React state updates. Pinch zoom retains the existing layout. Native WebView inset resizing remains authoritative; browser sizing uses the already-resized viewport and does not subtract keyboard height again.

Drawer entrances use a 140 ms transform/opacity animation. Menus/backdrops fade over 100 ms. Dismissal and actions remain immediate. Both the system reduced-motion setting and the app motion preference suppress animations. Touch targets have immediate pressed feedback. Menu geometry updates are coalesced per frame; nested menus/navigation contain overscroll.

Verification: 183 unit tests passed; TypeScript/Vite production build passed. Intercepted UI fixtures passed, including visual-only keyboard resize, bottom pinning, unchanged reading anchor, no message rerender during resize, pinch zoom, landscape rotation, drawer/menu dismissal, both motion overrides, and the existing 320 px touch checks. Android release unit tests, lint and unsigned assembly passed offline. Native checks cover repeated IME insets, keyboard dismissal, retained WebView on rotation, and Back routing. No physical-device verification or frame-rate claim. Android version is unchanged.

Sources: [Chrome keyboard viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior/), [Android keyboard and insets](https://developer.android.com/develop/ui/views/layout/sw-keyboard).

## Audit

Audited `docs/implementation-plan.md`, all four earlier progress reports, and the actual `App`, messaging, organisation, live, notification and Android modules against the official [web-client help index](https://zulip.com/help/) and linked API schemas. Historical worker reports describe slices, not complete parity. Their pending integration notes are superseded by the integrated code and `integration.md`. “All architecture-feasible C slices” overstated presence coverage: the member list and avatars lacked indicators before this follow-up.

Supported means the named UI/API path exists. Partial means material upstream behavior is absent. Missing client work is not mislabeled an infrastructure blocker.

| Area | Coverage at audit | Evidence / remaining work |
| --- | --- | --- |
| Mobile navigation and composer | Supported | Compact composer, channel-first sidebar, More utilities, touch actions, keyboard resize and motion overrides. Automated checks only. |
| Multiple organisations and access invalidation | Supported | Direct account-scoped requests, event queues, revocation cleanup, account switching/removal. API-key login does not reproduce every upstream SSO/password recovery flow. |
| Message reading/sending/editing | Supported | Bounded history, paging, live events, sanitization, edit/delete, reactions, quotes, links, stars, unread. Server permissions remain authoritative. |
| Markdown composition | Partial | Formatting, preview, mentions and emoji exist. Full upstream shortcut/completion catalog and specialized integrations are not replicated. |
| Drafts | Partial | Durable local drafts and explicit server-copy sync; no automatic bidirectional sync. [Draft API](https://zulip.com/api/get-drafts) exists; automatic conflict handling remains client work. |
| Uploads | Partial | Picker, paste/drop, cancellation/retry and native MIME support. No resumable tus uploads or uploaded-file management UI. |
| Scheduled messages/snippets | Supported | Create/list/edit/delete with feature gates and failed delivery states. |
| Reminders | Partial | Create/list/delete and create-then-delete rescheduling. Public [reminder API](https://zulip.com/api/get-reminders) has no atomic update endpoint. |
| Polls/to-do lists | Partial | Creation, voting/completion and live events; experimental upstream submessage protocol and conservative feature gate. |
| Search | Supported | Raw query/operators, filter controls, paging, keyboard navigation and context opening. Bounded retained results. |
| Topics | Partial | Move/rename/resolve/follow/server mute plus separate local timed mute. Empty-topic workflows, topic deletion and full topic-policy administration remain absent. |
| Channel directory | Partial | Join/leave/create, name/description/privacy and member editing. Archive/restore and archived discovery were missing at audit; now implemented. History-policy editing and permission-policy editors remain missing. |
| Presence | Partial → supported for indicators | Existing polling/events/status editor; this increment adds avatar/member indicators and fixes active-to-idle expiry. [Presence schema](https://zulip.com/api/update-presence). |
| Status | Partial | Text and selected emoji editing, online-sharing setting. Full emoji chooser absent. No expiry parameter in [status API](https://zulip.com/api/update-status); no local timer pretending to synchronize expiry. |
| Typing/read receipts | Supported | Throttled typing, expiry, per-account isolation, server policy and feature gates. |
| Notifications | Partial | Browser/foreground native alerts, settings, private previews, read suppression and deduplication. Closed-app delivery blocked as detailed below. |
| Invitations/members | Partial | Email invitations, list/revoke, names/roles and deactivate/reactivate. Resend/reusable-link creation, email/profile administration absent. |
| User groups | Partial | Create/edit/deactivate and direct membership. Nested groups and full group-policy editors absent. |
| Organisation settings | Partial | Three new-user notification defaults. No general public `PATCH /realm` schema in the current [API index](https://zulip.com/api/); remaining supported per-resource endpoints still need UI. |
| Personal settings | Partial | Themes, appearance, profile and notification preferences. Full language/time-zone/home-view/shortcut/account-security preferences absent. |
| Other official web tools | Missing | Alert words, user mute management, channel folders, navigation views, upload management, linkifiers, custom emoji/profile-field administration, exports and integration management. These are separate client feature work, not claims of API impossibility. |

## Presence — implemented and tested

Avatars in messages, individual DM cards, people navigation, profiles and the account footer display accessible availability indicators. The windowed member list includes availability and status text/emoji without changing row height. Group DM cards do not imply a single participant's presence. Unavailable data is distinct from offline; invisible self-state is respected. Primitive store snapshots isolate presence/status rerenders from typing events and message bodies.

Fixed expiry notification when an active timestamp expires while a newer idle timestamp remains. Live events remain account-scoped; access invalidation clears presence/status data. Verification: 184 unit tests, production build, intercepted presence/notification fixtures and the 10,000-member scale fixture passed (25 initial / 30 scrolled rows). The full UI suite also passed, including mobile viewport regressions. Sources: [presence](https://zulip.com/api/update-presence), [status](https://zulip.com/api/update-status).

## Channel archive/restore — implemented and tested

The directory separates active and archived channels. Archived discovery requires feature level 315. Administrators request all metadata-accessible channels with the versioned `include_all`/`include_all_active` parameter. Archive uses administrator-only `DELETE /streams/{id}`. Restore uses `PATCH /streams/{id}` with `is_archived=false`, requires feature level 388 and channel administration permission. Both explain consequences and require confirmation. Archived channels expose neither joining nor membership/settings mutation controls. Errors preserve the selected channel for retry.

Archive events immediately remove active navigation and unread state, triggering existing cache/draft access cleanup. Restore events renew registration to load actual subscriptions; metadata access never implies membership. This increment's `useSession` change is confined to that renewal condition. It does not implement read acknowledgement.

Verification: 187 unit tests across 30 files, production build, organisation browser fixtures and safety browser fixtures passed. New checks cover role/version gates, archive query parameters, cancellation without writes, permission-error retries, archived control suppression and subscription restoration. Existing revocation, terminal-authentication and cross-tab-removal checks pass. All API mutations were intercepted.

Sources: [archive](https://zulip.com/api/archive-stream), [restore parameter](https://zulip.com/api/update-stream), [directory/version gates](https://zulip.com/api/get-streams), [upstream archive events](https://github.com/zulip/zulip/blob/main/zerver/actions/streams.py).

## Exact blockers and limits

- Closed-app Android push needs a compatible Firebase application/project and bouncer operator support, server registration/configuration, device/token/key registration and native receipt/decryption. No such infrastructure or credentials were supplied. Existing notifications depend on a running WebView; see `notifications.md` for endpoint and protocol details. This work adds no push service.
- Status expiry and atomic reminder rescheduling have no documented public mutation parameter/endpoint in the audited schemas. Browser timers cannot guarantee either across devices or closed apps.
- Older servers require feature-gated fallbacks. Unknown permission grants fail closed; server errors retain input. Legacy full-member waiting-period eligibility is not inferred.
- Physical-device testing remains waived. Browser touch fixtures and Robolectric verify contracts, not physical keyboard animation or frame-rate reliability.
- Remaining missing client tools in the matrix are backlog, not external blockers. Full upstream parity is not claimed.

## Commits

- `af36b7c`: mobile viewport sizing, restrained transitions and touch/native regression coverage.
- `5579193`: live presence on avatars/member rows, expiry fix and supported/partial/missing audit.
