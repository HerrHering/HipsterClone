import { useEffect, useRef, useState, type Dispatch, type PointerEventHandler } from "react";
import type { PlacementSelection, SelectionEvent } from "./boardModel";

interface Options {
  enabled: boolean;
  source: "card" | "token";
  legalPositions: number[];
  selection: PlacementSelection;
  dispatch: Dispatch<SelectionEvent>;
  announce: (message: string) => void;
}

export function usePointerPlacement({ enabled, source, legalPositions, selection, dispatch, announce }: Options) {
  const pointer = useRef<{ id: number; x: number; y: number; dragging: boolean; over: number | null } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const legal = useRef(new Set(legalPositions));

  useEffect(() => {
    legal.current = new Set(legalPositions);
  }, [legalPositions]);

  const cancel = () => {
    pointer.current = null;
    setPreview(null);
    if (selection.kind !== "idle") dispatch({ type: "CANCEL" });
  };

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, over: null };
  };
  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    if (!active.dragging && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 6) {
      active.dragging = true;
      suppressClick.current = true;
      dispatch({ type: "PICK_UP", source });
      announce(source === "card" ? "Mystery card picked up." : "Token picked up.");
    }
    if (!active.dragging) return;
    setPreview({ x: event.clientX, y: event.clientY });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-gap-position]");
    const parsed = target ? Number(target.dataset.gapPosition) : NaN;
    const over = Number.isInteger(parsed) && legal.current.has(parsed) ? parsed : null;
    if (active.over !== over) {
      active.over = over;
      dispatch({ type: "MOVE_OVER", position: over });
    }
  };
  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    pointer.current = null;
    setPreview(null);
    if (active.dragging && active.over !== null && legal.current.has(active.over)) {
      dispatch({ type: "DROP", position: active.over });
      announce(`Selected gap ${active.over + 1}. Confirm when ready.`);
    } else if (active.dragging) {
      dispatch({ type: "CANCEL" });
      announce("Drag cancelled.");
    }
  };
  const onPointerCancel: PointerEventHandler<HTMLElement> = () => cancel();
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!enabled) return;
    if (selection.kind === "picked" && selection.source === source) {
      dispatch({ type: "CANCEL" });
      announce("Selection cancelled.");
    } else {
      dispatch({ type: "PICK_UP", source });
      announce(source === "card" ? "Mystery card picked up. Choose a timeline gap." : "Token picked up. Choose a timeline gap.");
    }
  };

  const onLostPointerCapture: PointerEventHandler<HTMLElement> = () => {
    if (pointer.current) cancel();
  };
  return { sourceHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onClick }, preview };
}
