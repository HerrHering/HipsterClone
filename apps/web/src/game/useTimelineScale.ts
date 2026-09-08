import { useEffect, useRef, useState } from "react";
import { calculateTimelineScale, type TimelineOrientation } from "./boardModel";

export function useTimelineScale(cardCount: number, orientation: TimelineOrientation) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(320);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setAvailable(orientation === "horizontal" ? entry.contentRect.width : entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [orientation]);

  const geometry = calculateTimelineScale(available, cardCount);
  return { ref, geometry, available };
}
