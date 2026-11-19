import DOMPurify from "dompurify";
// Explicit allowlist: no forms, embeds, scripts, styles, SVG, or event handlers.
export function sanitizeContent(html: string, org: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "del",
      "blockquote",
      "pre",
      "code",
      "a",
      "ul",
      "ol",
      "li",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "span",
      "div",
      "img",
      "details",
      "summary",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "colspan",
      "rowspan",
    ],
    RETURN_DOM_FRAGMENT: true,
    ALLOW_DATA_ATTR: false,
  });
  // Zulip normally paints these spans with its emoji sprite sheet.
  for (const span of fragment.querySelectorAll("span.emoji")) {
    const code = [...span.classList].find((name) =>
      /^emoji-[0-9a-f]+(?:-[0-9a-f]+)*$/.test(name),
    );
    if (code) {
      try {
        span.textContent = String.fromCodePoint(
          ...code
            .slice(6)
            .split("-")
            .map((part) => parseInt(part, 16)),
        );
      } catch {
        /* Keep the accessible text fallback for unknown emoji. */
      }
    }
  }
  // Remote markup must never inherit application controls or overlay styles.
  for (const element of fragment.querySelectorAll("[class]")) {
    const safe = [...element.classList].filter((name) =>
      /^(emoji(?:-[0-9a-f-]+)?|user-mention|user-group-mention|message_inline_image|message_inline_ref|codehilite|spoiler-(?:header|content))$/.test(
        name,
      ),
    );
    if (safe.length) element.setAttribute("class", safe.join(" "));
    else element.removeAttribute("class");
  }
  for (const element of fragment.querySelectorAll<
    HTMLAnchorElement | HTMLImageElement
  >("a, img")) {
    const attr = element.tagName === "A" ? "href" : "src";
    const raw = element.getAttribute(attr);
    if (!raw) continue;
    try {
      const url = new URL(raw, org);
      if (
        !["http:", "https:", ...(attr === "href" ? ["mailto:"] : [])].includes(
          url.protocol,
        )
      ) {
        element.removeAttribute(attr);
        continue;
      }
      if (
        attr === "src" &&
        url.protocol === "http:" &&
        !(
          url.origin === org &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      ) {
        element.removeAttribute(attr);
        continue;
      }
      element.setAttribute(attr, url.href);
      if (element instanceof HTMLAnchorElement) {
        element.target = "_blank";
        element.rel = "noopener noreferrer";
        element.referrerPolicy = "no-referrer";
      } else {
        element.loading = "lazy";
        element.referrerPolicy = "no-referrer";
      }
      if (url.origin === org && url.pathname.startsWith("/user_uploads/")) {
        // Thumbnail routes aren't accepted by the temporary-URL API. Resolve
        // the original attachment instead, then let the browser resize it.
        element.dataset.upload = url.pathname.startsWith(
          "/user_uploads/thumbnail/",
        )
          ? element.closest("a")?.dataset.upload ||
            url.pathname.replace(
              /^\/user_uploads\/thumbnail\/(.+)\/[^/]+$/,
              "/user_uploads/$1",
            )
          : url.pathname;
        element.removeAttribute(attr);
        if (element instanceof HTMLAnchorElement) element.href = "#attachment";
      }
    } catch {
      element.removeAttribute(attr);
    }
  }
  return fragment;
}
