export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.0"
  const sign = seconds < 0 ? "-" : ""
  const abs = Math.abs(seconds)
  const m = Math.floor(abs / 60)
  const s = Math.floor(abs % 60)
  const tenths = Math.floor((abs * 10) % 10)
  return `${sign}${m}:${s.toString().padStart(2, "0")}.${tenths}`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function formatBpm(bpm: number | null): string {
  return bpm === null ? "—" : bpm.toFixed(1)
}

export function formatPitch(percent: number): string {
  const sign = percent > 0 ? "+" : percent < 0 ? "-" : "±"
  return `${sign}${Math.abs(percent).toFixed(1)}%`
}
