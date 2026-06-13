"use client"

import * as React from "react"
import { FolderOpen, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AudioEngine } from "@/lib/dj/audio-engine"
import { analyzeBeatGrid } from "@/lib/dj/beatgrid"
//import { createDemoTracks } from "@/lib/dj/demo-tracks"
import { formatBpm, formatDuration } from "@/lib/dj/format"
import { computePeaks } from "@/lib/dj/peaks"
import type { DeckId, Track } from "@/lib/dj/types"
import { cn } from "@/lib/utils"

interface TrackLibraryProps {
  engine: AudioEngine
  onTracksChanged?: () => void
  className?: string
}

export function TrackLibrary({ engine, onTracksChanged, className }: TrackLibraryProps) {
  const [tracks, setTracks] = React.useState<Track[]>([])
  const [busy, setBusy] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

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
        const arrayBuffer = await file.arrayBuffer()
        const buffer = await engine.ctx.decodeAudioData(arrayBuffer)
        const name = file.name.replace(/\.[^.]+$/, "")
        // "Artist - Title" convention, otherwise filename as title.
        const dashIdx = name.indexOf(" - ")
        const artist = dashIdx > 0 ? name.slice(0, dashIdx) : "Unknown artist"
        const title = dashIdx > 0 ? name.slice(dashIdx + 3) : name
        const grid = await analyzeBeatGrid(buffer)
        const track: Track = {
          id: `${file.name}-${file.size}-${crypto.randomUUID().slice(0, 8)}`,
          title,
          artist,
          duration: buffer.duration,
          bpm: grid?.bpm ?? null,
          grid,
          buffer,
          peaks: computePeaks(buffer),
        }
        setTracks((prev) => [...prev, track])
        toast.success(`Added "${title}"`, {
          description: grid
            ? `${formatBpm(grid.bpm)} BPM · beat grid locked`
            : "BPM could not be detected",
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
  const loadToDeck = async (track: Track, deckId: DeckId) => {
    await engine.resume()
    engine.decks[deckId].loadTrack(track)
    onTracksChanged?.()
    toast(`"${track.title}" loaded to deck ${deckId}`)
  }

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
      <CardHeader className="flex shrink-0 flex-row items-center justify-between px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          Library
          <Badge variant="secondary">{tracks.length}</Badge>
        </CardTitle>
        <div className="flex gap-2">
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
        {tracks.length === 0 ? (
          <div className="flex h-full min-h-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed py-6 text-center">
            <p className="text-sm font-medium">Drop audio files anywhere on this card</p>
            <p className="text-xs text-muted-foreground">
              Everything stays on your machine — nothing is uploaded. Or generate demo tracks to
              try the decks.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-48 lg:h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Artist</TableHead>
                  <TableHead className="text-right">BPM</TableHead>
                  <TableHead className="text-right">Length</TableHead>
                  <TableHead className="w-28 text-right">Load</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracks.map((track) => (
                  <TableRow key={track.id}>
                    <TableCell className="max-w-48 truncate font-medium">{track.title}</TableCell>
                    <TableCell className="max-w-36 truncate text-muted-foreground">
                      {track.artist}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBpm(track.bpm)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatDuration(track.duration)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 font-mono"
                          onClick={() => loadToDeck(track, "A")}
                        >
                          A
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 font-mono"
                          onClick={() => loadToDeck(track, "B")}
                        >
                          B
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
