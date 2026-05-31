# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux today; iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.
Plan file: `/Users/nyanez/.claude/plans/in-the-folder-emulation-minerva-myrient-clever-otter.md`

## Current status
- **Phase 0** ✅ Scaffold, all deps, dark gaming theme, GitHub Actions CI, public repo
- **Phase 1** ✅ SQL migrations, 60 Rust models + TS bindings, No-Intro parser (19 tests), scanner, grouper, executor, watcher
- **Phase 2** ✅ Tauri bindings layer (`src/lib/tauri.ts`), 4 Zustand stores, shadcn/ui, Layout + Sidebar, onboarding wizard, Settings page
- **Phase 3** ✅ All 9 tabs (Dashboard, Consoles, Games, Hacks, System Files, Duplicates, Prune, History, Settings) + all browse/prune/history Rust commands
- **Phase 4** ✅ IGDB metadata enrichment (OAuth2, Keychain, background + on-demand + bulk), SteamGridDB thumbnails (asset:// cache), OS notifications, No-Intro DAT import + CRC32 verification + completeness tracking
- **Phase 5** ✅ Console SVG icons, keyboard shortcuts, WCAG accessibility, auto-updater + release pipeline, `v0.1.0` published

## Dev setup

```bash
# Prerequisites: Rust (rustup), Node 24, Xcode CLT (macOS)
npm install
npm run tauri dev      # Vite HMR + native Tauri window
```

From `src-tauri/`:
```bash
cargo test                    # 60 unit tests + regenerates src/lib/bindings/
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
src/                             React frontend (Vite root)
  components/
    ui/                          shadcn/ui copied components (you own this code)
    ConsoleIcon.tsx              Manufacturer/console icon + accent color
    TagBadge.tsx / TagList.tsx   Region/language/status chips
    DiscBadge.tsx                Multi-disc count badge
    ErrorBoundary.tsx            Per-page React error boundary
    Layout.tsx                   Root layout: sidebar + content + event subscriptions
    Sidebar.tsx                  Nav tabs, console list, scan status footer
  lib/
    bindings/                    Auto-generated TS types from Rust structs (never edit)
    tauri.ts                     All invoke()/listen() wrappers with browser-safe defaults
    env.ts                       isTauri() helper
    utils.ts                     cn() helper
  pages/                         One component per tab (Dashboard.tsx … Settings.tsx)
  store/                         scan.ts · preferences.ts · onboarding.ts · ui.ts
  onboarding/                    4-step wizard (Terms → Prefs → Roots → Scan)

src-tauri/
  src/
    lib.rs                       Tauri builder, plugin init, all command registrations
    models.rs                    ALL shared types — edit here, run `cargo test` for TS output
    parser.rs                    No-Intro filename → RomFile (format/disc/BIOS aware)
    deduper.rs                   Format-pair detection, mark_format_pairs
    db.rs                        AppState (Arc<Mutex<>> for db+scan_cache), migrations, helpers
    watcher.rs                   notify-based FS watcher, 200ms debounce, kept in AppState
    commands/
      scan.rs          scan_roots, get_scan_status, get_consoles, get_format_pairs
      group.rs         get_games, get_unofficial, get_system_files, get_duplicates
      prune.rs         apply_filters, export_csv
      execute.rs       execute_prune (atomic + backup manifest), get_interrupted_session
      history.rs       get_history
      settings.rs      get/save settings, get/complete onboarding
      metadata.rs      IGDB: set/has/clear_igdb_credentials, get_game_metadata, enrich_all_games
      thumbnail.rs     SteamGridDB: set/has/clear_steamgriddb_key, get_thumbnail
      dat.rs           import_dat, get_dat_files, remove_dat, verify_roms,
                       get_verification_status, get_completeness
  migrations/          001_initial.sql · 002_metadata.sql · 003_onboarding.sql
  capabilities/        Tauri v2 permissions (fs, shell, dialog, notification, shortcuts)
  tauri.conf.json      Bundle ID: com.romulus.app · assetProtocol enabled
  Cargo.toml           All crates incl. rusqlite, notify, keyring, reqwest, quick-xml, zip
```

## Key conventions

- **No hardcoded languages or regions** — flows through `UserPreferences` from DB.
- **Rust structs derive `TS`** — `cargo test` regenerates `src/lib/bindings/*.ts`. Commit alongside `models.rs` changes.
- **Tauri commands, not HTTP** — frontend calls `invoke('command_name', args)` via wrappers in `tauri.ts`. All wrappers return safe defaults in browser preview.
- **Background tasks use Arc cloning** — `Arc::clone(&state.db)` and `Arc::clone(&state.scan_cache)` before `tauri::async_runtime::spawn`.
- **Background tasks emit Tauri events** — frontend subscribes via `listen()`. Events: `scan:progress`, `watcher:new_rom`, `enrich:progress`, `enrich:complete`, `verify:complete`.
- **Deletions go to Trash by default** — permanent delete opt-in in Settings → Danger Zone. Pre-prune backup manifest auto-written to Desktop before any execution.
- **BIOS files always protected** — `is_bios: true` → never queued for deletion.
- **Multi-disc games kept together** — `disc_number` coalesces into one `RomGroup`; delete/keep applies to full disc set.
- **Action log is append-only** — no DELETE path on `action_log` table. Pending → deleted/failed via atomic SQLite transaction.
- **Crash recovery** — `has_pending_actions()` checked on launch; banner shown in Dashboard.
- **`isTauri()`** — all Tauri API calls guarded so the Vite browser preview works without errors.
- **Watcher must stay alive** — stored in `AppState.watcher: Mutex<Option<RecommendedWatcher>>` to prevent immediate drop.

## Database
SQLite at `~/Library/Application Support/com.romulus.app/romulus.db` (macOS).
Resolved at runtime via `app.path().app_data_dir()` — never hardcoded.
Migrations run automatically on every launch via `rusqlite_migration`.
New migrations: add `src-tauri/migrations/NNN_description.sql` and add `M::up(include_str!(...))` in `db.rs`.

Key tables: `settings`, `user_preferences`, `rom_roots`, `rom_cache`, `format_preferences`,
`action_log`, `game_metadata`, `dat_files`, `dat_entries`, `rom_verifications`,
`thumbnail_cache`, `onboarding`.

## TypeScript bindings
Run `cargo test` in `src-tauri/` to regenerate all `src/lib/bindings/*.ts`.
Commit updated bindings alongside any `models.rs` changes.
`src-tauri/bindings/` is gitignored; canonical location is `src/lib/bindings/`.

## Styling
Dark theme default. CSS variables in `src/App.css`. Toggle via `document.documentElement.classList.toggle('light')`.
Theme stored in SQLite `settings` table (key: `"theme"`).
Always use `motion-safe:` Tailwind prefix on non-essential animations (WCAG 2.1).
Manufacturer accent colors: Nintendo `#E4000F`, Sega `#0066B3`, Sony `#003087`, Atari `#FF6600`.

## Testing
- Rust: `cargo test` in `src-tauri/` — 60 tests, in-memory SQLite only
- Frontend: `npm run test:run` (Vitest + jsdom) — test files in `src/**/*.test.tsx`
- No `#![allow(dead_code)]` — all code is wired; clippy runs clean without suppressors
