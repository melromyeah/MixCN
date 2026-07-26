import { DeckEngine } from "./deck-engine"
import type { DeckId } from "./types"
import { getVinylWorkletUrl } from "./vinyl-worklet"

/**
 * Top-level audio graph: two decks -> master gain -> limiter -> speakers,
 * with parallel taps (all post-limiter, so meters show what you hear)
 * for recording, the stereo VU pair, and the console glow.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  /** Brickwall-ish safety limiter so hot mixes don't clip the output. */
  readonly limiter: DynamicsCompressorNode
  readonly masterAnalyser: AnalyserNode
  readonly masterAnalyserL: AnalyserNode
  readonly masterAnalyserR: AnalyserNode
  /** Inaudible low-passed mono tap of the master, for the console glow. */
  readonly glowAnalyser: AnalyserNode
  readonly decks: Record<DeckId, DeckEngine>

  private readonly recordDest: MediaStreamAudioDestinationNode
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  recordingStartedAt: number | null = null

  /** Current crossfader position (engine-owned so automation moves the UI). */
  crossfade = 0
  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" })
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9

    // Safety limiter: hard-knee, high-ratio compression that only bites
    // when both decks stack up near full scale.
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1.5
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.25
    this.master.connect(this.limiter)

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 1024
    this.recordDest = this.ctx.createMediaStreamDestination()

    this.limiter.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.ctx.destination)
    this.limiter.connect(this.recordDest)

    // Per-channel taps for the stereo master VU pair.
    this.masterAnalyserL = this.ctx.createAnalyser()
    this.masterAnalyserL.fftSize = 1024
    this.masterAnalyserR = this.ctx.createAnalyser()
    this.masterAnalyserR.fftSize = 1024
    const splitter = this.ctx.createChannelSplitter(2)
    this.limiter.connect(splitter)
    splitter.connect(this.masterAnalyserL, 0)
    splitter.connect(this.masterAnalyserR, 1)

    // Silent side-chain: low-pass the master so only the bass remains
    // (the analyser downmixes to mono), and dead-end it — this branch
    // never reaches the speakers. It only feeds the UI glow.
    const glowFilter = this.ctx.createBiquadFilter()
    glowFilter.type = "lowpass"
    glowFilter.frequency.value = 70
    glowFilter.Q.value = 0.7
    this.glowAnalyser = this.ctx.createAnalyser()
    this.glowAnalyser.fftSize = 512
    this.limiter.connect(glowFilter)
    glowFilter.connect(this.glowAnalyser)

    const workletReady = this.ctx.audioWorklet.addModule(getVinylWorkletUrl())
    this.decks = {
      A: new DeckEngine(this.ctx, this.master, workletReady),
      B: new DeckEngine(this.ctx, this.master, workletReady),
    }
    this.setCrossfade(0)
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume()
  }

  /**
   * value in -1 (full A) .. 1 (full B). Plateau curve: each deck plays at
   * full volume across its own half; only past the middle does it fade,
   * reaching silence at the opposite end. The fade half follows a cosine
   * for a smooth roll-off.
   */
  setCrossfade(value: number) {
    this.crossfade = Math.min(1, Math.max(-1, value))
    const fadeA = Math.max(0, this.crossfade) // A fades only on B's half
    const fadeB = Math.max(0, -this.crossfade) // B fades only on A's half
    this.decks.A.setCrossfadeGain(Math.cos((fadeA * Math.PI) / 2))
    this.decks.B.setCrossfadeGain(Math.cos((fadeB * Math.PI) / 2))
    this.emit()
  }

  setMasterVolume(volume: number) {
    this.master.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.01)
  }

  get recording() {
    return this.recorder?.state === "recording"
  }

  startRecording() {
    if (this.recording) return
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m)
    )
    this.chunks = []
    this.recorder = new MediaRecorder(this.recordDest.stream, mime ? { mimeType: mime } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start(1000)
    this.recordingStartedAt = performance.now()
  }

  stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder
      if (!rec || rec.state !== "recording") {
        resolve(null)
        return
      }
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" })
        this.chunks = []
        this.recordingStartedAt = null
        resolve(blob)
      }
      rec.stop()
      this.recorder = null
    })
  }
}

let engine: AudioEngine | null = null

/** Lazy singleton — only ever constructed in the browser. */
export function getEngine(): AudioEngine {
  if (typeof window === "undefined") {
    throw new Error("AudioEngine is client-only")
  }
  if (!engine) engine = new AudioEngine()
  return engine
}
