# Feature parity follow-up

## Android smoothness — implemented and tested

The initial drawer appeared without motion, and the shell used only `100dvh`, which does not follow visual-only keyboard resizing. The shell now follows visual viewport height/offset in one animation frame, without React state updates. Pinch zoom retains the existing layout. Native WebView inset resizing remains authoritative; browser sizing uses the already-resized viewport and does not subtract keyboard height again.

Drawer entrances use a 140 ms transform/opacity animation. Menus/backdrops fade over 100 ms. Dismissal and actions remain immediate. Both the system reduced-motion setting and the app motion preference suppress animations. Touch targets have immediate pressed feedback. Menu geometry updates are coalesced per frame; nested menus/navigation contain overscroll.

Verification: 183 unit tests passed; TypeScript/Vite production build passed. Intercepted UI fixtures passed, including visual-only keyboard resize, bottom pinning, unchanged reading anchor, no message rerender during resize, pinch zoom, landscape rotation, drawer/menu dismissal, both motion overrides, and the existing 320 px touch checks. Android release unit tests, lint and unsigned assembly passed offline. Native checks cover repeated IME insets, keyboard dismissal, retained WebView on rotation, and Back routing. No physical-device verification or frame-rate claim. Android version is unchanged.

Sources: [Chrome keyboard viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior/), [Android keyboard and insets](https://developer.android.com/develop/ui/views/layout/sw-keyboard).

## Audit

Implementation and prior progress reports are being checked against current official API documentation. Supported means a reachable implementation, not a claim of complete upstream parity. Remaining work and exact API/infrastructure blockers will be recorded here.
