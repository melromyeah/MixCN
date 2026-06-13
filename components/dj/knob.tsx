"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface KnobProps {
  value: number
  min?: number
  max?: number
  defaultValue?: number
  onValueChange: (value: number) => void
  label?: string
  /** CSS size (number = px). Strings allow viewport-responsive clamps. */
  size?: number | string
  /** Draw the indicator arc from the center (for bipolar controls like EQ). */
  bipolar?: boolean
  format?: (value: number) => string
  className?: string
  disabled?: boolean
}

const START_ANGLE = -135
const END_ANGLE = 135

/**
 * Rotary knob styled to match shadcn/ui: muted track, primary indicator
 * arc, ring on focus. Drag vertically (or scroll) to adjust,
 * double-click to reset.
 */
export function Knob({
  value,
  min = 0,
  max = 1,
  defaultValue,
  onValueChange,
  label,
  size = 48,
  bipolar = false,
  format,
  className,
  disabled = false,
}: KnobProps) {
  const norm = (value - min) / (max - min)
  const angle = START_ANGLE + norm * (END_ANGLE - START_ANGLE)
  const dragState = React.useRef<{ startY: number; startValue: number } | null>(null)

  const clamp = React.useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max]
  )

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointer already released (e.g. synthetic events)
    }
    dragState.current = { startY: e.clientY, startValue: value }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    const dy = dragState.current.startY - e.clientY
    const range = max - min
    const fine = e.shiftKey ? 0.25 : 1
    onValueChange(clamp(dragState.current.startValue + (dy / 150) * range * fine))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    dragState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // capture was never established
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return
    const range = max - min
    const step = (e.shiftKey ? 0.005 : 0.02) * range
    onValueChange(clamp(value + (e.deltaY < 0 ? step : -step)))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const range = max - min
    const step = range / 50
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault()
      onValueChange(clamp(value + step))
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault()
      onValueChange(clamp(value - step))
    } else if (e.key === "Home") {
      e.preventDefault()
      onValueChange(min)
    } else if (e.key === "End") {
      e.preventDefault()
      onValueChange(max)
    }
  }

  const reset = () => {
    if (disabled) return
    onValueChange(defaultValue ?? (bipolar ? (min + max) / 2 : min))
  }

  const r = 42
  const c = 50
  const arcStart = bipolar ? 0 : START_ANGLE
  const arc = describeArc(c, c, r, Math.min(arcStart, angle), Math.max(arcStart, angle))
  const track = describeArc(c, c, r, START_ANGLE, END_ANGLE)

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={format?.(value)}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onDoubleClick={reset}
        className={cn(
          "relative touch-none select-none rounded-full outline-none transition-shadow",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          disabled ? "opacity-50" : "cursor-ns-resize"
        )}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 100 100" className="size-full">
          {/* track */}
          <path d={track} fill="none" className="stroke-muted" strokeWidth={7} strokeLinecap="round" />
          {/* value arc */}
          <path d={arc} fill="none" className="stroke-primary" strokeWidth={7} strokeLinecap="round" />
          {/* body */}
          <circle cx={c} cy={c} r={30} className="fill-card stroke-border" strokeWidth={2} />
          {/* pointer */}
          <line
            x1={c}
            y1={c - 13}
            x2={c}
            y2={c - 27}
            className="stroke-foreground"
            strokeWidth={6}
            strokeLinecap="round"
            transform={`rotate(${angle} ${c} ${c})`}
          />
        </svg>
      </div>
      {label && (
        <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase [@media(max-height:780px)]:sr-only">
          {label}
        </span>
      )}
    </div>
  )
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`
}
