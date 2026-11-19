# Independent reviews

Claude and GPT-6.2-Astra (high effort) reviewed the client independently. Reports describe the reviewed snapshot; line numbers may move.

Addressed in the custom-theme pass: palette storage merges, inactive-theme deletion, missing-ID fallback, duplicate IDs, CSS-value validation, light-palette capture, preview-control ownership, stale imports, explicit storage errors, and access to Appearance before login. Theme UI and browser persistence are covered by the new browser suite.

Also addressed: remote message classes cannot adopt app overlay styles; production builds include a CSP; Vite denies the local fixture directory; login helper/placeholder and toast contrast use corrected colours.

Still open: cross-tab account/session synchronization; revoked-access and terminal-auth cache purging; muted-user support; pagination/topic recovery generations and replay overflow; long-poll timeout; directory-event batching; long-history typing/image costs; keyboard/touch navigation and modal focus. These reports are findings, not a clean security sign-off.
