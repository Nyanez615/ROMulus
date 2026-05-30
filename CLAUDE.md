# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux today; iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.
Plan file: `/Users/nyanez/.claude/plans/in-the-folder-emulation-minerva-myrient-clever-otter.md`

## Current status
- **Phase 0** complete: scaffold, deps, dark theme, CI, GitHub repo
- **Phase 1** complete: migrations, models, parser, scanner, grouper, executor, watcher, settings
- **Phase 2** next: React frontend — Tauri bindings, Zustand stores, shadcn/ui pages, onboarding wizard

## Dev setup

```bash
# Prerequisites: Rust (rustup), Node 24, Xcode CLT (macOS)
npm install
npm run tauri dev      # Vite HMR + native Tauri window
```

From `src-tauri/`:
```bash
cargo test                    # runs all 55 Rust tests + regenerates src/lib/bindings/
cargo clippy -- -D warnings   # must be clean (same as CI)
```

From project root:
```bash
npx tsc --noEmit       # TypeScript type-check
npm run lint           # ESLint
npm run test:run       # Vitest
```

## Architecture

```
src/                        React frontend (Vite root)
  components/ui/            shadcn/ui components (you own this code — no runtime dep)
  lib/
    bindings/               Auto-generated TypeScript types from Rust structs (cargo test)
    tauri.ts                [Phase 2] Typed invoke() / listen() wrappers
    utils.ts                cn() helper (clsx + tailwind-merge)
  pages/                    [Phase 2] One file per tab
  store/                    [Phase 2] Zustand stores
  hooks/                    [Phase 2] Custom React hooks

src-tauri/
  src/
    lib.rs                  Tauri builder, plugin registration, all command handlers
    models.rs               ALL shared structs — single source of truth for Rust + TS types
    parser.rs               No-Intro filename → RomFile (format-aware, disc-aware)
    deduper.rs              Format-pair detection, mark_format_pairs
    db.rs                   SQLite: AppState, ScanCache, migrations, action log helpers
    watcher.rs              notify-based FS watcher, 200ms debounce
    commands/
      scan.rs               scan_roots, get_scan_status, get_consoles
      group.rs              get_games, group_roms, score_rom, matches_preferred
      execute.rs            execute_prune, get_interrupted_session
      settings.rs           get/save settings, get/complete onboarding
  migrations/               001_initial.sql · 002_metadata.sql · 003_onboarding.sql
  capabilities/default.json Tauri v2 permission declarations
  tauri.conf.json           Bundle ID: com.romulus.app
```

## Key conventions

- **No hardcoded languages or regions** — all preferences flow through `UserPreferences` from DB.
- **Rust structs derive `TS`** — `cargo test` regenerates TypeScript types to `src/lib/bindings/`.
  Never edit `src/lib/bindings/` manually; always edit `src-tauri/src/models.rs` and re-run.
- **Tauri commands, not HTTP** — frontend calls `invoke('command_name', args)`.
- **Background tasks emit Tauri events** — frontend listens via `listen('event:name', cb)`.
  Current events: `scan:progress` (ScanProgress), `watcher:new_rom` (NewRomEvent).
- **Deletions go to Trash by default** — permanent delete is opt-in in Settings → Danger Zone.
- **BIOS files always protected** — `is_bios: true` → never queued for deletion.
- **Multi-disc games kept together** — `disc_number` coalesces into one `RomGroup`.
- **Action log is append-only** — no DELETE path on `action_log` table.
- **Crash recovery** — actions written as `pending` before file touch; updated to
  `deleted/failed` after. `has_pending_actions()` checked on launch.

## Dead code — wired up in Phase 2+

`#![allow(dead_code)]` is set in `lib.rs` during Phase 1. The following functions/types
exist but are not yet called from Tauri commands. They will be wired up as each UI tab
is built in Phase 2 and Phase 3:

| Symbol | File | Wired up in |
|--------|------|-------------|
| `group_roms` | commands/group.rs | Phase 2 — called from `scan_roots` after scan |
| `matches_preferred` | commands/group.rs | Phase 2 — called by `group_roms` |
| `score_rom` | commands/group.rs | Phase 2 — called by `group_roms` |
| `region_score` | commands/group.rs | Phase 2 — called by `score_rom` |
| `default_region_score` | commands/group.rs | Phase 2 |
| `build_group` | commands/group.rs | Phase 2 |
| `detect_format_pairs` | deduper.rs | Phase 2 — Settings → Format Wizard |
| `mark_format_pairs` | deduper.rs | Phase 2 — after scan + grouping |
| `likely_format_pair` | deduper.rs | Phase 2 |
| `derive_group_name` | deduper.rs | Phase 2 |
| `strip_last_paren` | deduper.rs | Phase 2 |
| `start` (watcher) | watcher.rs | Phase 2 — called from `scan_roots` |
| `process_events` | watcher.rs | Phase 2 — internal to watcher thread |
| `region_default_languages` | parser.rs | Phase 2 — called by `matches_preferred` |
| `DeletionPlan` | models.rs | Phase 3 — Prune tab `apply_filters` command |
| `FilterSettings` | models.rs | Phase 3 — Prune tab |
| `ActionLogEntry` / `ActionType` | models.rs | Phase 3 — History tab |
| `FormatPair` | models.rs | Phase 2 — Format Wizard |
| `NewRomEvent` | models.rs | Phase 2 — watcher events |
| `PagedHistory` | models.rs | Phase 3 — History tab |
| `COLLECTION_TAGS` | commands/group.rs | Phase 2 — used in score_rom |
| `DEBOUNCE_MS` | watcher.rs | Phase 2 — used in process_events |

Remove `#![allow(dead_code)]` from `lib.rs` once all Phase 2 + Phase 3 pages are complete.

## Database
SQLite at `~/Library/Application Support/com.romulus.app/romulus.db` (macOS).
Path resolved at runtime via `app.path().app_data_dir()` — never hardcoded.
Migrations run automatically on every launch via `rusqlite_migration`.
Add new migrations as `src-tauri/migrations/NNN_description.sql` and register in `db.rs`.

## TypeScript bindings
Run `cargo test` in `src-tauri/` to regenerate all `src/lib/bindings/*.ts` files.
Commit the updated bindings alongside any `models.rs` changes.
`src-tauri/bindings/` is gitignored (ts-rs default output); canonical path is `src/lib/bindings/`.

## Styling
Dark theme default. CSS variables in `src/App.css`. Toggle via `document.documentElement.classList`.
Theme stored in SQLite `settings` table (key: `"theme"`).
Always use `motion-safe:` prefix for non-essential animations (WCAG).

## Testing
- Rust: `cargo test` in `src-tauri/` — 55 tests, in-memory SQLite only (no mocks, no fixtures)
- Frontend: `npm run test:run` (Vitest) — test files in `src/**/*.test.tsx`
