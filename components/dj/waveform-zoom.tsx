"use client"

import * as React from "react"

import type { DeckEngine } from "@/lib/dj/deck-engine"
import { computePeaks } from "@/lib/dj/peaks"
import type { Track } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

interface WaveformZoomProps {
  deck: DeckEngine
  /** Seconds of audio visible across the strip. */
  windowSeconds?: number
  className?: string
}

// High-resolution peaks per track, computed once on demand.
const zoomPeaksCache = new WeakMap<Track, Float32Array>()
const ZOOM_PPS = 120 // peak buckets per second

function zoomPeaksFor(track: Track): Float32Array {
  let peaks = zoomPeaksCache.get(track)
  if (!peaks) {
    peaks = computePeaks(track.buffer, Math.ceil(track.duration * ZOOM_PPS))
    zoomPeaksCache.set(track, peaks)
  }
  return peaks
}

/**
 * Magnified waveform that scrolls under a fixed center playhead, with
 * beat-grid tick marks (downbeats emphasized), the loop region, and hot
 * cue markers. The overview waveform above stays the map; this is the
 * street view.
 */
export function WaveformZoom({ deck, windowSeconds = 8, className }: WaveformZoomProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const colorsRef = React.useRef<Record<string, string>>({})

  const readColors = React.useCallback(() => {
    const style = getComputedStyle(document.documentElement)
    const get = (name: string) => style.getPropertyValue(name).trim()
    colorsRef.current = {
      primary: get("--primary"),
      muted: get("--muted-foreground"),
      accent: get("--chart-2"),
      cue: get("--chart-4"),
      destructive: get("--destructive"),
      border: get("--border"),
    }
  }, [])

  React.useEffect(() => {
    readColors()
    const observer = new MutationObserver(readColors)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [readColors])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const dpr = window.devicePixelRatio || 1
      const w = rect.width
      const h = rect.height
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const track = deck.track
      const colors = colorsRef.current
      if (!track) {
        ctx.strokeStyle = colors.border
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        return
      }

      const peaks = zoomPeaksFor(track)
      const pos = deck.position
      const tStart = pos - windowSeconds / 2
      const secPerPx = windowSeconds / w
      const mid = h / 2

      // ---- waveform bars ----
      for (let x = 0; x < w; x++) {
        const t = tStart + x * secPerPx
        if (t < 0 || t >= track.duration) continue
        const idx = Math.floor(t * ZOOM_PPS)
        const amp = Math.max((peaks[idx] ?? 0) * (mid - 2), 0.5)
        ctx.fillStyle = t <= pos ? colors.primary : colors.muted
        ctx.globalAlpha = t <= pos ? 0.9 : 0.45
        ctx.fillRect(x, mid - amp, 1, amp * 2)
      }
      ctx.globalAlpha = 1

      // ---- beat grid ticks ----
      const grid = track.grid
      if (grid) {
        const beatLen = 60 / grid.bpm
        const firstVisibleBeat = Math.ceil((tStart - grid.firstBeat) / beatLen)
        for (let k = firstVisibleBeat; ; k++) {
          const t = grid.firstBeat + k * beatLen
          if (t > tStart + windowSeconds) break
          if (t < 0) continue
          const x = (t - tStart) / secPerPx
          // Downbeat = beat aligned with the bar anchor.
          const beatsFromBar = Math.round((t - grid.firstBar) / beatLen)
          const isDownbeat = ((beatsFromBar % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0
          ctx.fillStyle = isDownbeat ? colors.cue : colors.border
          ctx.globalAlpha = isDownbeat ? 0.9 : 0.7
          ctx.fillRect(x - (isDownbeat ? 1 : 0.5), 0, isDownbeat ? 2 : 1, isDownbeat ? h : h * 0.55)
        }
        ctx.globalAlpha = 1
      }

      // ---- loop region ----
      if (deck.loop) {
        const x1 = (deck.loop.start - tStart) / secPerPx
        const x2 = (deck.loop.end - tStart) / secPerPx
        if (x2 > 0 && x1 < w) {
          ctx.fillStyle = colors.accent
          ctx.globalAlpha = 0.18
          ctx.fillRect(Math.max(x1, 0), 0, Math.min(x2, w) - Math.max(x1, 0), h)
          ctx.globalAlpha = 1
          ctx.fillRect(x1 - 1, 0, 2, h)
          ctx.fillRect(x2 - 1, 0, 2, h)
        }
      }

      // ---- hot cues ----
      deck.hotCues.forEach((cue, i) => {
        if (cue === null) return
        const x = (cue - tStart) / secPerPx
        if (x < 0 || x > w) return
        ctx.fillStyle = colors.accent
        ctx.fillRect(x - 1, 0, 2, h)
        ctx.font = "9px ui-monospace, monospace"
        ctx.fillText(String(i + 1), x + 3, 10)
      })

      // ---- center playhead ----
      ctx.fillStyle = colors.destructive
      ctx.fillRect(w / 2 - 1, 0, 2, h)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck, windowSeconds])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("h-14 w-full rounded-md border bg-muted/30", className)}
    />
  )
}
