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
- **Format pair wizard** — whole-folder selection between format variants (NES Headered/Headerless, N64 BigEndian/ByteSwapped, etc.)
- **Duplicate resolution** — side-by-side panel for choosing between original dumps and collection re-releases
- **Incremental scanning** — mtime-based cache; filesystem watcher auto-detects new ROMs without rescanning

### Enrichment & verification
- **IGDB metadata** — release year, genre, summary, ratings via background enrichment (requires free Twitch API key)
- **SteamGridDB cover art** — locally cached thumbnails shown when expanding game rows
- **No-Intro DAT verification** — import DAT files for CRC32 integrity checking and collection completeness tracking

### Safety & logging
- **Trash by default** — files moved to OS Trash, not permanently deleted
- **Pre-prune backup manifest** — plain-text file list written to Desktop before every execution
- **Atomic crash recovery** — SQLite `pending → deleted/failed` transaction; interrupted sessions detected on next launch
- **Full action log** — every decision recorded, paginated History tab, CSV export

### 8 tabs
Dashboard · ROMs · Hacks & Unofficial · System Files · Duplicates · Prune · History · Settings

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
cargo test             # 86 unit tests + regenerates TypeScript bindings
cargo clippy -- -D warnings
```

From project root:
```bash
npm run test:run       # 115 Vitest tests
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
