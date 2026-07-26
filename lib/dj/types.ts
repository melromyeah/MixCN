export type DeckId = "A" | "B"

/**
 * Beat grid produced by the analyzer. Assumes constant tempo: every beat
 * lies at firstBeat + k * (60 / bpm), every bar at firstBar + k * barLen.
 * Anchors are reduced into [0, beatLen) / [0, barLen) and extrapolate
 * across the whole track.
 */
export interface BeatGrid {
  bpm: number
  firstBeat: number
  firstBar: number
  beatsPerBar: number
}

/** Detected musical key with its Camelot-wheel position. */
export interface KeyInfo {
  /** e.g. "Am", "F♯" */
  name: string
  /** e.g. "8A" (minor) / "8B" (major) */
  camelot: string
}

export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  bpm: number | null
  grid: BeatGrid | null
  key: KeyInfo | null
  /** Auto-gain multiplier that normalizes perceived loudness (1 = none). */
  gain: number
  buffer: AudioBuffer
  peaks: Float32Array
}

/** What the library persists in IndexedDB (no decoded audio). */
export interface StoredTrack {
  id: string
  title: string
  artist: string
  duration: number
  bpm: number | null
  grid: BeatGrid | null
  key: KeyInfo | null
  gain: number
  peaks: ArrayBuffer
  /** Original (encoded) file bytes; decoded on demand. */
  bytes: ArrayBuffer
  addedAt: number
}

export interface LoopRegion {
  start: number
  end: number
  /** Loop length in bars (fractions allowed, e.g. 0.25 = quarter bar). */
  bars: number
}

export const HOT_CUE_COUNT = 4
