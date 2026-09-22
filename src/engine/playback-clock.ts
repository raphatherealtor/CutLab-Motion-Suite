/**
 * CutLab Playback Clock
 * Derives frame progression from ProjectState + SessionState playhead + RationalTime.
 * requestAnimationFrame schedules paints only — does NOT own timeline time.
 * Frame index is the canonical truth, not accumulated dt.
 */

'use client';

import { useEffect, useRef } from 'react';

interface PlaybackClockOptions {
  fps: number;
  totalFrames: number;
  onFrame: (frame: number) => void;
  onStop: () => void;
}

export class PlaybackClock {
  private armed = false;
  private startWallTime = 0;
  private startFrame = 0;
  private fps: number;
  private totalFrames: number;
  private onFrame: (frame: number) => void;
  private onStop: () => void;
  private rafId: number | null = null;

  constructor(opts: PlaybackClockOptions) {
    this.fps = opts.fps;
    this.totalFrames = opts.totalFrames;
    this.onFrame = opts.onFrame;
    this.onStop = opts.onStop;
  }

  arm(startFrame: number) {
    this.armed = true;
    this.startFrame = startFrame;
    this.startWallTime = performance.now();
    this.tick();
  }

  disarm() {
    this.armed = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = () => {
    if (!this.armed) return;
    // Deterministic: frame = startFrame + floor((wallElapsed / 1000) * fps)
    const elapsed = performance.now() - this.startWallTime;
    const frame = this.startFrame + Math.floor((elapsed / 1000) * this.fps);

    if (frame >= this.totalFrames) {
      this.armed = false;
      this.onFrame(this.totalFrames);
      this.onStop();
      return;
    }

    this.onFrame(frame);
    this.rafId = requestAnimationFrame(this.tick);
  };

  updateTotalFrames(n: number) {
    this.totalFrames = n;
  }
}

/** React hook that manages the playback clock lifecycle */
export function usePlaybackClock(
  playing: boolean,
  playheadFrame: number,
  fps: number,
  totalFrames: number,
  onFrameUpdate: (frame: number) => void,
  onPlaybackEnd: () => void
) {
  const clockRef = useRef<PlaybackClock | null>(null);

  useEffect(() => {
    if (playing) {
      const clock = new PlaybackClock({
        fps,
        totalFrames,
        onFrame: onFrameUpdate,
        onStop: onPlaybackEnd,
      });
      clockRef.current = clock;
      clock.arm(playheadFrame);
    } else {
      clockRef.current?.disarm();
      clockRef.current = null;
    }
    return () => {
      clockRef.current?.disarm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    clockRef.current?.updateTotalFrames(totalFrames);
  }, [totalFrames]);
}
