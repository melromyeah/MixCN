"use client"

import * as React from "react"

import type { DeckEngine } from "@/lib/dj/deck-engine"
import { cn } from "@/lib/utils"

interface WaveformProps {
  deck: DeckEngine
  className?: string
}

/**
 * Canvas overview waveform: played portion in primary, remainder muted,
 * loop region tinted, hot cue + cue point markers, click/drag to seek.
 */
export function Waveform({ deck, className }: WaveformProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const offscreenRef = React.useRef<HTMLCanvasElement | null>(null)
  const colorsRef = React.useRef<Record<string, string>>({})
  const scrubbing = React.useRef(false)
  const wasPlaying = React.useRef(false)

  // Resolve theme colors once mounted (canvas can't use CSS vars directly).
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
    const observer = new MutationObserver(() => {
      readColors()
      offscreenRef.current = null // re-render base layer on theme change
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [readColors])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let lastTrackId: string | null = null

    const renderBase = (w: number, h: number, dpr: number) => {
      const off = document.createElement("canvas")
      off.width = w * dpr
      off.height = h * dpr
      const octx = off.getContext("2d")
      if (!octx || !deck.track) return off
      octx.scale(dpr, dpr)
      octx.fillStyle = colorsRef.current.muted
      octx.globalAlpha = 0.35
      drawPeaks(octx, deck.track.peaks, w, h)
      return off
    }

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
        offscreenRef.current = null
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const track = deck.track
      if (!track) {
        lastTrackId = null
        ctx.strokeStyle = colorsRef.current.border
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        return
      }

      if (!offscreenRef.current || lastTrackId !== track.id) {
        offscreenRef.current = renderBase(w, h, dpr)
        lastTrackId = track.id
      }
      ctx.drawImage(offscreenRef.current, 0, 0, w, h)

      const progress = deck.position / track.duration
      const playedX = progress * w

      // Played portion, clipped redraw in primary color.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, playedX, h)
      ctx.clip()
      ctx.fillStyle = colorsRef.current.primary
      drawPeaks(ctx, track.peaks, w, h)
      ctx.restore()

      // Loop region
      if (deck.loop) {
        const x1 = (deck.loop.start / track.duration) * w
        const x2 = (deck.loop.end / track.duration) * w
        ctx.fillStyle = colorsRef.current.accent
        ctx.globalAlpha = 0.2
        ctx.fillRect(x1, 0, x2 - x1, h)
        ctx.globalAlpha = 1
        ctx.fillStyle = colorsRef.current.accent
        ctx.fillRect(x1, 0, 1.5, h)
        ctx.fillRect(x2 - 1.5, 0, 1.5, h)
      }

      // Cue point
      ctx.fillStyle = colorsRef.current.cue
      const cueX = (deck.cuePoint / track.duration) * w
      ctx.fillRect(cueX - 1, 0, 2, h)

      // Hot cues
      deck.hotCues.forEach((cue, i) => {
        if (cue === null) return
        const x = (cue / track.duration) * w
        ctx.fillStyle = colorsRef.current.accent
        ctx.fillRect(x - 1, 0, 2, h)
        ctx.font = "9px ui-monospace, monospace"
        ctx.fillText(String(i + 1), x + 3, 10)
      })

      // Playhead
      ctx.fillStyle = colorsRef.current.destructive
      ctx.fillRect(playedX - 1, 0, 2, h)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck])

  const seekFromEvent = (e: React.PointerEvent) => {
    if (!deck.track) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    deck.seek(ratio * deck.track.duration)
  }

  return (
    <canvas
      ref={canvasRef}
      className={cn("h-20 w-full cursor-crosshair rounded-md border bg-muted/30", className)}
      onPointerDown={(e) => {
        if (!deck.track) return
        e.currentTarget.setPointerCapture(e.pointerId)
        scrubbing.current = true
        wasPlaying.current = deck.playing
        seekFromEvent(e)
      }}
      onPointerMove={(e) => {
        if (scrubbing.current) seekFromEvent(e)
      }}
      onPointerUp={(e) => {
        scrubbing.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
    />
  )
}

function drawPeaks(ctx: CanvasRenderingContext2D, peaks: Float32Array, w: number, h: number) {
  const mid = h / 2
  const barWidth = w / peaks.length
  for (let i = 0; i < peaks.length; i++) {
    const amp = Math.max(peaks[i] * (h / 2 - 2), 0.5)
    ctx.fillRect(i * barWidth, mid - amp, Math.max(barWidth * 0.8, 0.5), amp * 2)
  }
}
