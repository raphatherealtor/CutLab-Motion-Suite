/**
 * CutLab RationalTime — authoritative deterministic time system.
 * All timeline positions, durations, keyframe times use this.
 * NO float-seconds accumulation as canonical truth.
 */

export interface RationalTime {
  readonly value: number;   // integer
  readonly timescale: number; // integer (e.g. 30000 for 29.97, 24 for 24fps)
}

export const ZERO: RationalTime = { value: 0, timescale: 1 };

export function rt(value: number, timescale: number): RationalTime {
  return { value: Math.round(value), timescale };
}

export function fromSeconds(seconds: number, timescale: number): RationalTime {
  return { value: Math.round(seconds * timescale), timescale };
}

export function toSeconds(t: RationalTime): number {
  return t.value / t.timescale;
}

export function add(a: RationalTime, b: RationalTime): RationalTime {
  if (a.timescale === b.timescale) {
    return { value: a.value + b.value, timescale: a.timescale };
  }
  const ts = lcm(a.timescale, b.timescale);
  return { value: (a.value * (ts / a.timescale)) + (b.value * (ts / b.timescale)), timescale: ts };
}

export function sub(a: RationalTime, b: RationalTime): RationalTime {
  if (a.timescale === b.timescale) {
    return { value: a.value - b.value, timescale: a.timescale };
  }
  const ts = lcm(a.timescale, b.timescale);
  return { value: (a.value * (ts / a.timescale)) - (b.value * (ts / b.timescale)), timescale: ts };
}

export function mul(t: RationalTime, factor: number): RationalTime {
  return { value: Math.round(t.value * factor), timescale: t.timescale };
}

export function mulInt(t: RationalTime, n: number): RationalTime {
  return { value: t.value * n, timescale: t.timescale };
}

export function divRoundInt(t: RationalTime, n: number): RationalTime {
  return { value: Math.round(t.value / n), timescale: t.timescale };
}

export function compare(a: RationalTime, b: RationalTime): number {
  // a < b → negative, a === b → 0, a > b → positive
  return a.value * b.timescale - b.value * a.timescale;
}

export function eq(a: RationalTime, b: RationalTime): boolean {
  return compare(a, b) === 0;
}

export function lt(a: RationalTime, b: RationalTime): boolean {
  return compare(a, b) < 0;
}

export function lte(a: RationalTime, b: RationalTime): boolean {
  return compare(a, b) <= 0;
}

export function gt(a: RationalTime, b: RationalTime): boolean {
  return compare(a, b) > 0;
}

export function gte(a: RationalTime, b: RationalTime): boolean {
  return compare(a, b) >= 0;
}

/** Snap t to the nearest frame boundary at given fps timescale */
export function snapToFrame(t: RationalTime, fpsTimescale: number): RationalTime {
  const secs = toSeconds(t);
  const frame = Math.round(secs * fpsTimescale);
  return { value: frame, timescale: fpsTimescale };
}

/** Convert to a common timescale */
export function rescale(t: RationalTime, newTimescale: number): RationalTime {
  return { value: Math.round(t.value * newTimescale / t.timescale), timescale: newTimescale };
}

/** Frame index at given fps */
export function toFrameIndex(t: RationalTime, fps: number): number {
  return Math.round(toSeconds(t) * fps);
}

export function fromFrameIndex(frame: number, fps: number): RationalTime {
  // Use integer timescale matching fps (e.g. 30000/1001 for NTSC → use 30000)
  const timescale = Math.round(fps * 1000);
  return { value: frame * 1000, timescale };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Format as HH:MM:SS:FF timecode string */
export function toTimecode(t: RationalTime, fps: number): string {
  const totalSecs = toSeconds(t);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const f = Math.floor((totalSecs - Math.floor(totalSecs)) * fps);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`;
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

// end of time.ts