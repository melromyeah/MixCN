# 🎧 MixCN

# Preview
(https://mix-cn-kappa.vercel.app)

A fully client-side **DJ console that runs entirely in your browser** — dual decks, a real mixer, vinyl-accurate scratching, a sophisticated beat-grid analyzer, bar-fraction looping, and one-click mix recording. No backend, no uploads: every track you drop in is decoded and processed locally with the Web Audio API and never leaves your machine.

Built with **Next.js + React + TypeScript + Tailwind**, styled with the default **shadcn/ui** theme, and rounded out with a set of hand-built audio-UI components (knobs, faders, jog wheels, VU meters) drawn to match that aesthetic where shadcn has no equivalent.

---

## ✨ Features

### Decks
- **Two independent decks (A / B)** with their own transport, pitch, EQ, loops and hot cues.
- **Vinyl-style jog wheel** powered by a custom `AudioWorklet`: grabbing the platter takes over playback completely — drag forward/back to **scratch** (the audio plays in reverse on backward motion), hold the record still for silence, and release to ramp smoothly back up to speed. Works whether the deck is playing or paused.
- **Canvas waveform overview** with played/unplayed coloring, the live playhead, the loop region, the cue point, and hot-cue markers. Click or drag anywhere on it to seek.
- **CDJ-style transport** — play/pause plus a proper **CUE** button (set cue point when paused, jump-back-and-pause when playing).
- **Pitch fader (±8%)** with a soft center detent that snaps cleanly to 0%.

### Sophisticated beat detection & sync
- On load, each track is run through a **multi-stage beat-grid analyzer** (`lib/dj/beatgrid.ts`):
  - loudest-window selection → mono downmix
  - multi-band (low/mid/high) onset-envelope extraction
  - **harmonic-scored autocorrelation** with a tempo prior to avoid half/double-tempo errors
  - **comb-filter fine search** that refines BPM to ~0.01 resolution and locks the beat phase
  - **downbeat detection** from low-band energy to find where each bar starts
- The result is a full **beat grid** (precise BPM + beat phase + downbeat), not just a BPM guess.
- **SYNC** matches the other deck's exact tempo *and* **phase-aligns the bars**: both decks are sampled against a shared audio-thread clock (worklet frame stamps) and nudged onto the same position within the bar — accurate to a couple of milliseconds.

### Looping
- **Bar-fraction loops** — ⅛, ¼, ½, 1, 2 and 4 bars.
- With a beat grid present, loops **snap onto the grid line** of their own subdivision, so they always land musically in place. Toggle a size again or hit **Exit** to drop the loop.

### Mixer
- Per-channel **trim**, **3-band EQ** (low / mid / high) with full **kill**, and a sweepable **LP/HP filter** knob.
- **Channel volume faders** with live **VU meters**.
- **Equal-power crossfader** with a center snap.
- **Vertical master fader sitting between the two channels**, flanked by a true **stereo (L/R) master VU**.
- **4 hot cues per deck** — click to set/jump, right-click to clear.

### The extras
- **Bass-reactive console glow** — an *inaudible* branch low-passes the master to mono and dead-ends it (it never reaches your speakers); its energy drives a single CSS variable that makes every panel's outline pulse with the low end.
- **Mix recording** — capture the master output via `MediaRecorder` and download the result (`.webm` / `.m4a`).
- **Mirror-symmetric, full-viewport layout** that adapts to any screen size, in the default shadcn dark theme.

### Track library
- **Drag-and-drop** audio files anywhere onto the library card, or use **Add files**.
- Supports **MP3, WAV, OGG, M4A, FLAC, AAC**.
- Everything is decoded and analyzed **locally** — nothing is uploaded.
- Parses `Artist - Title` filenames, shows detected BPM and length, and loads any track to deck **A** or **B** with one click.

---

## 🛠️ Tech stack

| Area | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Language | TypeScript, React 19 |
| Styling | Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (default theme) |
| Icons | [lucide-react](https://lucide.dev) |
| Toasts | [sonner](https://sonner.emilkowal.ski) |
| Audio | Web Audio API · `AudioWorklet` · `OfflineAudioContext` · `MediaRecorder` |
| Fonts | Manrope (UI) · JetBrains Mono (readouts) |
| Tooling | [Bun](https://bun.sh) |

---

## 🚀 Getting started

### Prerequisites
- [**Bun**](https://bun.sh) (recommended). Any recent version works; the project was built with Bun 1.3+.
- A **Chromium-based or modern browser** — the app relies on `AudioWorklet` and `MediaRecorder`.

> Prefer npm/pnpm/yarn? They work too — just swap `bun` for your package manager in the commands below.

### Install

```bash
bun i
```

### Run in development

```bash
bun dev
```

Then open **http://localhost:3000**.

### Production build

```bash
bun run build   # compile an optimized build
bun run start   # serve the production build
```

### Lint

```bash
bun run lint
```

---

## 🎚️ How to use it

1. **Add tracks** — drag audio files onto the **Library** card at the bottom (or click **Add files**). Each track is decoded and beat-analyzed on the spot; you'll see its BPM appear once the grid is locked.
2. **Load the decks** — click **A** or **B** next to a track to load it onto that deck.
3. **Play** — hit the play button, set/recall the cue point with **CUE**, or scrub the waveform.
4. **Beatmatch** — press **SYNC** on a deck to match the other deck's tempo and align the bars. Fine-tune by hand with the pitch fader if you like.
5. **Loop** — pick a bar fraction (⅛ → 4). It snaps to the grid; press the same size again or **Exit** to release.
6. **Scratch** — grab the jog wheel and move it. Forward/back drags scratch the audio; let go and it spins back up.
7. **Mix** — ride the channel faders, EQ, filter, and crossfader. Watch the VU meters and the panel glow track the bass.
8. **Record** — click **Record mix** in the header to capture the master output; click again to stop and download your mix.

### Handy interactions
- **Knobs:** drag vertically to adjust, hold **Shift** for fine control, **double-click** to reset, scroll to nudge.
- **Faders:** drag, **Shift**-drag for fine, **double-click** to reset, arrow keys to step.
- **Hot cues:** left-click to set/jump, **right-click** to clear.

---

## 🧱 Project structure

```
app/                      # Next.js App Router entry, layout, global styles
components/
  dj/                     # The console: decks, mixer, library, and custom audio UI
    deck.tsx              #   a single deck (transport, pitch, hot cues, loops)
    mixer.tsx             #   channel strips, master, crossfader
    track-library.tsx     #   drag-and-drop library + analysis
    dj-station.tsx        #   top-level layout + record button + glow driver
    knob.tsx · fader.tsx  #   hand-built controls matching the shadcn look
    jog-wheel.tsx         #   the scratchable vinyl platter
    waveform.tsx          #   canvas waveform overview
    vu-meter.tsx          #   segmented green/yellow/red level meters
  ui/                     # shadcn/ui primitives
lib/
  dj/
    audio-engine.ts       # master graph, stereo + glow taps, recording
    deck-engine.ts        # per-deck graph, transport, sync, loops, scratch
    vinyl-worklet.ts      # AudioWorklet: signed-rate (scratchable) playback
    beatgrid.ts           # the BPM / beat-phase / downbeat analyzer
    peaks.ts · format.ts · types.ts
hooks/                    # small React helpers (rAF, deck subscriptions)
```

### How the audio is wired

Each deck plays through a **vinyl AudioWorklet** (so playback can run at an arbitrary *signed* rate for scratching) into a chain of **trim → 3-band EQ → filter → channel fader → crossfader gain**, then into the shared **master**. The master fans out to: the speakers, a `MediaStream` tap for recording, a channel splitter feeding the **stereo VU**, and a silent low-passed tap feeding the **console glow**. The worklet is the source of truth for each deck's playhead and stamps it on the audio-thread clock, which is what makes sample-accurate bar sync possible.

---

## 🔒 Privacy

Everything runs in the browser. Audio files you load are decoded and analyzed **on your device only** — there is no server component and nothing is ever uploaded.

---

## 📋 Browser support

Requires a modern browser with **Web Audio API**, **`AudioWorklet`**, and **`MediaRecorder`** support (recent Chrome, Edge, Firefox, or Safari). Audio playback starts after your first interaction with the page, per browser autoplay policies.

---

## 📄 License

Apache 2.0.
