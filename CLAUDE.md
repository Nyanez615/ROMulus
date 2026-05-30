# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux, iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.

## Dev setup

```bash
# Prerequisites: Rust (rustup), Node 20+, Xcode CLT (macOS)
npm install
npm run tauri dev      # starts Vite HMR + Tauri window
cargo test             # run Rust unit tests
npm run tsc            # type-check frontend
```

## Architecture

```
src/                   React frontend (Vite root)
  components/ui/       shadcn/ui components (copied — you own the code)
  pages/               One file per tab (Dashboard, Games, Prune, etc.)
  store/               Zustand global state
  hooks/               Custom React hooks
  lib/tauri.ts         Typed invoke() / listen() wrappers for all Tauri commands
  lib/utils.ts         cn() helper (clsx + tailwind-merge)

src-tauri/             Rust backend
  src/
    main.rs            Tauri app entry, command registration
    models.rs          Shared structs — all derive Serialize/Deserialize/TS
    parser.rs          No-Intro filename parser
    deduper.rs         Format-pair and duplicate detection
    db.rs              SQLite migrations + queries
    commands/          One module per feature area (scan, group, prune, execute, etc.)
    watcher.rs         notify-based filesystem watcher
  migrations/          Numbered SQL migration files (001_initial.sql, ...)
  Cargo.toml
  tauri.conf.json      Bundle ID: com.romulus.app
```

## Key conventions

- **No hardcoded languages/regions.** Everything goes through `UserPreferences` from the DB.
- **Rust structs derive `TS`** (ts-rs crate) — run `cargo test` to regenerate TypeScript types into `src/lib/bindings/`.
- **Tauri commands replace HTTP.** Frontend calls `invoke('command_name', args)` — no REST API.
- **Background tasks emit Tauri events** — frontend listens with `listen('event:name', handler)`.
- **Deletions go to Trash by default.** Permanent delete is opt-in in Settings → Danger Zone.
- **BIOS files are always protected.** Never queued for deletion regardless of filters.
- **Action log is append-only.** No DELETE path on `action_log` table.

## Database
SQLite at `~/.config/romulus/romulus.db` (platform path via `app.path().app_data_dir()`).
Migrations run on every launch via `rusqlite_migration`. Add new migrations in `src-tauri/migrations/`.

## Styling
Dark theme by default. CSS variables defined in `src/App.css`.
Toggle via `document.documentElement.classList.toggle('light')` — preference stored in SQLite.
Use `motion-safe:` Tailwind prefix for all non-essential animations.

## Testing
- Rust: `cargo test` in `src-tauri/`
- Frontend: `npm run test` (Vitest)
- No mocking of the SQLite DB — use an in-memory DB in Rust tests.
