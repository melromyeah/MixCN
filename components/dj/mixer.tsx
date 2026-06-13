"use client"

import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Fader } from "@/components/dj/fader"
import { Knob } from "@/components/dj/knob"
import { VuMeter } from "@/components/dj/vu-meter"
import type { AudioEngine } from "@/lib/dj/audio-engine"
import type { DeckId } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

interface MixerProps {
  engine: AudioEngine
  className?: string
}

// Scales with viewport height so all five knobs + fader fit on short screens.
const KNOB_SIZE = "clamp(28px, 4.8vh, 48px)"

export function Mixer({ engine, className }: MixerProps) {
  const [crossfade, setCrossfade] = React.useState(0)
  const [masterVolume, setMasterVolume] = React.useState(0.9)

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
            <div className="flex min-h-16 w-full flex-1 items-stretch justify-center gap-1.5">
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

        {/* Crossfader */}
        <div className="flex shrink-0 flex-col gap-1.5 pb-1">
          <div className="flex justify-between text-[10px] font-semibold tracking-wider text-muted-foreground">
            <span>A</span>
            <span className="uppercase">Crossfader</span>
            <span>B</span>
          </div>
          <Fader
            min={-1}
            max={1}
            step={0.01}
            value={crossfade}
            defaultValue={0}
            bipolar
            snapCenter
            ticks={5}
            onValueChange={(v) => {
              setCrossfade(v)
              engine.setCrossfade(v)
            }}
            label="Crossfader"
            className="h-10"
          />
        </div>
      </CardContent>
    </Card>
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
    <div className="flex min-h-0 flex-col items-center justify-between gap-2">
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
      <div className="flex min-h-16 w-full flex-1 items-stretch justify-center gap-2">
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
