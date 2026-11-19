# Zoomerlip review: security, safety, accessibility, performance

Reviewed `main` at `6e78ff7` (clean tree). I read every source file and ran only read-only checks. Nothing was sent to any Zulip server, no hosting or DNS was touched, no application code was edited, and no credentials were read or exposed.

**Checks run**
- `npx vitest run`: 22/22 pass
- `npx tsc -b --noEmit`: clean
- `npm audit`: 0 vulnerabilities
- WCAG contrast computed with a small Node script

Findings are ranked most severe first within each section.

---

## Security and safety

### S1. A hostile org can restyle the app with message classes and fake its UI (Medium)
- **Where:** `src/content.ts:38-46` allows `class` on every allowed tag. `src/style.css:1111` defines `.modal` as `position: fixed; inset: 0; z-index: 20`, and `.toast` is also fixed (`style.css:1116`).
- **Problem:** Zoomerlip accepts any HTTPS org URL. That server fully controls `rendered_content`, so it can send `<div class="modal"><div class="login-screen">…</div></div>` or `class="toast"` with links. The result is a full-screen overlay styled like Zoomerlip, shown while you are in *that* org's view. It can imitate a "Sign in again" screen and link to a phishing page that asks for another org's credentials. Forms and inputs are stripped, so this is UI redress and phishing, not direct key theft. But it crosses the trust boundary between orgs that a multi-org client has to keep.
- **Fix:** Drop `class` from `ALLOWED_ATTR`. Or keep it and filter with DOMPurify's `uponSanitizeAttribute` hook against an allowlist of Zulip markdown classes (`emoji`, `emoji-*`, `user-mention`, `spoiler-*`, `codehilite`, `message_inline_image`, `katex*`, …). Also scope app CSS so `.message-content .modal` and similar can't match: prefix app classes, or add `.message-content * { position: static !important }`. Add a test that `class="modal"` is stripped.

### S2. No CSP even though the page holds API keys for every org (Medium, defence in depth)
- **Where:** `index.html:1-15` has no `<meta http-equiv="Content-Security-Policy">`. `README.md:57` only mentions `frame-ancestors` for the future host. API keys for all orgs sit in plain `localStorage` (`src/api.ts:150`).
- **Problem:** DOMPurify is the only XSS barrier. A sanitizer bypass, or a bad dependency, could read every org's key in one go.
- **Fix:** Ship a strict CSP:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'` (React inline `style` props need this)
  - `img-src https: data:`
  - `connect-src https: http://localhost:* http://127.0.0.1:*`
  - `object-src 'none'`
  - `base-uri 'none'`
  - `form-action 'none'`

  Put it in a meta tag so it travels with `dist/`. Add `frame-ancestors 'none'` as a header on the host, since meta tags ignore it. Consider also `require-trusted-types-for 'script'`.

### S3. One malformed saved account wipes the whole account list (Low–Medium, data safety)
- **Where:** `src/api.ts:131-148`. `normalizeOrg(a.url)` is called inside the `.filter` predicate. It **throws** on a bad URL (e.g. a non-string, or a stored `http://` non-loopback origin), and the outer `catch` returns `[]`.
- **Problem:** Every saved org disappears, not just the bad one. The next `saveAccounts` (on any login) then overwrites storage, so the other orgs' keys are lost for good.
- **Fix:** Wrap the per-entry check in its own `try { … } catch { return false }` so only the invalid entry is dropped.

### S4. Two open tabs overwrite each other's account changes (Low)
- **Where:** `src/App.tsx:72-86`. `update(next)` writes a list built from this tab's in-memory `accounts`, and nothing listens for `storage` events.
- **Problem:** Add an org in tab A, then remove a different org in tab B. B's write drops A's new org. Worse, a removal in A can be undone by B, so a key you thought you deleted is restored.
- **Fix:** Re-read `readAccounts()` inside `update` before merging. Add a `window.addEventListener("storage", …)` that syncs `accounts`.

### S5. Event-loop retries skip the backoff and replay events (Low)
- **Where:** `src/useSession.ts:155-161`. `BAD_EVENT_QUEUE_ID` does `continue` with no pause. If `/register` succeeds but the queue keeps getting GC'd (server misconfiguration, clock problems), the client hits `/register` in a tight loop.
- **Where:** `src/useSession.ts:105-149`. `cache.events(...)` journals the whole batch first. If the `subscription`/`realm_user` re-fetch at lines 121-136 throws, `last` hasn't moved past the remaining events, so the batch is fetched and journaled again. The cache tolerates this (dedupe), but `unread` is counted twice.
- **Fix:** Apply backoff (or at least `pause(1000)`) on queue-ID errors. Advance `last` per event before the awaited re-fetch, or move the re-fetch out of the loop (see P2).

### S6. Minor hardening
- `src/content.ts:77`: `http:` images are allowed. On an HTTPS deploy they become mixed content and leak the user's IP and Referer-less requests over plaintext. Restrict `img` to `https:`, or same-origin with the org when the org is loopback.
- `src/content.ts:106`: attachment anchors become `href="#attachment"`. Middle-click or Ctrl-click opens the app itself in a new tab instead of the file. Use a `<button>`, or keep the anchor but handle `auxclick`.
- `src/api.ts:49`: `URLSearchParams.size` only exists in Safari ≥ 17 and Chrome ≥ 113. On older browsers `body.size` is `undefined`, so **every GET drops its query string**: `/messages` with no narrow or anchor, `/events` with no `queue_id`. Use `body.toString()` and check that it's non-empty.

---

## Correctness and design

### D1. A stalled long-poll stays "Live" forever (Medium)
- **Where:** `src/useSession.ts:92-103`.
- **Problem 1:** Status is set to `"Live"` *before* `/events` is awaited, so after any failure the UI says Live while the retry is still in flight.
- **Problem 2:** The long-poll has no client timeout. If the network silently drops the TCP connection (laptop sleep, NAT rebinding, captive portal), `fetch` can hang indefinitely. Zulip sends a heartbeat at least every ~60 s, so a gap of more than ~90 s means the queue is dead. The client never notices, and messages simply stop arriving.
- **Fix:**
  - Add `AbortSignal.any([signal, AbortSignal.timeout(90_000)])` (or a manual timer) to the `/events` request, and treat a timeout as a reconnect.
  - Set `"Live"` only after a successful `/events` response.
  - Re-check after a `visibilitychange` or `online` event.

### D2. The DM home list only shows DMs from the last 60 private messages (Medium)
- **Where:** `src/App.tsx:705-716`, which builds `dms` from `messages`. That list is loaded by `cache.load` with `num_before: 60` (`src/cache.ts:218`) for the `is:private` narrow (`src/api.ts:88`).
- **Problem:** Any 1:1 or group conversation whose last message is older than the newest 60 DMs never appears in "Direct messages". "Load older" fills it in, but only if you know to click it. People can only be reached through search or the member list.
- **Fix:** Build the list from `/register`'s `recent_private_conversations`. Add it to `fetch_event_types`, and keep it current from `message` events.

### D3. Deprecated narrow operators (Low)
- `src/api.ts:88-90` uses `is:private` and `pm-with`. Zulip ≥ 7 (feature level 177) renamed these to `is:dm` and `dm`. The old names still work on 13.3 but are deprecated.
- **Fix:** Pick the operator by feature level, using `zulip_feature_level` from `/register`.

### D4. Smaller design defects
- `src/useSession.ts:116-142`: `realm` events trigger a subscriptions and users refetch, but `name` (the realm name) is never updated. Renaming the org isn't reflected.
- `src/App.tsx:288`: the org header shows a `ChevronDown` that suggests a menu, but nothing happens on click.
- `src/App.tsx:931-947`: the edit form submits even when the text is unchanged, which creates a no-op edit-history entry on some servers. Enter in the edit textarea inserts a newline rather than saving, which is inconsistent with the composer.

---

## Accessibility

### A1. The "Add organization" modal isn't a real modal (Medium)
- **Where:** `src/App.tsx:164-173`. It is a `div role="dialog" aria-modal="true"` with no focus trap, no Escape handling, and nothing making the background inert. Tab moves straight into the app behind it.
- **Contrast:** `Appearance` correctly uses `<dialog>.showModal()` (`src/components/Appearance.tsx:9`).
- **Fix:** Use `<dialog>` + `showModal()` and handle `onCancel`, as `Appearance` does.

### A2. Emoji picker and message actions are hard to use from the keyboard and on touch (Medium)
- `src/App.tsx:1050-1085`: when the picker opens, focus doesn't move into it, Escape doesn't close it, and closing doesn't return focus to the trigger. Labels are raw shortcodes (`aria-label="+1"`), which screen readers read as "plus one". Use human names: "thumbs up", "heart".
- `src/style.css:618-631`: `.message-actions` uses `display: none` until `:hover`/`:focus-within`. On touch screens the actions appear only if you happen to tap the article (it has `tabIndex=0`). There's no long-press or visible affordance, so reacting, replying and editing are effectively undiscoverable on mobile.
- `src/App.tsx:883`: every message is `tabIndex={0}`. A 300-message view means 300 extra tab stops before the composer.
- **Fix:** Give the message list one roving tab stop (arrow keys move between messages). Add a "skip to composer" link.

### A3. Virtualized member list loses focus and set semantics (Medium)
- **Where:** `src/components/MemberList.tsx:31-73`.
- **Problem 1:** If you Tab onto a member and then scroll, the focused button is unmounted once it leaves `start…end`, so focus drops to `<body>`.
- **Problem 2:** The absolutely positioned buttons carry no `role="list"`/`listitem`, `aria-setsize` or `aria-posinset`, so screen readers can't tell how long the list is.
- **Problem 3:** Every member is labelled "Member", even admins and owners.
- **Fix:** Always render the focused index, give the window list semantics, and add `aria-setsize` and `aria-posinset`.

### A4. Text is too small across the UI (Medium)
- `src/style.css` and `src/theme.css` have **38** declarations of `font-size: 8px`, `9px` or `10px`. Examples:
  - `.group-time` at 8px (`theme.css:434`, `style.css:610`)
  - `.compose-hint` at 9px (`theme.css:509`), shrinking to 8px on mobile (`style.css:1236`)
  - `.message-meta time` at 9px on mobile (`style.css:1277`)
- Below about 11–12px, text is illegible for many users. The Appearance text-size slider (`--message-size`) only scales message bodies, not this chrome.
- **Fix:** Set a floor of 11px (12px for anything interactive), and express chrome sizes relative to the user's setting (`rem` / `calc(var(--message-size) * 0.75)`).

### A5. Contrast failures (Low–Medium)
- **Light-theme error toast:** `.toast { background: #543a32 }` (`src/style.css:1116`) has no theme override and inherits `--text: #242b37` in the light theme. That is **1.37:1**, so the text is essentially invisible. This is the storage-failure alert users most need to read.
- **Light theme `--muted` on `--sidebar`:** #636f80 on #edf0f3 is **4.46:1**, just under AA 4.5:1 for small text.
- **Light accent text on `--field`:** #367c5c on #e4e8ed is **4.07:1**.

### A6. Smaller accessibility issues
- `src/App.tsx:115-133`: the org-rail unread badge is visual only. Use `aria-label={`Open ${name}${unread ? `, ${unread} unread` : ""}`}`.
- `src/App.tsx:277-286`: the connection status ("Connecting" / "Live" / "Reconnecting") isn't in a live region.
- `src/App.tsx:489-495`: the mobile nav toggle has no `aria-expanded`. The open sidebar (`style.css:1208`) has no Escape handling and no scrim to close it.
- `src/components/Login.tsx:102-123`: the Password / API-key switch shows its state only through `className="active"`. Add `aria-pressed` or tab semantics.
- `src/App.tsx:1147`: the topic input `maxLength={60}` silently truncates pasted text. Show a counter.

---

## Performance

### P1. Every keystroke and every background event re-renders the whole message list (Medium)
- **Where:** `src/App.tsx:565-1194`. `Conversation` owns the composer `text` state, so each keystroke re-runs the whole `messages.map`. That rebuilds a reactions `Map` per message, makes several `new Date(...)` and `toLocale*` calls per message, and recreates every inline closure. `MessageContent`/`Avatar` are memoized, but the rows are not.
- **Also:** `useSession` (`src/useSession.ts:148`) bumps `unread` on **background** orgs. That changes `sessions` in `App` (`App.tsx:68-70`) and re-renders `Workspace`, then `Conversation` and the full list for the *active* org, even though nothing in it changed.
- **Effect:** After a few "Load older" clicks there are hundreds of rows, and typing becomes noticeably laggy.
- **Fix:**
  - Pull the message row out into a `memo` component keyed on `message`.
  - Move composer state into its own `Composer` component.
  - Memoize `Conversation`.
  - Pass only the active session into `Workspace`; keep background unread counts in a separate small store.

### P2. A full member and subscription refetch on every `realm_user` / `subscription` event (Medium for large orgs)
- **Where:** `src/useSession.ts:116-142`. Each such event triggers `GET /users` (the whole roster) and `GET /users/me/subscriptions`, sequentially inside the per-event loop.
- **Problem:** In a 10k-member org, routine `realm_user` updates (avatar, name or timezone changes) cost one full-roster download each. A batch of N such events means N sequential round trips while the event loop is blocked.
- **Fix:** Apply `realm_user` `op: add | update | remove` and `subscription` ops locally from the event payload, as the Zulip web app does. At minimum, coalesce to one refetch per batch, after the loop.

### P3. Private-image URLs are resolved eagerly for every message on every mount (Medium)
- **Where:** `src/components/MessageContent.tsx:34-52`. Every `img[data-upload]` immediately calls `GET /user_uploads/...` for a temporary URL and sets `loading = "eager"`, even for images far off-screen. Unmounting (any navigation, since `Conversation` is keyed by view at `App.tsx:535`) aborts and clears them, so revisiting the view does it all again.
- **Problem:** An image-heavy channel fires dozens of authenticated API calls per visit. That can hit Zulip's default rate limit (~200 requests/min per user) and then break sends and the event queue.
- **Fix:**
  - Resolve with an `IntersectionObserver` when the image nears the viewport.
  - Cache temporary URLs in memory per upload path, with a TTL shorter than the server's (~60 s), so nothing is persisted.
  - Honour `Retry-After` on 429s in `request`.

### P4. Smaller costs
- `src/App.tsx:799-817`: the DM list calls `users.find(...)` per participant, plus once more for the avatar, on every render. That's O(DMs × participants × users), roughly 10⁶ comparisons at 10k members. Build a `Map<user_id, User>` once per `users` change and reuse it; `title` at `App.tsx:258-269` and `ProfilePage` would also benefit.
- `src/cache.ts:313-348`: a move event flattens every cached message (up to 24 × 300+) and loops it per entry. Then it force-reloads every subscribed view (`cache.ts:389-396`). This is acceptable now, but filter `known` to `event.message_ids` first.
- `src/cache.ts:70`: every live message re-sorts the whole array (`[...messages, message].sort`). Append when `message.id > last.id`, which is the common case.

---

## Suggested order
1. **S1 + S2:** close the cross-org UI-redress path and add a CSP. Both are small changes.
2. **D1:** the long-poll watchdog. Without it, a silently dead connection loses messages.
3. **S3, A5:** the light-theme toast, and the account-list wipe.
4. **P1, P3:** typing lag, and the rate-limit risk.
5. **A1–A4:** keyboard and touch access, and a text-size floor.
6. **D2, P2:** both need the `/register` data used properly.

---

## Addendum: custom theme editor (uncommitted working tree)

**Scope:** the uncommitted changes on top of `6e78ff7`:
- new: `src/customThemes.ts`, `src/components/CustomThemes.tsx`, `tests/themes.test.ts`
- modified: `src/appearance.ts`, `src/components/Appearance.tsx`, `src/components/Login.tsx`, `src/theme.css`

The files were being reformatted while I reviewed them, so line numbers refer to the state I read.

**Checks run**
- `npx tsc -b --noEmit`: clean
- `npx prettier --check src tests`: clean (after the concurrent reformat)
- `npx vitest run`: **9 of 31 tests fail, all of them in `tests/themes.test.ts`** (see T1)

**What holds up:** the validation core is sound.
- `parseTheme` accepts only `version: 1`, a trimmed name of at most 48 characters, `base` of `dark` or `light`, and exactly the nine known keys as `#rrggbb`.
- Any other key is dropped, so an imported file cannot smuggle CSS, `url(...)`, extra variables or credentials into storage or exports.
- Names render as React text only.
- `readThemes` checks each entry on its own and drops bad ones without losing the rest. That is the right pattern; `readAccounts` (S3) should copy it.
- Imports are capped at 32 KB before they are read.
- Exports go through `themeJSON`, which writes only `version`, `name`, `base` and `colours`, with no `id` and no preferences.

I found no injection path. The defects are in robustness, recovery, UX and testing.

### T1. The theme tests never run in a DOM, so none of the validation claims are verified (Medium)
- **Where:** `tests/themes.test.ts` has no `// @vitest-environment jsdom` header. `tests/core.test.ts:1` has one, and there is no vitest config that sets a default environment.
- **Result:** under Node, `localStorage` and `document` are undefined.
  - `afterEach` throws `TypeError: Cannot read properties of undefined (reading 'clear')` (`themes.test.ts:28`), which fails every test, including the pure `parseTheme` rejection cases.
  - The round-trip test fails earlier still: `writeThemes` turns the missing storage into "Browser storage is unavailable or full".
- **Effect:** the injection-rejection and storage-failure tests give no evidence today, and `npm test` is red.
- **Fix:** add the jsdom header. Then make sure the `#fff` case (T2) has a test that reaches `captureTheme` under the light theme.

### T2. "Create theme" fails silently while the built-in Light theme is active (Medium)
- **Where:** `src/theme.css:39` declares `--surface: #fff;`, the only built-in token that isn't six-digit hex. `captureTheme` (`src/customThemes.ts:126-136`) reads the computed custom property verbatim and passes it to `parseTheme`, which throws "surface must be a six-digit hex colour".
- **Problem:** the `Create theme` click handler (`src/components/CustomThemes.tsx:173-176`) has no `try`/`catch`. The exception escapes the React event handler, the user sees nothing, and the button looks dead. This is the exact path a light-theme user takes to start a theme.
- **Fix:**
  - Change the token to `#ffffff`.
  - Make `captureTheme` normalise colours. Expand `#rgb`, or read them through a canvas `fillStyle` round-trip, and fall back to the default palette per key.
  - Wrap the handler and route errors to `setError`.
  - Add a test that captures from `data-theme="light"`.

### T3. Nothing stops you saving an unreadable theme, and the only way out is clearing site data (Medium, safety)
- **Where:** `src/components/CustomThemes.tsx:109-114` and `263-267`.
- **Problem 1:** the contrast ratio is advisory, and `save()` (`52-67`) persists any palette.
- **Problem 2:** imported files go live immediately, because the `useEffect` at `38-51` previews `draft`.
- **Example:** a file with every colour set to `#000000`, or `text` equal to `surface`, blanks the whole app *including the Appearance dialog*. Escape before saving restores the old theme. After **Save**, it persists in `zoomerlip.themes.v1` and is re-applied at startup (`src/main.tsx:13`, through `applyPreferences`). The "Reset appearance" button, the theme picker and the Login screen (which now also opens Appearance) are all painted in the same invisible colours.
- **Fix:**
  - Refuse to save, or require explicit confirmation, below a floor such as 3:1 for `text` and `secondary` on `surface`, `sidebar` and `field`.
  - Show imported files as a non-applied preview until the user confirms.
  - Add a recovery path that doesn't depend on the theme: a `?safe-theme` / `#reset-appearance` URL flag checked in `main.tsx`, or keep the Reset button on fixed system colours (`Canvas` / `CanvasText`).

### T4. The contrast check measures one pair and the colour labels describe the wrong roles (Low–Medium, accessibility)
- **One pair only:** `ratio` (`CustomThemes.tsx:109-114`) checks `secondary` on `surface` and nothing else. These pairs are unchecked:
  - `--text` on `--sidebar` and `--surface`: `:root { color: var(--text) }` at `theme.css:21` makes it the default colour for *all* text, inputs and buttons.
  - `--muted` on `--sidebar`: the timestamps and hints.
  - `--accent` as text on `--surface`: links (`theme.css:412`), thread dividers and the pressed custom theme.
- **Labels:**
  - `labels.text = "Headings"` (`CustomThemes.tsx:22`) undersells the global body colour, so users will tune it as a heading colour and break everything else.
  - `raised` is labelled "Composer" but is also used for other raised surfaces.
- **Fix:** label `text` "Main text" and check all the pairs above. Show each failing pair by name rather than reporting a single ratio.

### T5. While a custom theme is active, the accent picker still accepts clicks but changes nothing (Low, design)
- **Where:** `applyCustomTheme` (`src/customThemes.ts:109-125`) sets `--accent` inline. That beats `:root[data-accent=…]`, so the four accent swatches stay clickable and `aria-pressed` but have no visible effect.
- **Fix:** disable or hide the accent fieldset when `theme === "custom"`, or make the swatch write into the active custom theme.

### T6. Colour-picker drags restyle the whole document several times per input event (Low–Medium, performance)
- **Where:** `CustomThemes.tsx:38-51`. Each `draft` change runs the previous effect's cleanup (`applyPreferences`) and then the new effect (`applyPreferences` then `applyCustomTheme`).
- **Cost:** each `applyPreferences` clears 13 inline properties, calls `readThemes()` (a `localStorage` read plus a JSON parse) and re-sets up to 13 properties on `<html>`. React's `onChange` on `<input type="color">` fires continuously while dragging. That is two storage reads and three full-document style invalidations per event, multiplied by the size of an open conversation behind the dialog.
- **Fix:**
  - Preview with `applyCustomTheme` alone, batched in `requestAnimationFrame`.
  - Restore with `applyPreferences` only on cancel or unmount.
  - Cache the parsed theme list in memory instead of re-reading storage on every apply.

### T7. Smaller issues
- **Delete is immediate:** `CustomThemes.tsx:155-166` has no confirmation or undo. Its target is about 18 px tall (`theme.css`: `.custom-theme-row > button { font-size: 10px; padding: 4px }`), below WCAG 2.5.8's 24 × 24 px minimum, and it sits right next to Edit and Export. Several new rules use 10–11 px text (`.colour-grid label > span`, `.theme-contrast`), adding to A4.
- **Unsaved edits vanish:** Escape on the Appearance dialog (`Appearance.tsx` `onCancel`) unmounts the editor and silently throws away the draft.
- **Stale theme ids:** if `prefs.customId` names a theme that was deleted in another tab, `applyPreferences` (`src/appearance.ts`) falls back to graphite. `prefs.theme` stays `"custom"`, though, so no theme button in the dialog shows as selected. Cross-tab writes to `zoomerlip.themes.v1` also overwrite each other (same root cause as S4).
- **Duplicate ids:** `readThemes` doesn't remove them. Two stored entries with the same `id` render with duplicate React keys, and Edit, Save and Delete then act on both.
- **Fixed export filename:** every export is called `zoomerlip-theme.json`. Derive the filename from the theme name, sanitised to `[a-z0-9-]`.
- **Appearance button on Login:** `Login.tsx` now places it absolutely at the top right of `.login-side`. Inside the "Add organization" modal, that `.login-side` sits in a `div role="dialog"` with no focus trap (A1), so a keyboard user can tab past the form into this button and the app behind. Check that it doesn't collide with the `.close` button at narrow widths.

### Suggested order for the theme work
1. **T1:** make the tests actually run.
2. **T2:** Light-theme capture crash.
3. **T3:** minimum-contrast gate and a recovery path that doesn't depend on the theme.
4. **T4 and T6** together, since both touch the preview and contrast code.
