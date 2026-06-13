"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface FaderProps {
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  onValueChange: (value: number) => void
  orientation?: "horizontal" | "vertical"
  /** Fill the track from the center instead of the start (pitch, crossfader). */
  bipolar?: boolean
  /** Softly snap to the center value while dragging. */
  snapCenter?: boolean
  /** Number of tick marks along the track (0 = none). */
  ticks?: number
  /**
   * Which side of the track the ticks sit on: "center" crosses the track,
   * "before" is left/above, "after" is right/below the track.
   */
  tickSide?: "center" | "before" | "after"
  label?: string
  format?: (value: number) => string
  disabled?: boolean
  className?: string
}

/**
 * DJ-style fader matching the Knob aesthetic: muted track, primary fill,
 * card-colored cap with a foreground center line. Drag anywhere on the
 * track (hold Shift for fine control), scroll to nudge, double-click to
 * reset, arrow keys to step.
 */
export function Fader({
  value,
  min,
  max,
  step,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  bipolar = false,
  snapCenter = false,
  ticks = 0,
  tickSide = "center",
  label,
  format,
  disabled = false,
  className,
}: FaderProps) {
  const vertical = orientation === "vertical"
  const range = max - min
  const norm = clamp01((value - min) / range)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ fine: boolean; startNorm: number; startPos: number } | null>(null)

  const commit = React.useCallback(
    (n: number) => {
      let v = min + clamp01(n) * range
      if (step) v = Math.round(v / step) * step
      if (snapCenter) {
        const mid = (min + max) / 2
        if (Math.abs(v - mid) < range * 0.02) v = mid
      }
      onValueChange(Math.min(max, Math.max(min, v)))
    },
    [min, max, range, step, snapCenter, onValueChange]
  )

  const normFromEvent = (e: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return norm
    return vertical
      ? 1 - (e.clientY - rect.top) / rect.height
      : (e.clientX - rect.left) / rect.width
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointer already released (e.g. synthetic events)
    }
    drag.current = {
      fine: e.shiftKey,
      startNorm: norm,
      startPos: vertical ? e.clientY : e.clientX,
    }
    if (!e.shiftKey) commit(normFromEvent(e))
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.fine) {
      const rect = trackRef.current?.getBoundingClientRect()
      const length = (vertical ? rect?.height : rect?.width) || 1
      const delta = vertical ? d.startPos - e.clientY : e.clientX - d.startPos
      commit(d.startNorm + (delta / length) * 0.25)
    } else {
      commit(normFromEvent(e))
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // capture was never established
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return
    const s = (step ?? range / 100) * (e.shiftKey ? 1 : 2)
    commit(norm + ((e.deltaY < 0 ? s : -s) / range))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const s = (step ?? range / 100) / range
    const big = 0.1
    let n: number | null = null
    if (e.key === "ArrowUp" || e.key === "ArrowRight") n = norm + s
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") n = norm - s
    else if (e.key === "PageUp") n = norm + big
    else if (e.key === "PageDown") n = norm - big
    else if (e.key === "Home") n = 0
    else if (e.key === "End") n = 1
    if (n !== null) {
      e.preventDefault()
      commit(n)
    }
  }

  const reset = () => {
    if (disabled) return
    onValueChange(defaultValue ?? (bipolar ? (min + max) / 2 : min))
  }

  // Fill geometry (percent along the track).
  const fillStart = bipolar ? Math.min(norm, 0.5) : 0
  const fillSize = bipolar ? Math.abs(norm - 0.5) : norm

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={format?.(value)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onDoubleClick={reset}
      className={cn(
        "group relative touch-none select-none outline-none",
        vertical ? "h-full w-10" : "h-8 w-full",
        disabled ? "opacity-50" : "cursor-pointer",
        className
      )}
    >
      {/* ticks */}
      {ticks > 1 &&
        Array.from({ length: ticks }, (_, i) => {
          const pos = (i / (ticks - 1)) * 100
          const isCenter = bipolar && ticks % 2 === 1 && i === (ticks - 1) / 2
          const crossing = tickSide === "center"
          const length = crossing ? (isCenter ? 28 : 20) : isCenter ? 14 : 10
          const gap = "calc(50% + 5px)"
          const style: React.CSSProperties = vertical
            ? {
                bottom: `${pos}%`,
                height: 1,
                width: length,
                transform: crossing ? "translate(-50%, 50%)" : "translateY(50%)",
                ...(crossing
                  ? { left: "50%" }
                  : tickSide === "after"
                    ? { left: gap }
                    : { right: gap }),
              }
            : {
                left: `${pos}%`,
                width: 1,
                height: length,
                transform: crossing ? "translate(-50%, -50%)" : "translateX(-50%)",
                ...(crossing
                  ? { top: "50%" }
                  : tickSide === "after"
                    ? { top: gap }
                    : { bottom: gap }),
              }
          return (
            <div
              key={i}
              aria-hidden
              className={cn("absolute", isCenter ? "bg-muted-foreground/60" : "bg-border")}
              style={style}
            />
          )
        })}

      {/* track */}
      <div
        ref={trackRef}
        className={cn(
          "absolute overflow-hidden rounded-full bg-muted",
          vertical
            ? "top-0 left-1/2 h-full w-1.5 -translate-x-1/2"
            : "top-1/2 left-0 h-1.5 w-full -translate-y-1/2"
        )}
      >
        <div
          className="absolute rounded-full bg-primary"
          style={
            vertical
              ? { left: 0, right: 0, bottom: `${fillStart * 100}%`, height: `${fillSize * 100}%` }
              : { top: 0, bottom: 0, left: `${fillStart * 100}%`, width: `${fillSize * 100}%` }
          }
        />
      </div>

      {/* cap */}
      <div
        className={cn(
          "absolute rounded-[5px] border bg-card shadow-sm transition-shadow",
          "group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
          vertical ? "left-1/2 h-5 w-9 -translate-x-1/2" : "top-1/2 h-7 w-5 -translate-y-1/2"
        )}
        style={
          vertical
            ? { bottom: `calc(${norm * 100}% - 10px)` }
            : { left: `calc(${norm * 100}% - 10px)` }
        }
      >
        <div
          className={cn(
            "absolute bg-foreground/80",
            vertical
              ? "top-1/2 right-1 left-1 h-0.5 -translate-y-1/2 rounded-full"
              : "top-1 bottom-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full"
          )}
        />
      </div>
    </div>
  )
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}
