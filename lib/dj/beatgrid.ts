import type { BeatGrid } from "./types"

/**
 * Beat grid analyzer.
 *
 * Pipeline (all in plain JS over the decoded PCM, no audio graph needed):
 *  1. Pick the loudest ~90s window of the track and downmix it to mono.
 *  2. Split into low/mid/high bands with one-pole filters and build
 *     per-band onset envelopes (rectified differences of compressed RMS,
 *     ~86 frames/s), weighting the low band — kicks carry the groove.
 *  3. Estimate the tempo with an autocorrelation of the onset envelope,
 *     scored together with its 2x/3x harmonics, refined by parabolic
 *     interpolation.
 *  4. Fine-tune BPM and beat phase jointly with a comb-filter grid search
 *     (±2% around the ACF estimate, ~0.01 BPM resolution at the end).
 *  5. Pick the downbeat among the four beat candidates by scoring the
 *     low-band onsets on each — bars start where the bass lands.
 */
export async function analyzeBeatGrid(buffer: AudioBuffer): Promise<BeatGrid | null> {
  try {
    // Let the UI breathe before a long synchronous crunch.
    await new Promise((r) => setTimeout(r, 0))
    return analyze(buffer)
  } catch {
    return null
  }
}

const HOP = 512
const MIN_BPM = 60
const MAX_BPM = 180
const BEATS_PER_BAR = 4

function analyze(buffer: AudioBuffer): BeatGrid | null {
  const sr = buffer.sampleRate
  if (buffer.duration < 8) return null

  // ---- 1. loudest window, downmixed to mono ----
  const windowLength = Math.min(buffer.length, Math.floor(sr * 90))
  const start = loudestWindowStart(buffer, windowLength)
  const mono = new Float32Array(windowLength)
  {
    const tmp = new Float32Array(windowLength)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      buffer.copyFromChannel(tmp, ch, start)
      for (let i = 0; i < windowLength; i++) mono[i] += tmp[i] / buffer.numberOfChannels
    }
  }

  // ---- 2. band onset envelopes ----
  const frames = Math.floor(windowLength / HOP)
  if (frames < 256) return null
  const envRate = sr / HOP
  const onset = new Float32Array(frames) // combined
  const lowOnset = new Float32Array(frames) // for downbeat scoring
  {
    const aLow = onePole(150, sr)
    const aMid = onePole(2000, sr)
    let yLow = 0
    let yMid = 0
    let prevL = 0
    let prevM = 0
    let prevH = 0
    for (let f = 0; f < frames; f++) {
      let sumL = 0
      let sumM = 0
      let sumH = 0
      const base = f * HOP
      for (let i = 0; i < HOP; i++) {
        const x = mono[base + i]
        yLow += (1 - aLow) * (x - yLow)
        yMid += (1 - aMid) * (x - yMid)
        const lo = yLow
        const mi = yMid - yLow
        const hi = x - yMid
        sumL += lo * lo
        sumM += mi * mi
        sumH += hi * hi
      }
      // Compressed RMS so quiet passages still contribute onsets.
      const vL = Math.log1p(25 * Math.sqrt(sumL / HOP))
      const vM = Math.log1p(25 * Math.sqrt(sumM / HOP))
      const vH = Math.log1p(25 * Math.sqrt(sumH / HOP))
      const oL = Math.max(0, vL - prevL)
      const oM = Math.max(0, vM - prevM)
      const oH = Math.max(0, vH - prevH)
      prevL = vL
      prevM = vM
      prevH = vH
      onset[f] = 2 * oL + oM + 0.6 * oH
      lowOnset[f] = oL
    }
  }

  // ---- 3. tempo via harmonic-scored autocorrelation ----
  const minLag = Math.floor((envRate * 60) / MAX_BPM)
  const maxLag = Math.ceil((envRate * 60) / MIN_BPM)
  const acf = new Float32Array(maxLag * 3 + 2)
  for (let lag = minLag; lag < acf.length; lag++) {
    let s = 0
    const n = frames - lag
    if (n < 64) break
    for (let i = 0; i < n; i++) s += onset[i] * onset[i + lag]
    acf[lag] = s / n
  }
  const acfAt = (lag: number) => {
    const i = Math.round(lag)
    return i >= 0 && i < acf.length ? acf[i] : 0
  }
  // Harmonic score with a gentle log-Gaussian tempo prior. A purely
  // periodic kick scores identically at the beat lag and its multiples,
  // so without the prior, downbeat emphasis tips the scale toward
  // half-tempo (octave errors). The prior breaks those ties toward the
  // typical DJ range without overriding a clear slow/fast groove.
  const scoreAt = (lag: number) => {
    const bpm = (60 * envRate) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 128) / 0.55, 2))
    return (acfAt(lag) + acfAt(lag * 2) / 2 + acfAt(lag * 3) / 3) * (0.6 + 0.4 * prior)
  }
  let bestLag = 0
  let bestScore = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = scoreAt(lag)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag === 0 || bestScore <= 0) return null
  // Parabolic interpolation around the integer peak.
  const s0 = scoreAt(bestLag - 1)
  const s1 = bestScore
  const s2 = scoreAt(bestLag + 1)
  const denom = s0 - 2 * s1 + s2
  const lagRefined = denom !== 0 ? bestLag + (0.5 * (s0 - s2)) / denom : bestLag
  const bpm0 = (60 * envRate) / lagRefined

  // ---- 4. joint fine search of BPM and beat phase ----
  const comb = (beatFrames: number, phase: number): number => {
    let s = 0
    let k = 0
    for (let p = phase; p < frames; p += beatFrames, k++) {
      s += onset[Math.round(p)]
    }
    return k > 0 ? s / k : 0
  }
  let bestBpm = bpm0
  let bestPhase = 0
  let best = -1
  for (let c = -80; c <= 80; c++) {
    const bpm = bpm0 * (1 + c * 0.00025) // ±2% in 0.025% steps
    const bf = (envRate * 60) / bpm
    for (let p = 0; p < bf; p += bf / 24) {
      const s = comb(bf, p)
      if (s > best) {
        best = s
        bestBpm = bpm
        bestPhase = p
      }
    }
  }
  // Final phase polish at fine resolution.
  {
    const bf = (envRate * 60) / bestBpm
    let bestP = bestPhase
    let bestS = -1
    for (let p = bestPhase - bf / 24; p <= bestPhase + bf / 24; p += bf / 256) {
      const s = comb(bf, Math.max(0, p))
      if (s > bestS) {
        bestS = s
        bestP = Math.max(0, p)
      }
    }
    bestPhase = bestP
  }

  // ---- 5. downbeat among the four beat candidates ----
  const beatFrames = (envRate * 60) / bestBpm
  let bestBarOffset = 0
  let bestBarScore = -1
  for (let c = 0; c < BEATS_PER_BAR; c++) {
    let s = 0
    let k = 0
    for (let p = bestPhase + c * beatFrames; p < frames; p += beatFrames * BEATS_PER_BAR, k++) {
      s += lowOnset[Math.round(p)] + 0.25 * onset[Math.round(p)]
    }
    const score = k > 0 ? s / k : 0
    if (score > bestBarScore) {
      bestBarScore = score
      bestBarOffset = c
    }
  }

  // ---- anchors in track seconds, reduced into one period ----
  const beatLen = 60 / bestBpm
  const barLen = beatLen * BEATS_PER_BAR
  const windowStartSec = start / sr
  const firstBeatRaw = windowStartSec + (bestPhase * HOP) / sr
  const firstBarRaw = windowStartSec + ((bestPhase + bestBarOffset * beatFrames) * HOP) / sr

  return {
    bpm: Math.round(bestBpm * 100) / 100,
    firstBeat: positiveMod(firstBeatRaw, beatLen),
    firstBar: positiveMod(firstBarRaw, barLen),
    beatsPerBar: BEATS_PER_BAR,
  }
}

/** Start index (in samples) of the loudest stretch of `length` samples. */
function loudestWindowStart(buffer: AudioBuffer, length: number): number {
  if (length >= buffer.length) return 0
  const data = buffer.getChannelData(0)
  const block = Math.floor(buffer.sampleRate) // 1s blocks
  const blocks = Math.floor(buffer.length / block)
  const energy = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let s = 0
    const base = b * block
    for (let i = 0; i < block; i += 16) s += data[base + i] * data[base + i]
    energy[b] = s
  }
  const windowBlocks = Math.max(1, Math.floor(length / block))
  let sum = 0
  for (let b = 0; b < Math.min(windowBlocks, blocks); b++) sum += energy[b]
  let bestSum = sum
  let bestStart = 0
  for (let b = windowBlocks; b < blocks; b++) {
    sum += energy[b] - energy[b - windowBlocks]
    if (sum > bestSum) {
      bestSum = sum
      bestStart = b - windowBlocks + 1
    }
  }
  return bestStart * block
}

function onePole(freq: number, sr: number): number {
  return Math.exp((-2 * Math.PI * freq) / sr)
}

function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m
}
