"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface VuMeterProps {
  analyser: AnalyserNode | null
  className?: string
  segments?: number
}

/**
 * Segmented level meter driven by an AnalyserNode. Green/amber/red zones
 * with a falling peak-hold indicator, updated outside React via rAF.
 */
export function VuMeter({ analyser, className, segments = 20 }: VuMeterProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const levelRef = React.useRef(0)
  const peakRef = React.useRef(0)

  React.useEffect(() => {
    if (!analyser) return
    const data = new Float32Array(analyser.fftSize)
    let raf = 0

    const tick = () => {
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      // Map RMS to 0..1 with a -48dB floor.
      const db = 20 * Math.log10(rms + 1e-8)
      const target = Math.min(1, Math.max(0, (db + 48) / 48))

      // Fast attack, slow release.
      levelRef.current =
        target > levelRef.current
          ? target
          : levelRef.current + (target - levelRef.current) * 0.15
      peakRef.current = Math.max(peakRef.current - 0.005, levelRef.current)

      const el = containerRef.current
      if (el) {
        const lit = Math.round(levelRef.current * segments)
        const peakSeg = Math.round(peakRef.current * segments)
        const children = el.children
        for (let i = 0; i < children.length; i++) {
          const seg = children[i] as HTMLElement
          const idx = segments - 1 - i // top segment first in DOM
          seg.style.opacity = idx < lit || idx === peakSeg - 1 ? "1" : "0.15"
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyser, segments])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("flex w-2 flex-col gap-px overflow-hidden rounded-full", className)}
    >
      {Array.from({ length: segments }, (_, i) => {
        const idx = segments - 1 - i
        const ratio = idx / segments
        return (
          <div
            key={i}
            className={cn(
              "min-h-0 flex-1 rounded-[1px] transition-opacity duration-75",
              // Traffic-light scale: green -> yellow warning -> red limiter.
              ratio > 0.85 ? "bg-destructive" : ratio > 0.65 ? "bg-yellow-400" : "bg-emerald-500"
            )}
            style={{ opacity: 0.15 }}
          />
        )
      })}
    </div>
  )
}
