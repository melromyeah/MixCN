import type { AudioEngine } from "./audio-engine"
import type { DeckEngine } from "./deck-engine"
import type { DeckId, Track } from "./types"

export type AutoDjPhase = "idle" | "playing" | "mixing"

/**
 * Auto-DJ: hands-free mixing on top of the existing machinery.
 *
 * A small state machine ticks a few times per second. While a track
 * plays, it watches the remaining time; N bars before the end it loads
 * the next library track on the idle deck, starts it on its first
 * downbeat, tempo-matches and bar-aligns it (syncTo), and sweeps the
 * crossfader across over those N bars. After the switch, the new live
 * deck's pitch eases back to its native tempo so the mix doesn't drift
 * over many transitions.
 */
export class AutoDj {
  private readonly engine: AudioEngine
  /** Supplies the next track to play; wired up by the library. */
  provider: (() => Promise<Track | null>) | null = null
  /** Crossfade length in bars. */
  bars = 8
  /** UI toast hook. */
  onEvent: ((message: string, description?: string) => void) | null = null

  active = false
  phase: AutoDjPhase = "idle"

  private live: DeckId = "A"
  private timer: ReturnType<typeof setInterval> | null = null
  private preparing = false
  private fade: { from: number; to: number; start: number; duration: number } | null = null

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

  constructor(engine: AudioEngine) {
    this.engine = engine
  }

  private deck(id: DeckId): DeckEngine {
    return this.engine.decks[id]
  }

  private get idle(): DeckId {
    return this.live === "A" ? "B" : "A"
  }

  async start(): Promise<boolean> {
    if (this.active) return true
    const { A, B } = this.engine.decks

    let live: DeckId | null = A.playing ? "A" : B.playing ? "B" : null
    if (!live) {
      if (A.track) live = "A"
      else if (B.track) live = "B"
      else {
        const first = await this.provider?.()
        if (!first) {
          this.onEvent?.("Auto-DJ needs tracks", "Add some tracks to the library first.")
          return false
        }
        A.loadTrack(first)
        live = "A"
      }
    }

    this.live = live
    this.active = true
    this.phase = "playing"
    this.preparing = false
    this.fade = null

    const deck = this.deck(live)
    await this.engine.resume()
    if (!deck.playing) {
      // Start on the first downbeat when we're at the top of the track.
      if (deck.track?.grid && deck.position < 0.05) deck.seek(deck.track.grid.firstBar)
      await deck.play()
    }
    this.engine.setCrossfade(live === "A" ? -1 : 1)

    this.timer = setInterval(() => void this.tick(), 200)
    this.onEvent?.("Auto-DJ on", `Mixing ${this.bars}-bar transitions from the library.`)
    this.emit()
    return true
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.phase = "idle"
    this.fade = null
    this.preparing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.onEvent?.("Auto-DJ off", "Decks are yours again.")
    this.emit()
  }

  private async tick() {
    if (!this.active) return
    const live = this.deck(this.live)
    const next = this.deck(this.idle)

    // ---- mid-crossfade: drive the fader ----
    if (this.phase === "mixing" && this.fade) {
      const t = (performance.now() - this.fade.start) / this.fade.duration
      if (t >= 1) {
        this.engine.setCrossfade(this.fade.to)
        live.pause()
        this.live = this.idle
        this.phase = "playing"
        this.fade = null
        this.preparing = false
        this.onEvent?.(
          `Auto-DJ: now on deck ${this.live}`,
          `"${this.deck(this.live).track?.title ?? ""}"`
        )
        this.emit()
      } else {
        this.engine.setCrossfade(this.fade.from + (this.fade.to - this.fade.from) * t)
      }
      return
    }

    if (!live.track) return

    // ---- ease the live deck back to its native tempo between mixes ----
    if (live.playing && !live.scratching && Math.abs(live.rate - 1) > 0.001) {
      live.setRate(live.rate + (1 - live.rate) * 0.04)
    } else if (live.playing && live.rate !== 1 && Math.abs(live.rate - 1) <= 0.001) {
      live.setRate(1)
    }

    // ---- watch the clock and start the next transition in time ----
    const bpm = live.effectiveBpm ?? 120
    const barSeconds = (60 / bpm) * (live.track.grid?.beatsPerBar ?? 4)
    const mixSeconds = this.bars * barSeconds
    const remaining = live.duration - live.position

    if (live.playing && !this.preparing && remaining <= mixSeconds + 2 * barSeconds) {
      this.preparing = true
      void this.beginTransition(live, next, mixSeconds)
      return
    }

    // ---- live deck ran out (no next track was available): retry a cut ----
    if (!live.playing && !this.preparing && remaining < 0.5) {
      this.preparing = true
      void this.beginTransition(live, next, Math.min(mixSeconds, 4))
    }
  }

  private async beginTransition(live: DeckEngine, next: DeckEngine, mixSeconds: number) {
    try {
      const track = await this.provider?.()
      if (!track) {
        this.preparing = false
        return
      }
      next.loadTrack(track)
      // Enter on the downbeat, tempo-matched and bar-aligned.
      next.seek(track.grid ? track.grid.firstBar : 0)
      await next.play()
      // Give the worklet a moment to report fresh frame-stamped positions
      // before phase alignment.
      await new Promise((r) => setTimeout(r, 250))
      if (!this.active) return
      next.syncTo(live)
      this.phase = "mixing"
      this.fade = {
        from: this.live === "A" ? -1 : 1,
        to: this.live === "A" ? 1 : -1,
        start: performance.now(),
        duration: Math.max(2, mixSeconds) * 1000,
      }
      this.onEvent?.(
        `Auto-DJ: mixing into "${track.title}"`,
        `${this.bars} bars, ${live.playing ? "beat-matched" : "cut"}.`
      )
      this.emit()
    } catch {
      this.preparing = false
    }
  }
}
