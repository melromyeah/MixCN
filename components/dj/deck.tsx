"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Music2, Pause, Play } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Fader } from "@/components/dj/fader"
import { JogWheel } from "@/components/dj/jog-wheel"
import { Waveform } from "@/components/dj/waveform"
import { WaveformZoom } from "@/components/dj/waveform-zoom"
import { useDeckVersion, useRaf } from "@/hooks/use-deck-state"
import type { DeckEngine } from "@/lib/dj/deck-engine"
import { formatBpm, formatPitch, formatTime } from "@/lib/dj/format"
import { HOT_CUE_COUNT, type DeckId } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

const PITCH_RANGE = 20 // ±20%
const LOOP_BARS = [
  { bars: 0.03125, label: "1/32" },
  { bars: 0.0625, label: "1/16" },
  { bars: 0.125, label: "1/8" },
  { bars: 0.25, label: "1/4" },
  { bars: 0.5, label: "1/2" },
  { bars: 1, label: "1" },
]

interface DeckProps {
  deckId: DeckId
  deck: DeckEngine
  otherDeck: DeckEngine
  className?: string
}

export function Deck({ deckId, deck, otherDeck, className }: DeckProps) {
  useDeckVersion(deck)
  const track = deck.track
  const pitchPercent = (deck.rate - 1) * 100

  const nudgePitch = (delta: number) => {
    // Read the engine (not render state) so rapid clicks never act on a
    // stale value.
    const current = (deck.rate - 1) * 100
    const next = Math.min(PITCH_RANGE, Math.max(-PITCH_RANGE, current + delta))
    deck.setRate(1 + Math.round(next * 10) / 1000)
  }

  const handleSync = () => {
    const result = deck.syncTo(otherDeck)
    if (result === null) {
      toast.error(`Can't sync deck ${deckId}`, {
        description: "Both decks need a loaded track with a detected BPM.",
      })
    } else {
      toast.success(`Deck ${deckId} synced`, {
        description: result.barAligned
          ? `${formatPitch(result.pitch)} → ${formatBpm(deck.effectiveBpm)} BPM, bar-aligned to deck ${deckId === "A" ? "B" : "A"}`
          : `Pitch set to ${formatPitch(result.pitch)} → ${formatBpm(deck.effectiveBpm)} BPM`,
      })
    }
  }

  return (
    <Card className={cn("h-full gap-3 py-3", className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-2.5 px-4">
        {/* Track header */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Badge
              variant={deckId === "A" ? "default" : "secondary"}
              className="size-7 shrink-0 justify-center rounded-md text-sm font-bold"
            >
              {deckId}
            </Badge>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {track ? track.title : "No track loaded"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {track ? track.artist : "Load one from the library below"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {track?.key && (
              <Badge variant="outline" className="font-mono text-[10px]" title={`Key: ${track.key.name}`}>
                {track.key.camelot} · {track.key.name}
              </Badge>
            )}
            <div className="text-right">
              <p className="font-mono text-xl leading-none font-semibold tabular-nums">
                {formatBpm(deck.effectiveBpm)}
              </p>
              <p className="text-[10px] tracking-wider text-muted-foreground uppercase">bpm</p>
            </div>
          </div>
        </div>

        <WaveformZoom deck={deck} className="h-20 shrink-0" />
        <Waveform deck={deck} className="h-7 shrink-0" />

        <TimeRow deck={deck} />

        {/* Deck B mirrors deck A so the loop/jump columns sit on the outer
            edges and the pitch faders flank the mixer symmetrically. */}
        {/* min-h keeps this row's real space requirement visible to the
            layout, so it can never get squeezed under the transport. */}
        <div
          className={cn(
            "flex min-h-52 flex-1 items-stretch gap-3",
            deckId === "B" && "flex-row-reverse"
          )}
        >
          {/* Loop + beat-jump columns on the outer side of the platter */}
          <div
            className={cn(
              "flex shrink-0 gap-1.5",
              deckId === "B" && "flex-row-reverse"
            )}
          >
            <div className="flex flex-col items-stretch gap-1">
              <span className="text-center text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
                Loop
              </span>
              {LOOP_BARS.map(({ bars, label }) => (
                <Button
                  key={bars}
                  variant={deck.loop?.bars === bars ? "default" : "outline"}
                  size="sm"
                  disabled={!track}
                  onClick={() =>
                    deck.loop?.bars === bars ? deck.clearLoop() : deck.setBarLoop(bars)
                  }
                  title={`Loop ${label} bar${bars > 1 ? "s" : ""}${track?.grid ? " (snaps to the beat grid)" : ""}`}
                  className="h-7 min-h-0 w-11 flex-1 px-0 font-mono text-[10px]"
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex flex-col items-stretch gap-1">
              <span className="text-center text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
                Jump
              </span>
              {[-4, -2, -1, 1, 2, 4].map((bars) => (
                <Button
                  key={bars}
                  variant="outline"
                  size="sm"
                  disabled={!track}
                  onClick={() => deck.beatJump(bars)}
                  title={`Jump ${bars > 0 ? "forward" : "back"} ${Math.abs(bars)} bar${Math.abs(bars) > 1 ? "s" : ""}`}
                  className="h-7 min-h-0 w-11 flex-1 px-0 font-mono text-[10px]"
                >
                  {bars > 0 ? `+${bars}` : bars}
                </Button>
              ))}
            </div>
          </div>

          {/* Jog */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
            <div className="flex min-h-20 w-full flex-1 items-center justify-center">
              <JogWheel deck={deck} />
            </div>
          </div>

          {/* Pitch */}
          <div className="flex min-h-0 flex-col items-center gap-1 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={!track}
              onClick={() => nudgePitch(0.1)}
              aria-label="Nudge pitch up 0.1%"
              title="Nudge pitch +0.1%"
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Fader
              orientation="vertical"
              min={-PITCH_RANGE}
              max={PITCH_RANGE}
              step={0.1}
              value={Number(pitchPercent.toFixed(1))}
              defaultValue={0}
              bipolar
              snapCenter
              ticks={9}
              tickSide={deckId === "A" ? "after" : "before"}
              onValueChange={(v) => deck.setRate(1 + v / 100)}
              disabled={!track}
              label="Pitch"
              format={formatPitch}
              className="min-h-0 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={!track}
              onClick={() => nudgePitch(-0.1)}
              aria-label="Nudge pitch down 0.1%"
              title="Nudge pitch -0.1%"
            >
              <ChevronDown className="size-3.5" />
            </Button>
            <button
              className="font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground"
              onClick={() => deck.setRate(1)}
              title="Reset pitch"
            >
              {formatPitch(pitchPercent)}
            </button>
          </div>
        </div>

        {/* Transport */}
        <div className="flex p-1.5 items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground">
          <div className="grid grid-cols-4 gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1 font-semibold tracking-wider"
              disabled={!track}
              onClick={() => deck.cue()}
            >
              CUE
            </Button>
            <Button
              variant={deck.playing ? "default" : "outline"}
              className="flex-1"
              disabled={!track}
              onClick={() => deck.togglePlay()}
              aria-label={deck.playing ? "Pause" : "Play"}
            >
              {deck.playing ? <Pause /> : <Play />}
            </Button>
            <Button
              variant={deck.slipMode ? "default" : "outline"}
              className="flex-1 font-semibold tracking-wider"
              disabled={!track}
              onClick={() => deck.setSlip(!deck.slipMode)}
              title="Slip: scratches and loops snap back to where the track would have been"
            >
              SLIP
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={!track}
              onClick={handleSync}
            >
              SYNC
            </Button>
          </div>
        </div>

        {/* Hot cues */}
        <div className="flex p-1.5 items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground">
          <div className="grid grid-cols-4 gap-2 w-full">
            {Array.from({ length: HOT_CUE_COUNT }, (_, i) => {
              const set = deck.hotCues[i] !== null
              return (
                <Button
                  key={i}
                  variant={set ? "default" : "outline"}
                  size="sm"
                  disabled={!track}
                  onClick={() => deck.triggerHotCue(i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    deck.clearHotCue(i)
                  }}
                  title={set ? `Jump to cue ${i + 1} (right-click to clear)` : `Set cue ${i + 1}`}
                  className="font-mono text-xs"
                >
                  {set ? formatTime(deck.hotCues[i]!) : `CUE ${i + 1}`}
                </Button>
              )
            })}
          </div>
        </div>

        {/*
        {!track && (
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed py-2 text-xs text-muted-foreground">
            <Music2 className="size-3.5" />
            Drop a track here or use the library
          </div>
        )}
*/}
      </CardContent>
    </Card >
  )
}

/**
 * Elapsed / remaining time with a beat-phase indicator in the middle:
 * four dots, one per beat of the bar, lit as the bar plays through.
 * Updated via rAF outside React renders.
 */
function TimeRow({ deck }: { deck: DeckEngine }) {
  const elapsedRef = React.useRef<HTMLSpanElement>(null)
  const remainRef = React.useRef<HTMLSpanElement>(null)
  const dotsRef = React.useRef<HTMLDivElement>(null)

  useRaf(() => {
    if (elapsedRef.current) elapsedRef.current.textContent = formatTime(deck.position)
    if (remainRef.current)
      remainRef.current.textContent = `-${formatTime(Math.max(deck.duration - deck.position, 0))}`
    const dots = dotsRef.current
    if (dots) {
      const grid = deck.track?.grid
      dots.style.visibility = grid ? "visible" : "hidden"
      if (grid) {
        const beatLen = 60 / grid.bpm
        const raw = (deck.position - grid.firstBar) / beatLen
        const beat = Math.floor(((raw % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar)
        for (let i = 0; i < dots.children.length; i++) {
          ;(dots.children[i] as HTMLElement).style.opacity = i === beat ? "1" : "0.25"
        }
      }
    }
  })

  return (
    <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
      <span ref={elapsedRef}>0:00.0</span>
      <div ref={dotsRef} aria-hidden className="flex items-center gap-1.5" style={{ visibility: "hidden" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-primary" style={{ opacity: 0.25 }} />
        ))}
      </div>
      <span ref={remainRef}>-0:00.0</span>
    </div>
  )
}
