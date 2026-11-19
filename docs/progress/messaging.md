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
