import type { SongManifestEntry } from "@hipster-clone/shared";
import { useFitText } from "./useFitText";

interface Props {
  songId: string;
  song: SongManifestEntry | undefined;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "correct" | "incorrect";
  // e.g. "claimed by Alice" — replaces SlotPicker's old inline text.
  footer?: string;
  className?: string;
}

// The "physical paper card" look: one panel, three stacked rows — artist on
// top, the year big and centered (the one thing a real Hitster card makes
// impossible to miss), title on the bottom. Falls back to the raw id if the
// manifest hasn't loaded this song (mirrors GameBoard.tsx's own
// describeSong fallback) rather than rendering nothing.
export function SongCard({ songId, song, size = "md", tone = "default", footer, className }: Props) {
  const sizeClass = size === "sm" ? "song-card-sm" : size === "lg" ? "song-card-lg" : "song-card-md";
  const toneClass =
    tone === "correct" ? "song-card-correct" : tone === "incorrect" ? "song-card-incorrect" : "";
  const classes = ["song-card", sizeClass, toneClass, className].filter(Boolean).join(" ");
  const titleRef = useFitText<HTMLSpanElement>(song?.title ?? "");

  return (
    <div className={classes}>
      <span className="song-card-artist">{song?.artist ?? songId}</span>
      <span className="song-card-year">{song?.year ?? "?"}</span>
      {song && (
        <span ref={titleRef} className="song-card-title">
          {song.title}
        </span>
      )}
      {footer && <span className="song-card-footer">{footer}</span>}
    </div>
  );
}
