# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux today; iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.
Plan file: `/Users/nyanez/.claude/plans/in-the-folder-emulation-minerva-myrient-clever-otter.md`

## Dev setup

```bash
# Prerequisites: Rust (rustup), Node 24, Xcode CLT (macOS)
npm install
npm run tauri dev      # Vite HMR + Tauri native window
```

From `src-tauri/`:
```bash
cargo test             # Rust unit tests
cargo clippy -- -D warnings
```

From project root:
```bash
npx tsc --noEmit       # TypeScript type-check
```

## Current status
- Phase 0 complete: scaffold, all deps, dark theme, CI, repo
- Phase 1 next: SQL migrations, Rust models, No-Intro parser

## Architecture

```
src/                        React frontend (Vite root)
  components/ui/            shadcn/ui components (you own this code)
  pages/                    One file per tab
  store/                    Zustand stores
  hooks/                    Custom React hooks
  lib/
    tauri.ts                Typed invoke() / listen() wrappers
    utils.ts                cn() helper (clsx + tailwind-merge)

src-tauri/
  src/
    main.rs                 Entry point
    lib.rs                  Tauri builder + plugin registration
    models.rs               Shared structs (all derive Serialize/Deserialize/TS)
    parser.rs               No-Intro filename parser
    deduper.rs              Format-pair and duplicate detection
    db.rs                   SQLite migrations + queries
    watcher.rs              notify-based filesystem watcher
    commands/               One module per feature (scan, group, prune, execute, metadata, dat)
  migrations/               Numbered SQL files: 001_initial.sql, 002_metadata.sql, ...
  capabilities/default.json Tauri v2 permissions
  tauri.conf.json           Bundle ID: com.romulus.app
```

## Key conventions

- **No hardcoded languages or regions** — all preferences flow through `UserPreferences` from DB.
- **Rust structs derive `TS`** — `cargo test` regenerates TypeScript types into `src/lib/bindings/`.
- **Tauri commands, not HTTP** — frontend calls `invoke('command_name', args)`.
- **Background tasks emit Tauri events** — frontend listens via `listen('event:name', cb)`.
- **Deletions go to Trash by default** — permanent delete is opt-in in Settings → Danger Zone.
- **BIOS files are always protected** — never queued for deletion regardless of filters.
- **Multi-disc games are kept together** — delete/keep applies to the full disc set.
- **Action log is append-only** — no DELETE path on the `action_log` SQLite table.

## Database
SQLite at platform app-data dir via `app.path().app_data_dir()`.
Migrations run on every launch via `rusqlite_migration`.
Add new migrations as `src-tauri/migrations/NNN_description.sql`.

## Styling
Dark theme default. CSS variables in `src/App.css`. Toggle via `document.documentElement.classList`.
Theme stored in SQLite `settings` table.
Always use `motion-safe:` prefix for non-essential animations.

## Testing
- Rust: `cargo test` in `src-tauri/` — use in-memory SQLite, never mock the DB
- Frontend: `npm test` (Vitest)
