"use client"

import * as React from "react"
import { Circle, Disc3, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { Deck } from "@/components/dj/deck"
import { Mixer } from "@/components/dj/mixer"
import { TrackLibrary } from "@/components/dj/track-library"
import { getEngine, type AudioEngine } from "@/lib/dj/audio-engine"
import { analyzeBeatGrid } from "@/lib/dj/beatgrid"
import { useRaf } from "@/hooks/use-deck-state"

export function DjStation() {
  // AudioContext is browser-only; the server snapshot renders a placeholder.
  const engine = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    getEngine,
    () => null
  )

  // Expose the engine and analyzer in dev for debugging from the console.
  React.useEffect(() => {
    if (engine && process.env.NODE_ENV !== "production") {
      const w = window as unknown as Record<string, unknown>
      w.__engine = engine
      w.__analyzeBeatGrid = analyzeBeatGrid
    }
  }, [engine])

  const rootRef = React.useRef<HTMLDivElement>(null)

  // Bass-reactive glow: read the silent low-passed master tap and drive a
  // single `--glow` CSS variable; the cards' outlines pick it up via CSS.
  React.useEffect(() => {
    if (!engine) return
    const analyser = engine.glowAnalyser
    const data = new Float32Array(analyser.fftSize)
    let level = 0
    let peak = 0.05
    let raf = 0
    let last = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(now - last, 100)
      last = now
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      // Normalize against the recent bass peak so quiet and loud tracks
      // both pulse over the full range, then emphasize the beats.
      peak = Math.max(peak * Math.exp(-dt / 4000), rms, 0.04)
      const target = Math.pow(Math.min(rms / peak, 1), 1.6)
      // Fast attack on the kick, slower release for a breathing glow
      // (time-based so throttled tabs behave the same as 60fps).
      const tau = target > level ? 25 : 130
      level += (target - level) * (1 - Math.exp(-dt / tau))
      rootRef.current?.style.setProperty("--glow", level.toFixed(3))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  if (!engine) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Disc3 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="console-glow flex min-h-svh w-full flex-col bg-background lg:[@media(min-height:620px)]:h-svh lg:[@media(min-height:620px)]:overflow-hidden"
    >
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2.5">
          <div>
            <h1 className="text-sm leading-tight font-bold tracking-tight">MixCN</h1>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Version 0.1.23
            </p>
          </div>
        </div>
        <RecordButton engine={engine} />
      </header>

      <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_clamp(220px,19vw,300px)_minmax(0,1fr)]">
        <Deck deckId="A" deck={engine.decks.A} otherDeck={engine.decks.B} className="min-h-0" />
        <Mixer engine={engine} className="order-first min-h-0 lg:order-none" />
        <Deck deckId="B" deck={engine.decks.B} otherDeck={engine.decks.A} className="min-h-0" />
      </main>

      <div className="shrink-0 px-3 pb-3 lg:h-[clamp(240px,34vh,460px)]">
        <TrackLibrary engine={engine} className="h-full" />
      </div>

      <Toaster position="bottom-right" />
    </div>
  )
}

function RecordButton({ engine }: { engine: AudioEngine }) {
  const [recording, setRecording] = React.useState(false)
  const timerRef = React.useRef<HTMLSpanElement>(null)

  useRaf(() => {
    if (!timerRef.current) return
    if (engine.recordingStartedAt !== null) {
      const s = (performance.now() - engine.recordingStartedAt) / 1000
      const m = Math.floor(s / 60)
      timerRef.current.textContent = `${m}:${Math.floor(s % 60)
        .toString()
        .padStart(2, "0")}`
    } else {
      timerRef.current.textContent = ""
    }
  })

  const toggle = async () => {
    if (!recording) {
      await engine.resume()
      engine.startRecording()
      setRecording(true)
      toast("Recording started", { description: "Capturing the master output." })
    } else {
      const blob = await engine.stopRecording()
      setRecording(false)
      if (blob && blob.size > 0) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        const ext = blob.type.includes("mp4") ? "m4a" : "webm"
        a.href = url
        a.download = `mixdeck-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${ext}`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        toast.success("Mix saved", { description: "Your recording has been downloaded." })
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span ref={timerRef} className="font-mono text-sm text-destructive tabular-nums" />
      <Button variant={recording ? "destructive" : "outline"} size="sm" onClick={toggle}>
        {recording ? (
          <>
            <Square className="fill-current" /> Stop & save
          </>
        ) : (
          <>
            <Circle className="fill-destructive stroke-destructive" /> Record mix
          </>
        )}
      </Button>
    </div>
  )
}
