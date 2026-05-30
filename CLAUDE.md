# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux today; iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.
Plan file: `/Users/nyanez/.claude/plans/in-the-folder-emulation-minerva-myrient-clever-otter.md`

## Current status
- **Phase 0** ✅ Scaffold, all deps, dark gaming theme, GitHub Actions CI, public repo
- **Phase 1** ✅ SQL migrations, 60 data models + TS bindings, No-Intro parser (19 tests), scanner, grouper, executor, watcher, format-pair detection
- **Phase 2** ✅ Tauri bindings layer, 4 Zustand stores, shadcn/ui components, Layout+Sidebar, 4-step onboarding wizard, Settings page
- **Phase 3** ✅ All 8 feature pages (Dashboard, Consoles, Games, Hacks, System Files, Duplicates, Prune, History) + Rust browse/prune/history commands
- **Phase 4** ✅ IGDB metadata (OAuth2, Keychain, background enrichment), SteamGridDB thumbnails (asset:// protocol), OS notifications, No-Intro DAT import + CRC32 verification + completeness tracking
- **Phase 5** ▶️ next: console icons, keyboard shortcuts, accessibility, auto-updater + release pipeline

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

## Dead code status

**All dead code is now wired.** The `#![allow(dead_code)]` in `lib.rs` is a safety net
during active development. All symbols from Phases 1–3 are connected.

Remove `#![allow(dead_code)]` from `lib.rs` before the first public release (after Phase 5 polish).

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
