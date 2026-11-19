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

Drafts/scheduled navigation uses a lazy adapter for A’s existing `DraftList`, `drafts` and `ProductivityPanel` exports. Entries activate when those modules are present in the integrated build; this worktree does not copy A’s implementation. No parent agent handle is available in this standalone worker session; commits and this file are the handoff record.

## Limitations

Physical-device testing is waived. Management browser checks and final integration review are in progress.

## Validation

Search: 127 unit tests passed across 16 files. Production build passed with Node 22. Browser regression coverage follows with the topic/management fixtures.

## Parent report

Search core and App navigation are ready for integration review. Search, starred and mentions use `/`, `*`, `@` outside editable controls. Original channel/people filter is preserved. No shared View/Composer/MessageRow changes.


## Committed increments

- `c2a6ae5`: search modules, regression tests and scoped stylesheet.
- `a72ae27`: App navigation and session invalidation integration.
- `0cd0c9e`: permission-aware topic operations and server preferences.

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


## Channel and organisation slices

Channel directory supports filtering, bounded rendering, inspection, join/leave, creation, name/description/privacy edits and member additions/removals. Privacy and leaving explain access/history consequences and require confirmation. Group permissions and current roles gate controls. Name-based subscription operations resolve the channel name by ID first. Feature level 417 uses the dedicated create endpoint; older servers use documented subscription-based creation.

Organisation controls cover invitation creation/list/revocation, member display names and roles, deactivation/reactivation, user-group creation/metadata/members/deactivation, and three notification defaults for future members. Destructive and privilege-changing actions require confirmation. Failed mutations retain inputs; unsupported parameters report a possible partial save. User-group events invalidate permission data; defaults use documented `property`/`value` events.

Validation so far: 140 unit tests across 18 files and production build pass. Existing UI suite passes, including 320px layouts, keyboard/focus, thread mutes, profile edits and mobile drawer dismissal. The dedicated B browser suite is still being refined; no real organisation has been contacted.

Additional sources:
- https://zulip.com/api/get-streams
- https://zulip.com/api/subscribe
- https://zulip.com/api/unsubscribe
- https://zulip.com/api/create-channel
- https://zulip.com/api/get-subscribers
- https://zulip.com/api/get-invites
- https://zulip.com/api/send-invites
- https://zulip.com/api/revoke-invite
- https://zulip.com/api/revoke-multiuse-invite
- https://zulip.com/api/update-user
- https://zulip.com/api/deactivate-user
- https://zulip.com/api/reactivate-user
- https://zulip.com/api/create-user-group
- https://zulip.com/api/update-user-group
- https://zulip.com/api/update-user-group-members
- https://zulip.com/api/deactivate-user-group
- https://zulip.com/api/update-realm-user-settings-defaults
- https://github.com/zulip/zulip/blob/main/zerver/views/users.py
- https://github.com/zulip/zulip/blob/main/zerver/views/invite.py
- https://github.com/zulip/zulip/blob/main/zerver/views/user_settings.py

## Exact remaining coverage

- General organisation name/description, authentication, retention, billing and permission-policy writes are not exposed. The audited public schema has no general `PATCH /realm` endpoint. Only the three documented new-user notification defaults are editable here.
- No web-public privacy conversion, history-policy editor, channel archive/delete, nested-group editing, invitation resend/reusable-link creation, email/profile-field administration or self-role changes.
- Topic creation/rename to an empty topic is not exposed. Legacy timed mutes remain browser-local. Server topic preferences require feature level 170; following requires 219. Unknown group grants and legacy full-member waiting-period eligibility fail closed.
- User groups render 100 matches, invitations 200 entries, channel subscribers 100 names, search 200 retained results. Directories have explicit 10,000-channel and 50,000-member limits. Search can continue paging after discarding older retained pages.
- Parent must integrate A before verifying DraftList restore and scheduled-item navigation. `Alt+D` / `Alt+S` activate only when A modules exist. Preserve C’s `notificationTarget` Workspace integration and `OrgCache.load(view, force, requestedAnchor?)` extension during the App merge; B does not change cache loading.
