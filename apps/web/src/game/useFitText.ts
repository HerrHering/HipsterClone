import { useLayoutEffect, useRef, type RefObject } from "react";

const MIN_FONT_SIZE_PX = 11;
const STEP_PX = 0.5;

// Shrinks the ref'd element's own font-size in small steps until its full
// content fits without needing -webkit-line-clamp to truncate it, down to
// a minimum readable floor — only past that floor does the existing
// line-clamp + ellipsis (see .song-card-title) actually kick in. Re-runs
// whenever `text` changes; the measurement loop triggers a reflow per
// step, so it's deliberately gated behind that dependency, not run on
// every render.
export function useFitText<T extends HTMLElement>(text: string): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset before measuring — a previous run (different text) may have
    // left a smaller inline size behind, which would otherwise be read
    // back as this run's own "starting" size.
    el.style.fontSize = "";
    let fontSize = parseFloat(getComputedStyle(el).fontSize);
    // scrollHeight vs. clientHeight is the standard way to detect
    // line-clamp truncation: clientHeight is pinned to the clamped (2-line)
    // height, while scrollHeight still reflects the full content's real
    // height at the current font-size, even though it's visually clamped.
    while (el.scrollHeight > el.clientHeight && fontSize > MIN_FONT_SIZE_PX) {
      fontSize -= STEP_PX;
      el.style.fontSize = `${fontSize}px`;
    }
  }, [text]);
  return ref;
}
