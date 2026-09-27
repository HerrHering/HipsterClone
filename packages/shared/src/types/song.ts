export interface SongAudioRef {
  /** YouTube video id the browser fetches this song's audio from. */
  videoId: string;
  /**
   * The matched video's own title (distinct from the song's own `title`
   * one level up — e.g. "Queen – Bohemian Rhapsody (Official Video
   * Remastered)" vs. just "Bohemian Rhapsody") and uploader/channel name.
   * Free byproducts of resolving the link, kept because they genuinely
   * describe the audio source itself, even though nothing displays them
   * yet — re-deriving them later would mean re-running the scraper.
   */
  videoTitle: string;
  channel: string;
  durationSec: number;
  /** How confident resolveSource was in this match (0..1) — lets a future
   *  tool flag shaky picks without re-running the scraper. */
  confidence: number;
}

export interface SongManifestEntry {
  id: string;
  title: string;
  artist: string;
  year: number;
  /**
   * Whether this song's source CSV (see tools/scraper/data/) is currently
   * named `active_*.csv` rather than `inactive_*.csv`. Inactive entries stay
   * in the manifest — their resolved audio.videoId etc. is preserved — but
   * apps/api's loadManifest() filters them out, so they're never picked for
   * play. Toggle a whole collection by renaming its CSV file and rerunning
   * the scraper.
   */
  active: boolean;
  audio: SongAudioRef;
}

export interface SongManifest {
  version: string;
  generatedAt: string;
  songs: SongManifestEntry[];
}
