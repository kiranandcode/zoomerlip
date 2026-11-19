# Workstream B: search, topics and organisation

Worktree: `organisation`. Node: `/opt/homebrew/opt/node@22/bin`. Tests run on this MBP. No real-organisation writes, deployment, branch pushes or Docker.

## Search slice

Bounded message search, filters, pagination, keyboard result navigation and fetched context. Results live only in the mounted account workspace. Replacements abort stale requests. Membership, permissions, edits, deletion and reconnect invalidate results. Uses the existing request bounds, content sanitiser and attachment handling.

## API sources checked 2026-11-19

- https://zulip.com/api/get-messages
- https://zulip.com/api/construct-narrow
- https://zulip.com/api/get-message
- https://zulip.com/api/update-message
- https://zulip.com/api/update-user-topic
- https://github.com/zulip/zulip/blob/main/zerver/openapi/zulip.yaml
- https://github.com/zulip/zulip/blob/main/zerver/views/message_fetch.py
- https://github.com/zulip/zulip/blob/main/zerver/views/message_edit.py

## Integration contracts for parent

B owns App navigation. A retains Composer/MessageRow interfaces. New search state does not extend the shared `View` union. `invalidateOrganisation(accountId, events?)` has no retained credentials or messages; useSession calls it on relevant events/reconnect/lock. New panels unmount on account or credential changes.

Drafts/scheduled navigation will expose an account-scoped event contract for A. No parent agent handle is available in this standalone worker session; commits and this file are the handoff record.

## Limitations

Physical-device testing is waived. Topics and management slices are next.

## Validation

Search: 127 unit tests passed across 16 files. Production build passed with Node 22. Browser regression coverage follows with the topic/management fixtures.

## Parent report

Search core and App navigation are ready for integration review. Search, starred and mentions use `/`, `*`, `@` outside editable controls. Original channel/people filter is preserved. No shared View/Composer/MessageRow changes.


## Committed increments

- `c2a6ae5`: search modules, regression tests and scoped stylesheet.
- `a72ae27`: App navigation and session invalidation integration.

## Topic slice

Rename/move the whole topic, one selected message or that message and later messages. Re-fetch the anchor before mutation, validate its original topic/channel, confirm audience changes and merge consequences, and send notification flags explicitly. Resolve/reopen uses Zulip's checkmark-prefix convention. Server mutes require feature level 170; following requires 219. Browser timed mutes remain labelled separately. Organisation/group policies are evaluated conservatively; unknown groups hide actions. Server time-limit and permission errors preserve the form. Follow/mute and realm policy events update session state.

Validation: 131 unit tests across 17 files and production build passed. UI fixtures are next. New shared Session fields: `organisation` (allowlisted settings only) and `followedTopics`. Channel types add optional group-policy fields. Native Back discovers the panel's existing `.profile-back` selector; no native code change.

Additional sources:
- https://zulip.com/api/group-setting-values
- https://zulip.com/api/get-user-groups
- https://zulip.com/api/roles-and-permissions
- https://zulip.com/api/update-stream
- https://github.com/zulip/zulip/blob/main/zerver/views/streams.py
- https://github.com/zulip/zulip/blob/main/zerver/views/user_groups.py
