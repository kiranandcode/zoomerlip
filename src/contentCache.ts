import { sanitizeContent } from "./content";

const MAX_ENTRIES = 160;
const MAX_CHARACTERS = 1024 * 1024;
const templates = new Map<
  string,
  { org: string; html: string; fragment: DocumentFragment }
>();
let characters = 0;
function remove(key: string) {
  const entry = templates.get(key);
  if (entry) characters -= entry.html.length;
  templates.delete(key);
}
export function clearContentCache(org: string) {
  for (const [key, entry] of templates) if (entry.org === org) remove(key);
}
/** Cache pristine templates only. Mounted nodes and temporary URLs never enter it. */
export function messageFragment(html: string, org: string): DocumentFragment {
  if (html.length > 32 * 1024) return sanitizeContent(html, org);
  const key = JSON.stringify([org, html]);
  const hit = templates.get(key);
  if (hit) {
    templates.delete(key);
    templates.set(key, hit);
    return hit.fragment.cloneNode(true) as DocumentFragment;
  }
  const fragment = sanitizeContent(html, org);
  if (html.length <= 32 * 1024) {
    templates.set(key, {
      org,
      html,
      fragment: fragment.cloneNode(true) as DocumentFragment,
    });
    characters += html.length;
    while (templates.size > MAX_ENTRIES || characters > MAX_CHARACTERS)
      remove(templates.keys().next().value!);
  }
  return fragment;
}
