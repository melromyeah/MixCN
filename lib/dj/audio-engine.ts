import { DeckEngine } from "./deck-engine"
import type { DeckId } from "./types"
import { getVinylWorkletUrl } from "./vinyl-worklet"

/**
 * Top-level audio graph: two decks -> master gain -> analyser -> speakers,
 * with a parallel MediaStream tap for recording the mix.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
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

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" })
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 1024
    this.recordDest = this.ctx.createMediaStreamDestination()

    this.master.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.ctx.destination)
    this.master.connect(this.recordDest)

    // Per-channel taps for the stereo master VU pair.
    this.masterAnalyserL = this.ctx.createAnalyser()
    this.masterAnalyserL.fftSize = 1024
    this.masterAnalyserR = this.ctx.createAnalyser()
    this.masterAnalyserR.fftSize = 1024
    const splitter = this.ctx.createChannelSplitter(2)
    this.master.connect(splitter)
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
    this.master.connect(glowFilter)
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

  /** value in -1 (full A) .. 1 (full B), equal-power curve. */
  setCrossfade(value: number) {
    const t = (value + 1) / 2
    this.decks.A.setCrossfadeGain(Math.cos((t * Math.PI) / 2))
    this.decks.B.setCrossfadeGain(Math.sin((t * Math.PI) / 2))
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
