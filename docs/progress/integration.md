# Integration checks

2026-11-19. Combined messaging `49e85a8`, organisation `02afd67` and notifications `ba3c915` on the tested security/profile/mobile baseline `d81da64`.

Shared session registration retains all three event consumers and account-revocation cleanup. The composer retains typing notifications alongside persistent drafts and uploads. Sidebar draft/schedule navigation uses the messaging components directly. Opening a notification dismisses any open search panel before showing the message.

Verified in an isolated MacBook Pro worktree:

- 183 unit tests across 29 files; TypeScript/Vite production build and formatting pass.
- UI, safety, scale, themes, messaging, organisation and notifications browser suites pass against intercepted APIs. No real organisation receives test writes.
- Added integration regressions for restoring a draft from the sidebar, viewing scheduled messages there, and opening a notification while search is open.
- Nine Android unit tests, release lint and release APK assembly pass. The APK bundles the integrated web build.

The initial combined messaging fixture matched both sidebar and composer buttons. Its selectors now identify the intended control; both entry points have coverage. Only the affected messaging/notification suites were rerun after those test changes.

Physical-device testing was waived. Closed-app Android push needs operator configuration and further native implementation; it is not part of this release. Exact server-version and administration limits remain in the three workstream progress files. Passing these checks does not establish full native-client parity or guarantee push delivery.
