/** Follow keyboard/browser chrome resizing without rendering the conversation. */
export function trackViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  let frame = 0;
  const fit = () => {
    frame = 0;
    // Pinch zoom must magnify the existing layout, not reflow it.
    if (Math.abs(viewport.scale - 1) > 0.01) return;
    const height = Math.round(viewport.height);
    const top = Math.round(viewport.offsetTop);
    for (const [name, value] of Object.entries({
      "--visual-height": height,
      "--visual-top": top,
      "--visual-bottom": Math.max(0, window.innerHeight - height - top),
    })) {
      const next = `${value}px`;
      if (root.style.getPropertyValue(name) !== next)
        root.style.setProperty(name, next);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(fit);
  };
  fit();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    for (const key of ["height", "top", "bottom"])
      root.style.removeProperty(`--visual-${key}`);
  };
}
