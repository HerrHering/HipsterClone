import type { CSSProperties, HTMLAttributes } from "react";

interface Props {
  count: number;
  draggable: boolean;
  sourceHandlers?: HTMLAttributes<HTMLButtonElement>;
}

export function TokenPile({ count, draggable, sourceHandlers }: Props) {
  const visible = Math.min(count, 6);
  return (
    <div className={`token-pile${count === 0 ? " is-empty" : ""}`} aria-label={`${count} token${count === 1 ? "" : "s"}`}>
      {count === 0 && <span className="empty-token">0</span>}
      {Array.from({ length: visible }, (_, index) => {
        const top = index === visible - 1;
        const style = { left: `${index * 5}px`, top: `${(5 - index) * 2}px`, transform: `rotate(${(index - 2) * 7}deg)` } as CSSProperties;
        return top && draggable ? (
          <button key={index} id="token-drag-source" type="button" className="token token-source" style={style} aria-label={`Pick up one of your ${count} tokens`} {...sourceHandlers}>♪</button>
        ) : <span key={index} className="token" style={style} aria-hidden="true">♪</span>;
      })}
      {count > 6 && <span className="token-overflow" aria-hidden="true">+{count - 6}</span>}
      <span className="token-count">{count} token{count === 1 ? "" : "s"}</span>
    </div>
  );
}
