# ROMulus

> ROM collection management hub — browse, deduplicate, prune, and enrich your entire game library.

![Rust](https://img.shields.io/badge/Rust-1.96-orange?logo=rust)
![Node](https://img.shields.io/badge/Node-24-green?logo=node.js)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)
![License](https://img.shields.io/badge/License-BSL--1.1-lightgrey)

---

## Features

- **Smart pruning** — keep the best ROM per game in your preferred language; configurable region priority
- **Any console** — extensible to Nintendo, Sega, Sony, Atari, and beyond
- **Duplicate resolution** — side-by-side panel for original dumps vs collection re-releases
- **Format pair wizard** — one-click selection between format variants (Headered/Headerless, BigEndian/ByteSwapped)
- **DAT verification** — No-Intro DAT import for ROM integrity checking and collection completeness
- **Rich metadata** — IGDB: release year, genre, description, ratings
- **Cover art** — SteamGridDB thumbnails, locally cached
- **Incremental scanning** — mtime-based cache; filesystem watcher auto-detects new ROMs
- **Full action log** — every decision recorded; backup manifest written before any deletion

## Tech Stack

| Layer | Choice |
|-------|--------|
| App | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Rust (Tauri commands) |
| Database | SQLite |

## Dev Setup

```bash
# Prerequisites: Rust (rustup), Node 20+, Xcode CLT (macOS)
git clone https://github.com/nyanez/ROMulus
cd ROMulus
npm install
npm run tauri dev
```

## IDE

RustRover (recommended) — handles both Rust and TypeScript in one window.

## Note

ROMulus manages files already on your device. It does not download, distribute, or stream ROM files.
See [PRIVACY.md](PRIVACY.md) for details.
