import { downmixMono, makeFft } from "./dsp"
import type { KeyInfo } from "./types"

/**
 * Musical key detection.
 *
 * Builds a chromagram (energy per pitch class) from STFT frames of the
 * loudest part of the track, then correlates it against the
 * Krumhansl-Schmuckler major/minor key profiles in all 12 rotations.
 * The best of the 24 candidates wins, and is mapped onto the Camelot
 * wheel for harmonic-mixing display.
 */
export async function detectKey(buffer: AudioBuffer): Promise<KeyInfo | null> {
  try {
    await new Promise((r) => setTimeout(r, 0))
    return analyze(buffer)
  } catch {
    return null
  }
}

const WIN = 4096
const HOP = 2048
const ANALYSIS_SECONDS = 60

// Krumhansl-Schmuckler tonal hierarchies.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]

// Camelot wheel positions indexed by pitch class (0 = C).
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]

function analyze(buffer: AudioBuffer): KeyInfo | null {
  if (buffer.duration < 8) return null
  const decimate = buffer.sampleRate >= 32000
  const srA = decimate ? buffer.sampleRate / 2 : buffer.sampleRate

  const winSamples = Math.min(buffer.length, Math.floor(buffer.sampleRate * ANALYSIS_SECONDS))
  const start = Math.max(0, Math.floor((buffer.length - winSamples) / 2))
  const mono = downmixMono(buffer, start, winSamples, decimate)

  const frames = Math.floor((mono.length - WIN) / HOP)
  if (frames < 16) return null

  const fft = makeFft(WIN)
  const hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)
  const bins = WIN / 2
  const binHz = srA / WIN

  // Precompute pitch class per bin over the musically useful range.
  const pitchClassOfBin = new Int8Array(bins).fill(-1)
  for (let k = 1; k < bins; k++) {
    const freq = k * binHz
    if (freq < 55 || freq > 4000) continue
    const midi = 69 + 12 * Math.log2(freq / 440)
    pitchClassOfBin[k] = ((Math.round(midi) % 12) + 12) % 12
  }

  const chroma = new Float64Array(12)
  for (let f = 0; f < frames; f++) {
    const base = f * HOP
    for (let i = 0; i < WIN; i++) re[i] = mono[base + i] * hann[i]
    im.fill(0)
    fft(re, im)
    for (let k = 1; k < bins; k++) {
      const pc = pitchClassOfBin[k]
      if (pc < 0) continue
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      // Mild compression keeps loud bass notes from dominating the vote.
      chroma[pc] += Math.sqrt(mag)
    }
  }

  let total = 0
  for (let i = 0; i < 12; i++) total += chroma[i]
  if (total === 0) return null

  let bestScore = -Infinity
  let bestTonic = 0
  let bestIsMinor = false
  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = correlate(chroma, MAJOR_PROFILE, tonic)
    const min = correlate(chroma, MINOR_PROFILE, tonic)
    if (maj > bestScore) {
      bestScore = maj
      bestTonic = tonic
      bestIsMinor = false
    }
    if (min > bestScore) {
      bestScore = min
      bestTonic = tonic
      bestIsMinor = true
    }
  }

  return {
    name: NOTE_NAMES[bestTonic] + (bestIsMinor ? "m" : ""),
    camelot: bestIsMinor ? CAMELOT_MINOR[bestTonic] : CAMELOT_MAJOR[bestTonic],
  }
}

/** Pearson correlation between the chroma and a profile rotated to `tonic`. */
function correlate(chroma: Float64Array, profile: number[], tonic: number): number {
  let mc = 0
  let mp = 0
  for (let i = 0; i < 12; i++) {
    mc += chroma[i]
    mp += profile[i]
  }
  mc /= 12
  mp /= 12
  let num = 0
  let dc = 0
  let dp = 0
  for (let i = 0; i < 12; i++) {
    const c = chroma[(tonic + i) % 12] - mc
    const p = profile[i] - mp
    num += c * p
    dc += c * c
    dp += p * p
  }
  const denom = Math.sqrt(dc * dp)
  return denom > 0 ? num / denom : 0
}

/**
 * Camelot harmonic compatibility: same slot, relative major/minor
 * (same number), or ±1 on the wheel with the same letter.
 */
export function keysCompatible(a: KeyInfo | null, b: KeyInfo | null): boolean {
  if (!a || !b) return false
  const parse = (c: string) => ({ num: parseInt(c, 10), letter: c.slice(-1) })
  const ka = parse(a.camelot)
  const kb = parse(b.camelot)
  if (ka.num === kb.num) return true
  if (ka.letter !== kb.letter) return false
  const diff = Math.abs(ka.num - kb.num)
  return diff === 1 || diff === 11
}
