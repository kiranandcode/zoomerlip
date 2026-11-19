# Workstream A: messaging

Worker checkout: `messaging`. Tests run here on Kirans-MacBook-Pro with `/opt/homebrew/opt/node@22/bin`. Preview port: 4181. No real organization writes, deployment, branch push, Docker or native changes.

## Slice 1: drafts

- Persistent drafts scoped by account and destination. Validated records; 100 drafts, 100,000 characters per draft, 2 MB account quota. Quota failures retain the editor and show an error.
- Draft list, restore and local deletion. Restoration saves an existing composition as a separate copy. Cross-tab conflicts preserve both versions.
- Explicit server copy sync. The server has no conditional draft update; distinct versions are retained rather than overwritten. Unsupported/disabled APIs show a local-only fallback. Reconnection never queues a send.
- Account removal, credential lock and channel access loss clear affected drafts and invalidate active composition. Small integration changes: Composer's `onSelect`, cache lifecycle, account removal and session event dispatch.
- Parent integration: `DraftList` is reusable for worker B navigation. `zoomerlip-messaging` carries account-scoped events; `zoomerlip-messaging-reset` cancels affected UI work. Worker C can use these hooks. Native attachment MIME support belongs to C.

References checked 2026-11-19: [draft API](https://zulip.com/api/get-drafts), [create drafts](https://zulip.com/api/create-drafts), [upstream views](https://github.com/zulip/zulip/blob/main/zerver/views/drafts.py), [validation and permissions](https://github.com/zulip/zulip/blob/main/zerver/lib/drafts.py), [OpenAPI](https://github.com/zulip/zulip/blob/main/zerver/openapi/zulip.yaml).

Validation and commit IDs are appended per increment below. Physical-device testing is waived. Server-dependent behavior uses intercepted fixtures; no claim of device verification.

Slice 1 checks: `npm test` — 128 passed; `npm run build` passed on Node 22. Includes account isolation, validation, conflict copies, revocation and failed sync regression coverage.

## Slice 2: attachments

Draft commit: `a76242f`. Attachments support file picker (`*/*` for worker C's native chooser), clipboard files and drop. Organization upload limits come from registration; missing/zero limits disable upload. Three concurrent files / 100 MiB retained-file budget. Indeterminate progress, cancellation, explicit retry and actionable failures. Links persist with the draft; sending waits for active uploads. Uses bounded `request`, redirect rejection, selected-account authentication and strict same-origin `/user_uploads/` response validation. Unmount/account invalidation cancels work. Cancellation can leave an unreferenced server upload; no automatic retry.

References: [upload API](https://zulip.com/api/upload-file), [upstream upload implementation](https://github.com/zulip/zulip/blob/main/zerver/views/upload.py). Standard multipart endpoint; resumable tus uploads are not implemented. Tests: 131 unit tests and production build passed (Node 22).

## Slice 3: composition

Attachment commit: `e6db91b`. Added cursor-aware mention and emoji autocomplete, bounded suggestions, stable user-ID mentions and active organization emoji. Arrow keys, Enter/Tab and Escape control a labelled listbox; composition events and keyCode 229 preserve IME behavior. Existing mobile Enter behavior is retained. Formatting operates on the selected range. Explicit preview calls Zulip's renderer and passes results through the existing MessageContent sanitizer; edits abort stale previews.

References: [render API](https://zulip.com/api/render-message), [custom emoji](https://zulip.com/api/get-custom-emoji), [upstream rendering](https://github.com/zulip/zulip/blob/main/zerver/views/message_send.py), [upstream emoji](https://github.com/zulip/zulip/blob/main/zerver/views/realm_emoji.py). Checks: 134 unit tests and production build passed. Browser checks follow after remaining UI slices.

Composition commit: `c72f4a4`.

## Slice 4: message actions

Confirmed permanent deletion, server permission errors, star/unstar, mark unread, sanitized edit history, permanent links with a selectable clipboard fallback, and raw-Markdown quote replies. Existing edit/reaction paths remain intact. Personal flag events update cached rows. History is bounded at 1,000 revisions and invalidated on live edits. Account invalidation cancels requests.

References: [delete](https://zulip.com/api/delete-message), [flags](https://zulip.com/api/update-message-flags), [history](https://zulip.com/api/get-message-history), [URLs](https://zulip.com/api/zulip-urls), [upstream edit/permissions](https://github.com/zulip/zulip/blob/main/zerver/views/message_edit.py), [upstream flags](https://github.com/zulip/zulip/blob/main/zerver/views/message_flags.py). Checks: 136 unit tests and production build passed.

## Slice 5: scheduling, reminders and snippets

Message-action commit: `bbfcccb`. Added server-backed create/list/edit/delete for scheduled messages and snippets; reminder creation from message actions, list/delete and explicit create-then-delete rescheduling. No browser delivery timers or reconnect sends. Dates show the browser timezone and convert to UTC seconds. Failed server deliveries are visible. Failed operations preserve editor values; ambiguous creation failures instruct users to refresh before retrying. Reminder replacement failures identify both IDs. Lists cap at 1,000 items; endpoints return all items without pagination. Live events, visibility and reconnect refresh open lists.

Feature gates: scheduling controls 184; snippets 297, editing 368; reminder creation 381, management 399, notes 415. Older servers display explicit fallback text. Reminder edit is not atomic because upstream has no update endpoint. Scheduling intentionally retains the original composer draft after success; scheduled list confirmation makes this explicit in follow-up UI verification.

References: [scheduled messages](https://zulip.com/api/get-scheduled-messages), [edit scheduled message](https://zulip.com/api/update-scheduled-message), [reminders](https://zulip.com/api/get-reminders), [snippets](https://zulip.com/api/get-saved-snippets), upstream [scheduling](https://github.com/zulip/zulip/blob/main/zerver/views/scheduled_messages.py), [reminders](https://github.com/zulip/zulip/blob/main/zerver/views/reminders.py), [snippets](https://github.com/zulip/zulip/blob/main/zerver/views/saved_snippets.py). Checks: 140 unit tests and production build passed.

## Slice 6: interactive messages

Productivity commit: `5d27486`. Added `/poll` and `/todo` draft builders, poll votes/unvotes, task completion toggles, new options/tasks and author-only title editing. POST `/submessage` payloads match upstream; message/submessage events are replayed by ID without duplicate toggles. History caps at 2,000 events / 256,000 characters and 1,000 options, with explicit fallback. Unknown widgets, invalid creators and unsupported servers do not expose broken controls. Conservative support floor: FL354, whose changelog explicitly documents the current submessage content-access behavior; older deployments get plain-text fallback.

References: [submessage events](https://zulip.com/api/get-events#submessage), [API changelog](https://zulip.com/api/changelog), [REST routing](https://github.com/zulip/zulip/blob/main/zproject/urls.py), [submessage endpoint](https://github.com/zulip/zulip/blob/main/zerver/views/submessage.py), [widget creation](https://github.com/zulip/zulip/blob/main/zerver/lib/widget.py), [poll protocol](https://github.com/zulip/zulip/blob/main/web/src/poll_data.ts), [to-do protocol](https://github.com/zulip/zulip/blob/main/web/src/todo_data.ts). This remains an experimental upstream protocol, not a stable endpoint specification. Checks: 145 unit tests and production build passed.

Interactive-message commit: `3a20ddf`.

## Final integration and regression fixes

All six messaging slices are implemented. This increment adds the intercepted messaging browser suite and README coverage, with these integration fixes:

- Explicit sends survive navigation, preserving the baseline late-send behavior. Pending sends are bounded and deduplicated by account/destination. Account or channel revocation aborts them; reconnect never replays them. Acknowledgement clears only an unchanged durable draft.
- The new action toggle is named “Message tools” to keep the existing mobile “Message actions” control unambiguous. Composer remains a textbox with accessible autocomplete. Cursor clamping and stale-selection guards prevent duplicate emoji text. Content and widget-type inputs have explicit labels.
- Draft conflicts include topic changes. Topic moves migrate durable drafts without replacing a conflicting destination draft. Registration and sync exclude inaccessible channel drafts. Server-copy deletion is separately confirmed. Storage read failures preserve access to the editor; failed writes remain visible.
- Account/access resets cancel previews, history, draft sync and productivity/widget requests. Event dispatch excludes unrelated events. Server productivity records are validated before rendering. Quote replies from views without a composer save a destination draft and navigate to it.
- Messaging panels use existing theme variables. Shared integration remains limited to Composer/MessageRow, quote navigation, cache invalidation/topic moves, and session capability/event registration.

Final verification: 2026-11-19, `Kirans-MacBook-Pro.local`, Node `22.23.3` at `/opt/homebrew/opt/node@22/bin`; 156 GiB free before browser runs. Built client served only at `http://127.0.0.1:4181`. Every organization request in browser suites was intercepted. No real organization writes occurred.

| Check | Exact outcome |
| --- | --- |
| `npm run format:check` | Passed; all matched files use Prettier style. |
| `npm test` | 151 tests passed across 22 files. |
| `npm run build` | TypeScript and Vite production build passed. |
| `scripts/test-ui.mjs` | Passed: 300-row typing isolation; keyboard navigation and focus; no-op edits; audience labels; 320px touch actions, picker fit and multiline Enter; dialog/drawer dismissal; late sends; 12 theme/accent contrast combinations; thread-menu keyboard/right-click, timed mute expiry and unread restoration. No external requests. |
| `scripts/test-safety.mjs` | Passed: pre-existing/live mutes; private-channel revocation purges history, profiles and composer; terminal 401 clears history and locks composition; late authentication cannot activate a closed login; cross-tab account removal stops both sessions and prevents restoration. |
| `scripts/test-scale.mjs` | Passed: 10,000 members; 25 initial DOM rows, 30 after scrolling; 75 ms from fixture response to visible member count. Scrolling and exact search passed. No external requests or page errors. |
| `scripts/test-themes.mjs` | Passed: import/export, safe preview/recovery, session-only writes, retained drafts, deletion undo, conflicting editors, copy recovery and two-tab preservation. |
| `scripts/test-messaging.mjs` | Passed: persistent drafts, keyboard autocomplete/IME, upload retry, sanitized preview, message actions, reminders, snippets, schedule failure/edit/failed-delivery state, live polls, to-do preparation, mobile layout and access revocation. |

The four baseline browser suites and messaging suite exited 0 on the final build. Raw logs remain ignored in `test-results/messaging-final-{ui,safety,scale,themes,features}.log`. `git diff --check` passed.

Handoff: worker B can use `DraftList` and `ProductivityPanel` for navigation. Preserve account-scoped `zoomerlip-messaging` and `zoomerlip-messaging-reset` events when integrating worker C's session changes. Android MIME picker changes and combined native checks belong to C/parent; this workstream did not modify Android. Physical-device testing remains waived. Server draft sync preserves snapshots; it is not automatic bidirectional replacement. Reminder rescheduling is non-atomic; tus resume is unavailable; widgets use an experimental upstream protocol. No deployment or branch push was performed.
