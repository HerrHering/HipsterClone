export type AudioKind = "local-file" | "embedded-link";

export interface SongAudioRef {
  kind: AudioKind;
  /** "/audio/<id>.mp3" for local-file, a YouTube video id for embedded-link */
  ref: string;
  durationSec?: number;
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
