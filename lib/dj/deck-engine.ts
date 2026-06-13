import { HOT_CUE_COUNT, type LoopRegion, type Track } from "./types"

interface WorkletMessage {
  t: string
  s?: number
  f?: number
}

/**
 * One playback deck: vinyl worklet -> trim -> 3-band EQ -> filter ->
 * channel fader -> crossfader gain -> master.
 *
 * Playback runs inside an AudioWorklet ("vinyl-player") that follows a
 * signed rate, so the jog wheel can scratch backward, hold the record
 * still, and release it like a real platter. The worklet is the source
 * of truth for the playhead and reports it back continuously.
 */
export class DeckEngine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode

  private readonly trim: GainNode
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly filter: BiquadFilterNode
  private readonly fader: GainNode
  private readonly xfade: GainNode

  private node: AudioWorkletNode | null = null
  private pendingMessages: { msg: unknown; transfer?: Transferable[] }[] = []

  track: Track | null = null
  hotCues: (number | null)[] = Array(HOT_CUE_COUNT).fill(null)
  cuePoint = 0
  loop: LoopRegion | null = null

  private _playing = false
  private _scratching = false
  private _rate = 1
  private posSeconds = 0
  private posFrame = 0

  /** Bumped on every state change; lets React subscribe cheaply. */
  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  constructor(ctx: AudioContext, destination: AudioNode, workletReady: Promise<unknown>) {
    this.ctx = ctx
    this.trim = ctx.createGain()

    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = "lowshelf"
    this.eqLow.frequency.value = 320

    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = "peaking"
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.9

    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = "highshelf"
    this.eqHigh.frequency.value = 3200

    this.filter = ctx.createBiquadFilter()
    this.setFilter(0)

    this.fader = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.xfade = ctx.createGain()

    this.trim.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.filter)
    this.filter.connect(this.fader)
    this.fader.connect(this.analyser)
    this.analyser.connect(this.xfade)
    this.xfade.connect(destination)

    workletReady
      .then(() => {
        const node = new AudioWorkletNode(ctx, "vinyl-player", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        node.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onWorkletMessage(e.data)
        node.connect(this.trim)
        this.node = node
        for (const p of this.pendingMessages) {
          node.port.postMessage(p.msg, p.transfer ?? [])
        }
        this.pendingMessages = []
      })
      .catch((err) => console.error("vinyl worklet failed to load", err))
  }

  private post(msg: unknown, transfer?: Transferable[]) {
    if (this.node) this.node.port.postMessage(msg, transfer ?? [])
    else this.pendingMessages.push({ msg, transfer })
  }

  private onWorkletMessage(d: WorkletMessage) {
    if (d.t === "pos" && d.s !== undefined) {
      this.posSeconds = d.s
      if (d.f !== undefined) this.posFrame = d.f
    } else if (d.t === "ended") {
      this._playing = false
      this.emit()
    }
  }

  private emit() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  // ----- state -----

  get playing() {
    return this._playing
  }

  get scratching() {
    return this._scratching
  }

  get rate() {
    return this._rate
  }

  get duration() {
    return this.track?.duration ?? 0
  }

  /** Effective BPM after pitch is applied. */
  get effectiveBpm(): number | null {
    if (!this.track?.bpm) return null
    return this.track.bpm * this._rate
  }

  get position(): number {
    return Math.min(Math.max(this.posSeconds, 0), this.duration)
  }

  /** Audio-thread frame stamp of the last reported position. */
  get lastPosFrame(): number {
    return this.posFrame
  }

  /**
   * Extrapolate this deck's playhead to a moment on the shared
   * audio-thread clock — lets two decks be compared sample-accurately.
   */
  positionAtFrame(frame: number): number {
    const rate = this._playing && !this._scratching ? this._rate : 0
    return this.posSeconds + ((frame - this.posFrame) / this.ctx.sampleRate) * rate
  }

  // ----- track loading -----

  loadTrack(track: Track) {
    this.track = track
    this._playing = false
    this._scratching = false
    this.posSeconds = 0
    this.cuePoint = 0
    this.loop = null
    this.hotCues = Array(HOT_CUE_COUNT).fill(null)

    // Ship a copy of the PCM to the worklet (the original buffer may be
    // loaded on the other deck too).
    const buf = track.buffer
    const channels: ArrayBuffer[] = []
    for (let c = 0; c < Math.min(buf.numberOfChannels, 2); c++) {
      const data = new Float32Array(buf.length)
      buf.copyFromChannel(data, c)
      channels.push(data.buffer)
    }
    this.post({ t: "load", channels, length: buf.length, rate: buf.sampleRate }, channels)
    this.emit()
  }

  // ----- transport -----

  async play() {
    if (!this.track || this._playing) return
    if (this.ctx.state === "suspended") await this.ctx.resume()
    if (this.posSeconds >= this.duration - 0.01) {
      this.posSeconds = 0
      this.post({ t: "seek", s: 0 })
    }
    this.post({ t: "play", rate: this._rate })
    this._playing = true
    this.emit()
  }

  pause() {
    if (!this._playing) return
    this.post({ t: "pause" })
    this._playing = false
    this.emit()
  }

  async togglePlay() {
    if (this._playing) this.pause()
    else await this.play()
  }

  /**
   * CDJ-style cue: while playing, snap back to the cue point and pause.
   * While paused, set the cue point to the current position.
   */
  async cue() {
    if (!this.track) return
    if (this._playing) {
      this.pause()
      this.seek(this.cuePoint)
    } else {
      this.cuePoint = this.position
      this.emit()
    }
  }

  seek(time: number) {
    if (!this.track) return
    const t = Math.min(Math.max(time, 0), this.duration)
    if (this.loop && (t < this.loop.start || t > this.loop.end)) {
      this.loop = null
      this.post({ t: "loop", loop: null })
    }
    this.post({ t: "seek", s: t })
    this.posSeconds = t
    this.emit()
  }

  // ----- pitch -----

  /** rate = 1 is original tempo. */
  setRate(rate: number) {
    this._rate = rate
    this.post({ t: "rate", rate })
    this.emit()
  }

  /**
   * Sync to another deck. Matches the exact analyzed tempo, and — when
   * both decks have beat grids and are playing — shifts the playhead so
   * both land on the same phase within their bars.
   */
  syncTo(other: DeckEngine): { pitch: number; barAligned: boolean } | null {
    const ownGrid = this.track?.grid ?? null
    const otherGrid = other.track?.grid ?? null
    const ownBpm = ownGrid?.bpm ?? this.track?.bpm
    const otherBpm = otherGrid?.bpm ?? other.track?.bpm
    if (!ownBpm || !otherBpm) return null

    let rate = (otherBpm * other.rate) / ownBpm
    // Fold doubled/halved detections into a sane range.
    while (rate > 1.5) rate /= 2
    while (rate < 0.66) rate *= 2
    this.setRate(rate)

    let barAligned = false
    if (ownGrid && otherGrid && this._playing && other.playing && !this._scratching) {
      // Compare both playheads at one shared audio-clock moment, then
      // shift this deck to the other's phase within the bar. Because the
      // rates are now an exact ratio, the alignment holds afterwards.
      const frame = Math.max(this.posFrame, other.lastPosFrame)
      const tSelf = this.positionAtFrame(frame)
      const tOther = other.positionAtFrame(frame)
      const ownBar = (60 / ownGrid.bpm) * ownGrid.beatsPerBar
      const otherBar = (60 / otherGrid.bpm) * otherGrid.beatsPerBar
      const phiSelf = positiveMod((tSelf - ownGrid.firstBar) / ownBar, 1)
      const phiOther = positiveMod((tOther - otherGrid.firstBar) / otherBar, 1)
      let dPhi = phiOther - phiSelf
      dPhi -= Math.round(dPhi) // nearest direction, at most half a bar
      const shift = dPhi * ownBar
      this.post({ t: "shift", s: shift })
      this.posSeconds = Math.min(Math.max(this.posSeconds + shift, 0), this.duration)
      barAligned = true
    }
    this.emit()
    return { pitch: (rate - 1) * 100, barAligned }
  }

  // ----- scratching (jog wheel) -----

  /** Grab the record: playback now follows the platter exclusively. */
  async scratchBegin() {
    if (!this.track) return
    if (this.ctx.state === "suspended") await this.ctx.resume()
    this._scratching = true
    this.post({ t: "scratchOn" })
  }

  /** Signed platter velocity; 1 = forward at normal speed, -1 = reverse. */
  scratchMove(rate: number) {
    if (!this._scratching) return
    this.post({ t: "scratchRate", rate })
  }

  /** Release the record: ramps back to play speed (or to rest if paused). */
  scratchEnd() {
    if (!this._scratching) return
    this._scratching = false
    this.post({ t: "scratchOff" })
  }

  // ----- hot cues -----

  triggerHotCue(index: number) {
    if (!this.track) return
    const existing = this.hotCues[index]
    if (existing === null) {
      this.hotCues = [...this.hotCues]
      this.hotCues[index] = this.position
    } else {
      this.seek(existing)
    }
    this.emit()
  }

  clearHotCue(index: number) {
    this.hotCues = [...this.hotCues]
    this.hotCues[index] = null
    this.emit()
  }

  // ----- loops -----

  /**
   * Engage a loop of `bars` bars (fractions allowed: 0.125 = eighth of a
   * bar). With a beat grid the loop snaps onto the grid line of its own
   * subdivision, so it is always musically in place.
   */
  setBarLoop(bars: number) {
    if (!this.track) return
    const grid = this.track.grid
    const bpm = grid?.bpm ?? this.track.bpm ?? 120
    const beatsPerBar = grid?.beatsPerBar ?? 4
    const length = bars * (60 / bpm) * beatsPerBar

    let start: number
    if (grid) {
      // Snap to the previous grid line of this subdivision (grid lines
      // extrapolate backward from the downbeat anchor too).
      start = grid.firstBar + Math.floor((this.position - grid.firstBar) / length) * length
      if (start < 0) start = Math.max(this.position, 0)
    } else {
      start = this.position
    }
    const end = Math.min(start + length, this.duration)
    this.loop = { start, end, bars }
    this.post({ t: "loop", loop: { start, end } })
    this.emit()
  }

  clearLoop() {
    this.loop = null
    this.post({ t: "loop", loop: null })
    this.emit()
  }

  // ----- mixer controls -----

  setTrim(gain: number) {
    this.trim.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01)
  }

  /** value in -1..1, mapped to dB (full kill at -1). */
  setEq(band: "low" | "mid" | "high", value: number) {
    const node = band === "low" ? this.eqLow : band === "mid" ? this.eqMid : this.eqHigh
    const db = value <= -0.99 ? -40 : value * 12
    node.gain.setTargetAtTime(db, this.ctx.currentTime, 0.01)
  }

  /** value in -1..1; negative = low-pass sweep, positive = high-pass sweep, 0 = bypass. */
  setFilter(value: number) {
    const nyquist = this.ctx.sampleRate / 2
    if (value < -0.05) {
      this.filter.type = "lowpass"
      // 0 -> ~nyquist, -1 -> 80 Hz (log sweep)
      const t = -value
      this.filter.frequency.value = Math.exp(Math.log(nyquist) + t * (Math.log(80) - Math.log(nyquist)))
      this.filter.Q.value = 4
    } else if (value > 0.05) {
      this.filter.type = "highpass"
      const t = value
      this.filter.frequency.value = Math.exp(Math.log(20) + t * (Math.log(8000) - Math.log(20)))
      this.filter.Q.value = 4
    } else {
      this.filter.type = "allpass"
      this.filter.frequency.value = nyquist * 0.9
      this.filter.Q.value = 0.0001
    }
  }

  setFader(volume: number) {
    this.fader.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.01)
  }

  setCrossfadeGain(gain: number) {
    this.xfade.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01)
  }
}

function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m
}
