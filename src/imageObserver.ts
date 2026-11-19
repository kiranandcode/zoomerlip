type Pool = {
  observer: IntersectionObserver;
  callbacks: Map<Element, () => void>;
};
const pools = new Map<Element | null, Pool>();
/** One observer per scrolling pane, disposed when its last image leaves. */
export function observeImage(
  image: HTMLImageElement,
  root: Element | null,
  load: () => void,
) {
  if (typeof IntersectionObserver === "undefined") {
    load();
    return () => {};
  }
  let pool = pools.get(root);
  if (!pool) {
    const callbacks = new Map<Element, () => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = callbacks.get(entry.target);
          callbacks.delete(entry.target);
          observer.unobserve(entry.target);
          callback?.();
        }
        if (!callbacks.size) {
          observer.disconnect();
          pools.delete(root);
        }
      },
      { root, rootMargin: "200px" },
    );
    pool = { callbacks, observer };
    pools.set(root, pool);
  }
  const current = pool;
  current.callbacks.set(image, load);
  current.observer.observe(image);
  return () => {
    current.callbacks.delete(image);
    current.observer.unobserve(image);
    if (!current.callbacks.size) {
      current.observer.disconnect();
      if (pools.get(root) === current) pools.delete(root);
    }
  };
}
