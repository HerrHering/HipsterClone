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
  audio: SongAudioRef;
}

export interface SongManifest {
  version: string;
  generatedAt: string;
  songs: SongManifestEntry[];
}
