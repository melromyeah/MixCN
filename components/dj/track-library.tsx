"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, FolderOpen, Loader2, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDeckVersion } from "@/hooks/use-deck-state"
import type { AudioEngine } from "@/lib/dj/audio-engine"
import type { AutoDj } from "@/lib/dj/auto-dj"
import { computeAutoGain } from "@/lib/dj/autogain"
import { analyzeBeatGrid } from "@/lib/dj/beatgrid"
import { detectKey, keysCompatible } from "@/lib/dj/key"
import { deleteStoredTrack, loadStoredTracks, saveStoredTrack } from "@/lib/dj/library-db"
//import { createDemoTracks } from "@/lib/dj/demo-tracks"
import { formatBpm, formatDuration } from "@/lib/dj/format"
import { computePeaks } from "@/lib/dj/peaks"
import type { BeatGrid, DeckId, KeyInfo, Track } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

interface TrackLibraryProps {
  engine: AudioEngine
  autoDj?: AutoDj | null
  onTracksChanged?: () => void
  className?: string
}

/** Library row: everything except the decoded audio (decoded on demand). */
interface LibraryRow {
  id: string
  title: string
  artist: string
  duration: number
  bpm: number | null
  grid: BeatGrid | null
  key: KeyInfo | null
  gain: number
  peaks: Float32Array
  bytes: ArrayBuffer
  addedAt: number
}

type SortKey = "added" | "title" | "artist" | "bpm" | "key" | "duration"

// Monotonic insertion stamp (module scope keeps render pure).
let addedSeq = Date.now()

function SortHeader({
  label,
  k,
  sortKey,
  sortAsc,
  onToggle,
  className,
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortAsc: boolean
  onToggle: (k: SortKey) => void
  className?: string
}) {
  return (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onToggle(k)}
      >
        {label}
        {sortKey === k &&
          (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  )
}

export function TrackLibrary({ engine, autoDj, onTracksChanged, className }: TrackLibraryProps) {
  const [rows, setRows] = React.useState<LibraryRow[]>([])
  const [busy, setBusy] = React.useState(false)
  const [restoring, setRestoring] = React.useState(true)
  const [dragOver, setDragOver] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [sortKey, setSortKey] = React.useState<SortKey>("added")
  const [sortAsc, setSortAsc] = React.useState(true)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const decodedRef = React.useRef(new Map<string, Track>())

  // Key-compatibility highlighting follows whatever is loaded on the decks.
  useDeckVersion(engine.decks.A)
  useDeckVersion(engine.decks.B)

  // Restore the persisted library (metadata only; audio decodes on demand).
  React.useEffect(() => {
    let cancelled = false
    loadStoredTracks().then((stored) => {
      if (cancelled) return
      setRows(
        stored.map((s) => ({
          ...s,
          peaks: new Float32Array(s.peaks),
        }))
      )
      setRestoring(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const addFiles = async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i.test(f.name)
    )
    if (audioFiles.length === 0) {
      toast.error("No audio files found", {
        description: "Drop MP3, WAV, OGG, M4A, FLAC or AAC files.",
      })
      return
    }
    setBusy(true)
    await engine.resume()
    for (const file of audioFiles) {
      try {
        // Keep the original bytes: decodeAudioData detaches what you pass it.
        const bytes = await file.arrayBuffer()
        const buffer = await engine.ctx.decodeAudioData(bytes.slice(0))
        const name = file.name.replace(/\.[^.]+$/, "")
        // "Artist - Title" convention, otherwise filename as title.
        const dashIdx = name.indexOf(" - ")
        const artist = dashIdx > 0 ? name.slice(0, dashIdx) : "Unknown artist"
        const title = dashIdx > 0 ? name.slice(dashIdx + 3) : name
        const [grid, key] = await Promise.all([analyzeBeatGrid(buffer), detectKey(buffer)])
        const gain = computeAutoGain(buffer)
        const peaks = computePeaks(buffer)
        const row: LibraryRow = {
          id: `${file.name}-${file.size}-${crypto.randomUUID().slice(0, 8)}`,
          title,
          artist,
          duration: buffer.duration,
          bpm: grid?.bpm ?? null,
          grid,
          key,
          gain,
          peaks,
          bytes,
          addedAt: addedSeq++,
        }
        decodedRef.current.set(row.id, {
          id: row.id,
          title,
          artist,
          duration: buffer.duration,
          bpm: row.bpm,
          grid,
          key,
          gain,
          buffer,
          peaks,
        })
        setRows((prev) => [...prev, row])
        const persisted = await saveStoredTrack({
          id: row.id,
          title,
          artist,
          duration: row.duration,
          bpm: row.bpm,
          grid,
          key,
          gain,
          peaks: peaks.slice().buffer,
          bytes,
          addedAt: row.addedAt,
        })
        toast.success(`Added "${title}"`, {
          description: [
            grid ? `${formatBpm(grid.bpm)} BPM · grid locked` : "BPM not detected",
            key ? `${key.camelot} ${key.name}` : null,
            persisted ? null : "not persisted (storage unavailable)",
          ]
            .filter(Boolean)
            .join(" · "),
        })
      } catch {
        toast.error(`Couldn't decode "${file.name}"`)
      }
    }
    setBusy(false)
  }
  /* Demo tracks disabled!
  const addDemos = async () => {
    setBusy(true)
    try {
      const demos = await createDemoTracks()
      setTracks((prev) => [...prev, ...demos.filter((d) => !prev.some((t) => t.id === d.id))])
      toast.success("Demo tracks generated", {
        description: "Two synthesized loops, ready to mix.",
      })
    } finally {
      setBusy(false)
    }
  }
*/
  const materialize = React.useCallback(
    async (row: LibraryRow): Promise<Track> => {
      const cached = decodedRef.current.get(row.id)
      if (cached) return cached
      const buffer = await engine.ctx.decodeAudioData(row.bytes.slice(0))
      const track: Track = {
        id: row.id,
        title: row.title,
        artist: row.artist,
        duration: row.duration,
        bpm: row.bpm,
        grid: row.grid,
        key: row.key,
        gain: row.gain,
        buffer,
        peaks: row.peaks,
      }
      decodedRef.current.set(row.id, track)
      return track
    },
    [engine]
  )

  // Feed Auto-DJ: cycle through the library in order, skipping whatever
  // is already loaded on a deck when there's enough material to do so.
  const rowsRef = React.useRef<LibraryRow[]>([])
  React.useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  const lastAutoId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!autoDj) return
    autoDj.provider = async () => {
      const list = rowsRef.current
      if (list.length === 0) return null
      const loaded = [engine.decks.A.track?.id, engine.decks.B.track?.id].filter(Boolean)
      const startIdx = lastAutoId.current
        ? list.findIndex((r) => r.id === lastAutoId.current)
        : -1
      for (let k = 1; k <= list.length; k++) {
        const row = list[(startIdx + k + list.length) % list.length]
        if (loaded.includes(row.id) && list.length > loaded.length) continue
        lastAutoId.current = row.id
        try {
          return await materialize(row)
        } catch {
          continue
        }
      }
      return null
    }
    return () => {
      autoDj.provider = null
    }
  }, [autoDj, engine, materialize])

  const loadToDeck = async (row: LibraryRow, deckId: DeckId) => {
    try {
      await engine.resume()
      const track = await materialize(row)
      engine.decks[deckId].loadTrack(track)
      onTracksChanged?.()
      toast(`"${row.title}" loaded to deck ${deckId}`)
    } catch {
      toast.error(`Couldn't decode "${row.title}"`)
    }
  }

  const removeRow = (row: LibraryRow) => {
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    decodedRef.current.delete(row.id)
    void deleteStoredTrack(row.id)
    toast(`Removed "${row.title}" from the library`)
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const visibleRows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows
    if (q) {
      list = list.filter(
        (r) => r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q)
      )
    }
    const dir = sortAsc ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return a.title.localeCompare(b.title) * dir
        case "artist":
          return a.artist.localeCompare(b.artist) * dir
        case "bpm":
          return ((a.bpm ?? 0) - (b.bpm ?? 0)) * dir
        case "duration":
          return (a.duration - b.duration) * dir
        case "key":
          return (a.key?.camelot ?? "").localeCompare(b.key?.camelot ?? "") * dir
        default:
          return (a.addedAt - b.addedAt) * dir
      }
    })
  }, [rows, query, sortKey, sortAsc])

  const deckKeys = [engine.decks.A.track?.key ?? null, engine.decks.B.track?.key ?? null]
  const isCompatible = (key: KeyInfo | null) =>
    deckKeys.some((dk) => keysCompatible(key, dk))

  const sortProps = { sortKey, sortAsc, onToggle: toggleSort }

  return (
    <Card
      className={cn("h-full gap-2 py-3", dragOver && "ring-2 ring-ring/50", className)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 px-4">
        <CardTitle className="flex shrink-0 items-center gap-2 text-sm">
          Library
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <div className="relative max-w-64 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or artist…"
            className="h-8 pl-8"
          />
        </div>
        <div className="flex shrink-0 gap-2">
{/*} Demo tracks button disabled!
          <Button variant="outline" size="sm" onClick={addDemos} disabled={busy}>
            <Sparkles /> Demo tracks
          </Button>
*/}
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
            Add files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ""
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-4">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed py-6 text-center">
            <p className="text-sm font-medium">
              {restoring ? "Restoring your library…" : "Drop audio files anywhere on this card"}
            </p>
            <p className="text-xs text-muted-foreground">
              Everything stays on your machine — nothing is uploaded. Tracks and their analysis
              are saved locally and survive reloads.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-48 lg:h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <SortHeader label="Title" k="title" {...sortProps} />
                  <SortHeader label="Artist" k="artist" {...sortProps} />
                  <SortHeader label="Key" k="key" className="text-right" {...sortProps} />
                  <SortHeader label="BPM" k="bpm" className="text-right" {...sortProps} />
                  <SortHeader label="Length" k="duration" className="text-right" {...sortProps} />
                  <TableHead className="w-32 text-right">Load</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-48 truncate font-medium">{row.title}</TableCell>
                    <TableCell className="max-w-36 truncate text-muted-foreground">
                      {row.artist}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        isCompatible(row.key)
                          ? "font-semibold text-emerald-500"
                          : "text-muted-foreground"
                      )}
                      title={
                        row.key
                          ? isCompatible(row.key)
                            ? `${row.key.name} — harmonically compatible with a loaded deck`
                            : row.key.name
                          : undefined
                      }
                    >
                      {row.key?.camelot ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBpm(row.bpm)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatDuration(row.duration)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 font-mono"
                          onClick={() => loadToDeck(row, "A")}
                        >
                          A
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 font-mono"
                          onClick={() => loadToDeck(row, "B")}
                        >
                          B
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row)}
                          title="Remove from library"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
