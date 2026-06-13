"use client"

import * as React from "react"

import type { DeckEngine } from "@/lib/dj/deck-engine"
import { cn } from "@/lib/utils"

interface JogWheelProps {
  deck: DeckEngine
  /** CSS size (number = px); "fill" sizes to the parent's height. */
  size?: number | string
  className?: string
}

// Vinyl at 33 1/3 RPM: one revolution every 1.8 seconds.
const SECONDS_PER_REV = 1.5
// Degrees per millisecond when spinning at normal speed.
const DEG_PER_MS_AT_1X = 360 / (SECONDS_PER_REV * 1000)

/**
 * Vinyl platter. Grabbing it takes over playback completely: the audio
 * follows the platter's angular velocity (backward = reverse), holding
 * it still is silence, and releasing ramps back to play speed — true
 * scratching, whether the deck is playing or paused.
 */
export function JogWheel({ deck, size = "fill", className }: JogWheelProps) {
  const discRef = React.useRef<HTMLDivElement>(null)
  const scratch = React.useRef<{
    lastAngle: number
    lastTime: number
    velocity: number
    raf: number
  } | null>(null)

  React.useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = discRef.current
      if (!el) return
      const rotation = (deck.position / SECONDS_PER_REV) * 360
      el.style.transform = `rotate(${rotation}deg)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck])

  // If the pointer stops moving while holding the record, the velocity
  // must decay to zero (held vinyl = silence). Pointer events only fire
  // on movement, so run a small decay loop during the scratch.
  const startDecayLoop = () => {
    const step = () => {
      const s = scratch.current
      if (!s) return
      if (performance.now() - s.lastTime > 50 && s.velocity !== 0) {
        s.velocity *= 0.55
        if (Math.abs(s.velocity) < 0.02) s.velocity = 0
        deck.scratchMove(s.velocity)
      }
      s.raf = requestAnimationFrame(step)
    }
    if (scratch.current) scratch.current.raf = requestAnimationFrame(step)
  }

  const angleFromEvent = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!deck.track) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointer already released (e.g. synthetic events)
    }
    void deck.scratchBegin()
    scratch.current = {
      lastAngle: angleFromEvent(e),
      lastTime: performance.now(),
      velocity: 0,
      raf: 0,
    }
    startDecayLoop()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = scratch.current
    if (!s || !deck.track) return
    const angle = angleFromEvent(e)
    let delta = angle - s.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const now = performance.now()
    const dt = Math.max(now - s.lastTime, 1)
    s.lastAngle = angle
    s.lastTime = now

    // Angular velocity relative to normal 33 1/3 RPM rotation.
    const instant = delta / dt / DEG_PER_MS_AT_1X
    s.velocity = s.velocity * 0.5 + instant * 0.5
    deck.scratchMove(s.velocity)
  }

  const endScratch = (e: React.PointerEvent) => {
    const s = scratch.current
    if (s) {
      cancelAnimationFrame(s.raf)
      scratch.current = null
      deck.scratchEnd()
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // capture was never established
    }
  }

  return (
    <div
      className={cn(
        "relative touch-none select-none rounded-full border bg-card shadow-sm",
        deck.track ? "cursor-grab active:cursor-grabbing" : "opacity-60",
        size === "fill" && "aspect-square h-full max-h-full max-w-full",
        className
      )}
      style={size === "fill" ? undefined : { width: size, height: size }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScratch}
      onPointerCancel={endScratch}
      aria-label="Jog wheel"
    >
      {/* grooves */}
      <div className="absolute inset-2 rounded-full border border-border/60" />
      <div className="absolute inset-4 rounded-full border border-border/40" />
      <div className="absolute inset-6 rounded-full border border-border/30" />
      {/* rotating disc */}
      <div ref={discRef} className="absolute inset-8 will-change-transform">
        <div className="relative size-full rounded-full border bg-muted">
          {/* position marker */}
          <div className="absolute top-1 left-1/2 h-1/4 w-1 -translate-x-1/2 rounded-full bg-primary" />
          {/* center label */}
          <div className="absolute inset-1/4 flex items-center justify-center rounded-full border bg-card">
            <div className="size-1.5 rounded-full bg-foreground/70" />
          </div>
        </div>
      </div>
    </div>
  )
}
