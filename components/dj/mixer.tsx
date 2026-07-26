"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Fader } from "@/components/dj/fader"
import { Knob } from "@/components/dj/knob"
import { VuMeter } from "@/components/dj/vu-meter"
import type { AudioEngine } from "@/lib/dj/audio-engine"
import type { DeckEngine, FxType } from "@/lib/dj/deck-engine"
import type { DeckId } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

interface MixerProps {
  engine: AudioEngine
  className?: string
}

// Scales with viewport height so all five knobs + fader fit on short screens.
const KNOB_SIZE = "clamp(26px, 4.2vh, 44px)"

export function Mixer({ engine, className }: MixerProps) {
  // The engine owns the crossfade position (Auto-DJ drives it too), so the
  // fader subscribes rather than keeping local state.
  React.useSyncExternalStore(
    engine.subscribe,
    () => engine.version,
    () => 0
  )
  const crossfade = engine.crossfade
  const [masterVolume, setMasterVolume] = React.useState(0.9)

  const applyCrossfade = (v: number) => engine.setCrossfade(v)
  // Read the engine (never a render capture) so rapid clicks stay exact.
  const nudgeCrossfade = (delta: number) => engine.setCrossfade(engine.crossfade + delta)

  return (
    <Card className={cn("h-full gap-3 py-3", className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-3 px-4">
        {/* Channel strips with the master level in between */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-3">
          <ChannelStrip deckId="A" engine={engine} />

          <div className="flex min-h-0 flex-col items-center justify-between gap-2">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              Master
            </span>
            <div className="flex min-h-12 w-full py-3 flex-1 items-stretch justify-center gap-1.5">
              <VuMeter analyser={engine.masterAnalyserL} />
              <Fader
                orientation="vertical"
                min={0}
                max={1}
                step={0.01}
                value={masterVolume}
                defaultValue={0.9}
                ticks={5}
                onValueChange={(v) => {
                  setMasterVolume(v)
                  engine.setMasterVolume(v)
                }}
                label="Master volume"
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <VuMeter analyser={engine.masterAnalyserR} />
            </div>
          </div>

          <ChannelStrip deckId="B" engine={engine} />
        </div>

        <Separator className="shrink-0" />

        {/* Beat-synced FX, one panel per channel */}
        <div className="grid shrink-0 grid-cols-2 gap-3">
          <FxPanel deck={engine.decks.A} deckId="A" />
          <FxPanel deck={engine.decks.B} deckId="B" />
        </div>

        <Separator className="shrink-0" />

        {/* Crossfader */}
        <div className="flex shrink-0 flex-col gap-1 pb-1">
          <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-muted-foreground">
            <span>A</span>
            <button
              className="uppercase tracking-wider hover:text-foreground"
              onClick={() => applyCrossfade(0)}
              title="Snap crossfader to center"
            >
              Crossfader
            </button>
            <span>B</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => nudgeCrossfade(-0.05)}
              aria-label="Nudge crossfader toward deck A"
              title="Nudge toward A"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Fader
              min={-1}
              max={1}
              step={0.01}
              value={crossfade}
              defaultValue={0}
              bipolar
              snapCenter
              ticks={5}
              onValueChange={applyCrossfade}
              label="Crossfader"
              className="h-10 min-w-0 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => nudgeCrossfade(0.05)}
              aria-label="Nudge crossfader toward deck B"
              title="Nudge toward B"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const FX_TYPES = ["Off", "Echo", "Reverb", "Flanger"]
const FX_BEAT_OPTIONS = [
  { label: "1/4", beats: 0.25 },
  { label: "1/2", beats: 0.5 },
  { label: "3/4", beats: 0.75 },
  { label: "1", beats: 1 },
]

/** Per-channel beat-synced FX: type, echo division, and wet amount. */
function FxPanel({ deck, deckId }: { deck: DeckEngine; deckId: DeckId }) {
  const [type, setType] = React.useState<string>("Off")
  const [beats, setBeats] = React.useState("1/2")
  const [wet, setWet] = React.useState(deck.fxWet)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-center text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        FX {deckId}
      </span>
      <Select
        value={type}
        onValueChange={(v) => {
          const next = String(v)
          setType(next)
          deck.setFx(next.toLowerCase() as FxType)
        }}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={`Deck ${deckId} effect`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FX_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Mirrored about the mixer centerline */}
      <div
        className={cn(
          "flex items-center justify-between gap-1.5",
          deckId === "B" && "flex-row-reverse"
        )}
      >
        <Select
          value={beats}
          onValueChange={(v) => {
            const next = String(v)
            setBeats(next)
            const opt = FX_BEAT_OPTIONS.find((o) => o.label === next)
            if (opt) deck.setFxBeats(opt.beats)
          }}
        >
          <SelectTrigger
            size="sm"
            className="flex-1 font-mono"
            aria-label={`Deck ${deckId} echo beats`}
            title="Echo length in beats"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FX_BEAT_OPTIONS.map((o) => (
              <SelectItem key={o.label} value={o.label}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Knob
          value={wet}
          min={0}
          max={1}
          defaultValue={0.5}
          size={28}
          onValueChange={(v) => {
            setWet(v)
            deck.setFxWet(v)
          }}
          label={undefined}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
    </div>
  )
}

function ChannelStrip({ deckId, engine }: { deckId: DeckId; engine: AudioEngine }) {
  const deck = engine.decks[deckId]
  const [trim, setTrim] = React.useState(1)
  const [high, setHigh] = React.useState(0)
  const [mid, setMid] = React.useState(0)
  const [low, setLow] = React.useState(0)
  const [filter, setFilter] = React.useState(0)
  const [volume, setVolume] = React.useState(1)

  const formatDb = (v: number) => (v <= -0.99 ? "KILL" : `${(v * 12).toFixed(1)} dB`)

  return (
    <div className="flex min-h-0 flex-col items-center justify-between gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{deckId}</span>
      <Knob
        size={KNOB_SIZE}
        label="Trim"
        value={trim}
        min={0}
        max={1.5}
        defaultValue={1}
        onValueChange={(v) => {
          setTrim(v)
          deck.setTrim(v)
        }}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Knob
        size={KNOB_SIZE}
        label="Hi"
        value={high}
        min={-1}
        max={1}
        bipolar
        defaultValue={0}
        onValueChange={(v) => {
          setHigh(v)
          deck.setEq("high", v)
        }}
        format={formatDb}
      />
      <Knob
        size={KNOB_SIZE}
        label="Mid"
        value={mid}
        min={-1}
        max={1}
        bipolar
        defaultValue={0}
        onValueChange={(v) => {
          setMid(v)
          deck.setEq("mid", v)
        }}
        format={formatDb}
      />
      <Knob
        size={KNOB_SIZE}
        label="Low"
        value={low}
        min={-1}
        max={1}
        bipolar
        defaultValue={0}
        onValueChange={(v) => {
          setLow(v)
          deck.setEq("low", v)
        }}
        format={formatDb}
      />
      <Knob
        size={KNOB_SIZE}
        label="Filter"
        value={filter}
        min={-1}
        max={1}
        bipolar
        defaultValue={0}
        onValueChange={(v) => {
          setFilter(v)
          deck.setFilter(v)
        }}
        format={(v) => (Math.abs(v) <= 0.05 ? "OFF" : v < 0 ? "LPF" : "HPF")}
      />
      {/* VU meters and ticks face the master strip so both halves mirror. */}
      <div className="flex min-h-10 w-full py-2 flex-1 items-stretch justify-center gap-2">
        {deckId === "B" && <VuMeter analyser={deck.analyser} />}
        <Fader
          orientation="vertical"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          defaultValue={1}
          ticks={5}
          tickSide={deckId === "A" ? "after" : "before"}
          onValueChange={(v) => {
            setVolume(v)
            deck.setFader(v)
          }}
          label={`Channel ${deckId} volume`}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        {deckId === "A" && <VuMeter analyser={deck.analyser} />}
      </div>
    </div>
  )
}
