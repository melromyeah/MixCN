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

export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  bpm: number | null
  grid: BeatGrid | null
  buffer: AudioBuffer
  peaks: Float32Array
}

export interface LoopRegion {
  start: number
  end: number
  /** Loop length in bars (fractions allowed, e.g. 0.25 = quarter bar). */
  bars: number
}

export const HOT_CUE_COUNT = 4
