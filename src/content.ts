import DOMPurify from 'dompurify'
// Explicit allowlist: no forms, embeds, scripts, styles, SVG, or event handlers.
export function sanitizeContent(html: string, org: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','strong','b','em','i','s','del','blockquote','pre','code','a','ul','ol','li','hr','h1','h2','h3','h4','table','thead','tbody','tr','td','th','span','div','img','details','summary'],
    ALLOWED_ATTR: ['href','src','alt','title','class','colspan','rowspan'], RETURN_DOM_FRAGMENT: true,
  })
  for (const element of fragment.querySelectorAll<HTMLAnchorElement | HTMLImageElement>('a, img')) {
    const attr = element.tagName === 'A' ? 'href' : 'src'
    const raw = element.getAttribute(attr)
    if (!raw) continue
    try {
      const url = new URL(raw, org)
      if (!['http:', 'https:', ...(attr === 'href' ? ['mailto:'] : [])].includes(url.protocol)) { element.removeAttribute(attr); continue }
      element.setAttribute(attr, url.href)
      if (element instanceof HTMLAnchorElement) { element.target = '_blank'; element.rel = 'noopener noreferrer'; element.referrerPolicy = 'no-referrer' }
      else { element.loading = 'lazy'; element.referrerPolicy = 'no-referrer' }
      if (url.origin === org && url.pathname.startsWith('/user_uploads/')) {
        element.dataset.upload = url.pathname
        element.removeAttribute(attr)
      }
    } catch { element.removeAttribute(attr) }
  }
  return fragment
}
