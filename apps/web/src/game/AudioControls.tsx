import { useEffect, useRef, useState } from "react";
import type { GameAction, PlaybackState } from "@hipster-clone/shared";
import { currentPlaybackPositionSec } from "@hipster-clone/shared";
import { POLL_INTERVAL_MS } from "./useGameState";

interface Props {
  playback: PlaybackState;
  canControl: boolean;
  muted: boolean;
  onAction: (action: GameAction) => Promise<boolean>;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function AudioControls({ playback, canControl, muted, onAction }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeTimer = useRef<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(playback.positionSec);
  const [status, setStatus] = useState<"loading" | "buffering" | "playing" | "paused" | "ended" | "autoplay-blocked">("loading");
  const [syncing, setSyncing] = useState(false);
  const [locked, setLocked] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    return () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || scrubbing) return;
    const rawTarget = currentPlaybackPositionSec(playback);
    const target = Number.isFinite(audio.duration) ? Math.min(rawTarget, audio.duration) : rawTarget;
    if (Math.abs(audio.currentTime - target) > 1) audio.currentTime = target;
    setPosition(audio.currentTime || target);
    if (playback.isPlaying && audio.paused && !audio.ended) {
      void audio.play().catch(() => setStatus("autoplay-blocked"));
    } else if (!playback.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [playback, scrubbing]);

  async function send(action: GameAction): Promise<boolean> {
    setSyncing(true);
    try { return await onAction(action); } finally { setSyncing(false); }
  }

  async function togglePlayback() {
    if (!canControl || locked) return;
    await send({ type: playback.isPlaying ? "PAUSE" : "PLAY" });
  }

  async function commitSeek() {
    if (!canControl || locked || !scrubbing) return;
    setScrubbing(false);
    audioRef.current?.pause();
    setLocked(true);
    const shouldResume = playback.isPlaying;
    const succeeded = await send({ type: "SEEK", positionSec: position });
    if (!succeeded) {
      setLocked(false);
      return;
    }
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      setLocked(false);
      if (shouldResume) void send({ type: "PLAY" });
    }, POLL_INTERVAL_MS);
  }

  const stateLabel = locked ? "Paused — waiting for everyone to catch up…" : syncing ? "Syncing with server…" : status === "loading" ? "Loading song…" : status === "buffering" ? "Buffering…" : status === "ended" ? "Song ended" : status === "autoplay-blocked" ? "Playback is ready — interact with this page to hear it." : playback.isPlaying ? "Playing" : "Paused";

  return (
    <div className="audio-controls">
      <audio
        ref={audioRef}
        src={`/api/audio/${playback.songId}`}
        muted={muted}
        preload="auto"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
          audio.currentTime = currentPlaybackPositionSec(playback);
          setPosition(audio.currentTime);
          if (playback.isPlaying) void audio.play().catch(() => setStatus("autoplay-blocked"));
        }}
        onLoadStart={() => setStatus("loading")}
        onWaiting={() => setStatus("buffering")}
        onPlaying={() => setStatus("playing")}
        onPause={() => setStatus("paused")}
        onEnded={() => {
          setStatus("ended");
          if (canControl) void send({ type: "PAUSE" });
        }}
        onCanPlay={() => setStatus((current) => current === "loading" ? "paused" : current)}
        onTimeUpdate={(event) => { if (!scrubbing) setPosition(event.currentTarget.currentTime); }}
      />
      <button type="button" className="audio-play" onClick={togglePlayback} disabled={!canControl || locked || syncing} aria-label={playback.isPlaying ? "Pause mystery song" : "Play mystery song"}>
        {playback.isPlaying ? "Ⅱ" : "▶"}
      </button>
      <label className="audio-range">
        <span className="visually-hidden">Song progress</span>
        <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position, duration || 1)} disabled={!canControl || locked} onChange={(event) => { setScrubbing(true); setPosition(Number(event.target.value)); }} onPointerUp={() => void commitSeek()} onKeyUp={() => void commitSeek()} />
        <span><time>{formatTime(position)}</time><time>{formatTime(duration)}</time></span>
      </label>
      <span className="audio-status">{stateLabel}{muted ? " · Muted on this device" : ""}</span>
    </div>
  );
}
