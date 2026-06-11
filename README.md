# ROMulus

> ROM collection management hub — browse, deduplicate, prune, and enrich your entire game library.

![Rust](https://img.shields.io/badge/Rust-1.96-orange?logo=rust)
![Node](https://img.shields.io/badge/Node-24-green?logo=node.js)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)
![License](https://img.shields.io/badge/License-BSL--1.1-lightgrey)
![CI](https://github.com/Nyanez615/ROMulus/actions/workflows/ci.yml/badge.svg)

---

## Features

### Collection management
- **Smart pruning** — keep the best ROM per game in your preferred language; configurable region priority order
- **Language-first** — fully configurable preferred languages and regions; nothing is hardcoded
- **Any console, any manufacturer** — No-Intro naming convention with auto-detection for Nintendo, Sega, Sony, Atari, and beyond
- **Format variant preferences** — per-pair preferred folder setting (NES Headered/Headerless, N64 BigEndian/ByteSwapped, FDS/QD, etc.); preference wired into pruner so the right format wins the ★
- **Faceted chip filtering** — selecting a Region chip hides Category/Status chips that would produce zero results; no dead-end filter combinations
- **Incremental scanning** — mtime-based cache; filesystem watcher auto-detects new ROMs without rescanning

### Browse
- **Unified ROMs tab** — all games, hacks, unofficial releases, and utilities in one view with colour-coded category badges
- **System Files tab** — BIOS, Video, e-Reader, and Accessories (amiibo NFC dumps) separate from regular ROMs
- **Alphabet scrubber** — A–Z strip for instant jump-to-letter navigation when sorted by name
- **Variant count scrubber** — numeric strip for jump-to-count navigation when sorted by variants
- **Console badge in All-ROMs mode** — short console abbreviation (N64, GBA, …) on each row so same-title entries from different consoles are distinguishable

### Downloads
- **qBittorrent integration** — connect to a local qBittorrent Web UI instance; preview which files in a torrent are worth downloading based on your language/region preferences; apply priority rules (download/skip) with one click, then auto-rescan your collection
- **Pre-download filter** — same scoring pipeline as the live pruner applied to DAT entries before any files land on disk; export as `.txt` include-filter or `.csv`

### Enrichment & verification
- **IGDB metadata** — release year, genre, summary, ratings via background enrichment (requires free Twitch API key)
- **SteamGridDB cover art** — locally cached thumbnails shown when expanding game rows
- **No-Intro DAT verification** — import DAT files for CRC32 integrity checking and collection completeness tracking
- **DAT pre-download filter** — generate a scored download list from any imported DAT using your real language/region preferences; export as `.txt` (torrent include-filter) or `.csv`

### Safety & logging
- **Permanent deletion with manifest** — every prune session writes a plain-text backup manifest to `app_data_dir/manifests/` before any files are removed
- **Atomic crash recovery** — SQLite `pending → deleted/failed` transaction; interrupted sessions detected on next launch with a resume banner in Dashboard
- **Full action log** — every decision recorded, paginated History tab, CSV export
- **Cloud path blocking** — OneDrive, iCloud, Dropbox, Google Drive, and Box roots are blocked at add-time to prevent sync conflicts
- **Right-click context menu** — "Show in Folder" and "Copy Path" on every file row in all tabs

### 6 tabs
Dashboard · ROMs · System Files · Downloads · History · Settings

## Tech Stack

| Layer | Choice |
|-------|--------|
| App shell | Tauri v2 (Mac / Win / Linux; iOS & Android in V2) |
| Frontend | React 19 + TypeScript + Vite |
| UI | shadcn/ui (Radix UI + Tailwind CSS) |
| State | TanStack Query v5 + Zustand v5 |
| Backend | Rust (Tauri commands — no sidecar, no HTTP server) |
| Database | SQLite via rusqlite + rusqlite_migration |

## Dev Setup

```bash
# Prerequisites: Rust (rustup), Node 24, Xcode CLT (macOS)
git clone https://github.com/Nyanez615/ROMulus
cd ROMulus
npm install
npm run tauri dev      # opens native window with Vite HMR
```

From `src-tauri/`:
```bash
cargo test             # 231 unit tests + regenerates TypeScript bindings
cargo clippy -- -D warnings
```

From project root:
```bash
npm run test:run       # 134 Vitest tests
npx tsc --noEmit       # TypeScript type-check
```

## IDE

**RustRover** (recommended) — full Rust + TypeScript support in one window.

## Commercial roadmap

- **V1** (current): local Mac app, personal use
- **V2**: cloud sync of metadata + preferences (never ROM content), Supabase auth
- **V3**: iOS + Android companion app via Tauri v2

## Important

ROMulus manages files already on your device. It does not download, distribute, or stream ROM files.
Users are responsible for ensuring they have the right to manage the files in their collection.
See [PRIVACY.md](PRIVACY.md) for details.
