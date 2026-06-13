"use client"

import * as React from "react"

import type { DeckEngine } from "@/lib/dj/deck-engine"

/** Re-renders the consumer whenever the deck emits a state change. */
export function useDeckVersion(deck: DeckEngine): number {
  return React.useSyncExternalStore(
    deck.subscribe,
    () => deck.version,
    () => 0
  )
}

/** Runs a callback every animation frame (for time displays, meters). */
export function useRaf(callback: () => void) {
  const cbRef = React.useRef(callback)
  React.useEffect(() => {
    cbRef.current = callback
  })
  React.useEffect(() => {
    let raf = 0
    const tick = () => {
      cbRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
