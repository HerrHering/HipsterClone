import type { HTMLAttributes } from "react";
import type { SongManifestEntry } from "@hipster-clone/shared";

type Props =
  | { side: "front"; draggable: boolean; sourceHandlers?: HTMLAttributes<HTMLButtonElement> }
  | { side: "back"; songId: string; song: SongManifestEntry | undefined; correctYear: number; tone: "correct" | "incorrect" };

export function MysteryCard(props: Props) {
  const revealed = props.side === "back";
  return (
    <div className={`flip-card${revealed ? " is-revealed" : ""}`} data-revealed={revealed}>
      {props.side === "front" ? (
        <div className="mystery-card mystery-card-front" aria-label="Mystery song card">
          <span className="mystery-mark" aria-hidden="true">♫</span>
          <button id="card-drag-source" type="button" className="card-drag-handle" disabled={!props.draggable} aria-label="Pick up mystery card" {...props.sourceHandlers}>
            Drag card
          </button>
        </div>
      ) : (
        <article className={`mystery-card mystery-card-back is-${props.tone}`} aria-label={`Revealed song: ${props.song?.title ?? "Unknown title"} by ${props.song?.artist ?? "Unknown artist"}, ${props.correctYear}`}>
          <span className="answer-kicker">The song was</span>
          <strong>{props.song?.title ?? "Unknown title"}</strong>
          <span>{props.song?.artist ?? "Unknown artist"}</span>
          <b>{props.correctYear}</b>
          {!props.song && <small>{props.songId}</small>}
        </article>
      )}
    </div>
  );
}
