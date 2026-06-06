# ROMulus — Claude Code Guide

## What this project is
Cross-platform ROM collection management hub. Tauri v2 desktop app (Mac/Win/Linux today; iOS/Android in V2).
Manages files already on the user's device — does NOT download, distribute, or stream ROMs.
Plan file: `/Users/nyanez/.claude/plans/in-the-folder-emulation-minerva-myrient-clever-otter.md`

## Current status
- **Phase 0** ✅ Scaffold, all deps, dark gaming theme, GitHub Actions CI, public repo
- **Phase 1** ✅ SQL migrations, 60 Rust models + TS bindings, No-Intro parser (19 tests), scanner, grouper, executor, watcher
- **Phase 2** ✅ Tauri bindings layer (`src/lib/tauri.ts`), 4 Zustand stores, shadcn/ui, Layout + Sidebar, onboarding wizard, Settings page
- **Phase 3** ✅ All 8 tabs (Dashboard, ROMs, Hacks & Unofficial, System Files, Duplicates, Prune, History, Settings) + all browse/prune/history Rust commands
- **Phase 4** ✅ IGDB metadata enrichment (OAuth2, Keychain, background + on-demand + bulk), SteamGridDB thumbnails (asset:// cache), OS notifications, No-Intro DAT import + CRC32 verification + completeness tracking
- **Phase 5** ✅ Console icons, keyboard shortcuts, WCAG accessibility, auto-updater + release pipeline, `v0.1.0` published
- **Dogfood Round 2** ✅ Dashboard overhaul, cross-console title merging, collapsible FilterBar, platform multi-select, short console names toggle, `v0.2.0` published
- **Dogfood Rounds 3–4 + Bug Groups S–T** ✅ Settings persistence fixes, Language Match cache bug, region/language inference overhaul, Prune UX (checkboxes, reasons, search), format pairs in apply_filters, `v0.2.1`–`v0.2.3` published
- **Bug Groups U–X** ✅ Scoring fixes, format pair dedicated workflow, BIOS inclusion, no-counterpart reason, permanent-only deletion, cloud root blocking, `v0.2.4` published
- **v0.2.5** ✅ Sort UX overhaul (SortControl, bidirectional sort), scoring tier split (Format Variant/Collection), Prune filter descriptions + preview scroll fix, format pair subset indicator, auto-rescan, React Compiler v7 hardening
- **v0.2.6** ✅ Titles Count Architecture (game_groups sidebar/Dashboard), scoring overhaul (multi-language tag parsing, alt_penalty fix, version tiebreaker), AlphabetScrubber + VariantCountScrubber, Hacks merged into ROMs tab, Preferred filter chip

## Dev setup

```bash
# Prerequisites: Rust (rustup), Node 24, Xcode CLT (macOS)
npm install
npm run tauri dev      # Vite HMR + native Tauri window
```

From `src-tauri/`:
```bash
cargo test                    # 137 unit tests + regenerates src/lib/bindings/
cargo clippy -- -D warnings   # must be clean (same as CI)
```

From project root:
```bash
npx tsc --noEmit       # TypeScript type-check
npm run lint           # ESLint
npm run test:run       # 114 Vitest tests
```

## Architecture

```
src/                             React frontend (Vite root)
  components/
    ui/                          shadcn/ui copied components (you own this code)
    ConsoleIcon.tsx              Manufacturer/console icon + accent color (wraps consoleUtils.ts)
    ConsolePageTitle.tsx         Colored console heading shared by all console-filtered tabs
    ConsoleEmptyState.tsx        Empty state for console-filtered views with no results
    AlphabetScrubber.tsx         A–Z # strip for ROMs tab (name sort); reverses in desc order
    VariantCountScrubber.tsx     Numeric variant-count strip for ROMs tab (variants sort)
    FilterBar.tsx                Collapsible Category/Language/Region/Preferred filter panel (ROMs tab)
    SortControl.tsx              Field <select> + direction <button> pill; used on ROMs/Duplicates/Dashboard
    TagBadge.tsx / TagList.tsx   Region/language/status chips
    DiscBadge.tsx                Multi-disc count badge
    ErrorBoundary.tsx            Per-page React error boundary
    Layout.tsx                   Root layout: sidebar + content + event subscriptions
    Sidebar.tsx                  Nav tabs, console list, scan status footer
  lib/
    bindings/                    Auto-generated TS types from Rust structs (never edit)
    consoleUtils.ts              SINGLE SOURCE OF TRUTH for all console data/logic — never import colors or abbreviations from ConsoleIcon.tsx in new code
    regionUtils.ts               REGION_DEFAULT_LANGUAGES map + helpers — mirrors parser.rs::region_default_languages; keep in sync
    romUtils.ts                  ROM_SORT_FIELDS / RomSortField / SortDir shared by ROMs tab — import from here, never inline
    tauri.ts                     All invoke()/listen() wrappers with browser-safe defaults
    env.ts                       isTauri() helper
    utils.ts                     cn() helper
  pages/                         One component per tab (Dashboard.tsx, Roms.tsx, SystemFiles.tsx, Duplicates.tsx, Prune.tsx, History.tsx, Settings.tsx)
  store/                         scan.ts · preferences.ts · onboarding.ts · ui.ts
  onboarding/                    4-step wizard (Terms → Prefs → Roots → Scan)

src-tauri/
  src/
    lib.rs                       Tauri builder, plugin init, all command registrations
    models.rs                    ALL shared types — edit here, run `cargo test` for TS output
    parser.rs                    No-Intro filename → RomFile (format/disc/BIOS aware)
    deduper.rs                   Format-pair detection (detect_format_pairs)
    db.rs                        AppState (Arc<Mutex<>> for db+scan_cache), migrations, helpers
    watcher.rs                   notify-based FS watcher, 200ms debounce, kept in AppState
    commands/
      scan.rs          scan_roots, get_scan_status, get_consoles, get_format_pairs
      group.rs         get_roms, get_unofficial, get_system_files, get_duplicates, merge_format_pairs
      prune.rs         apply_filters (→ DeletionPlan w/ DeletionItem+DeletionReason), export_csv
      execute.rs       execute_prune (atomic + backup manifest), get_interrupted_session
      history.rs       get_history
      settings.rs      get/save settings, get/save filter_settings, reapply_preferences, get/complete onboarding
      metadata.rs      IGDB: set/has/clear_igdb_credentials, get_game_metadata, enrich_all_games
      thumbnail.rs     SteamGridDB: set/has/clear_steamgriddb_key, get_thumbnail
      dat.rs           import_dat, get_dat_files, remove_dat, verify_roms,
                       get_verification_status, get_completeness
  migrations/          001_initial.sql · 002_metadata.sql · 003_onboarding.sql
                       004_permanent_delete.sql · 005_known_tags.sql · 006_short_console_names.sql
                       007_clean_language_tags.sql · 008_fix_known_tags.sql
  capabilities/        Tauri v2 permissions (fs, shell, dialog, notification, shortcuts)
  tauri.conf.json      Bundle ID: com.romulus.app · assetProtocol enabled
  Cargo.toml           All crates incl. rusqlite, notify, keyring, reqwest, quick-xml, zip
```

## Key conventions

- **No hardcoded languages or regions** — flows through `UserPreferences` from DB.
- **Rust structs derive `TS`** — `cargo test` regenerates `src/lib/bindings/*.ts`. Commit alongside `models.rs` changes.
- **Tauri commands, not HTTP** — frontend calls `invoke('command_name', args)` via wrappers in `tauri.ts`. All wrappers return safe defaults in browser preview.
- **Background tasks use Arc cloning** — `Arc::clone(&state.db)` and `Arc::clone(&state.scan_cache)` before `tauri::async_runtime::spawn`.
- **Background tasks emit Tauri events** — frontend subscribes via `listen()`. Events: `scan:progress`, `scan:complete`, `watcher:new_rom`, `preferences:regrouped`, `enrich:progress`, `enrich:complete`, `verify:complete`.
- **Deletions go to Trash by default** — permanent delete opt-in in Settings → Danger Zone. Pre-prune backup manifest auto-written to Desktop before any execution.
- **BIOS files subject to language preference** — pruned like any other file; an English-preferred user keeps English BIOS variants and removes non-English ones.
- **Multi-disc games kept together** — `disc_number` coalesces into one `RomGroup`; delete/keep applies to full disc set.
- **Action log is append-only** — no DELETE path on `action_log` table. Pending → deleted/failed via atomic SQLite transaction.
- **Crash recovery** — `has_pending_actions()` checked on launch; banner shown in Dashboard.
- **`isTauri()`** — all Tauri API calls guarded so the Vite browser preview works without errors.
- **Watcher must stay alive** — stored in `AppState.watcher: Mutex<Option<RecommendedWatcher>>` to prevent immediate drop.
- **`consoleUtils.ts` is the single source of truth** — all console abbreviations, colors, platform detection, and display-name logic live here. Never import these from `ConsoleIcon.tsx` in new code.
- **`selectedConsoles: string[] | null`** (plural) in the scan store. `null` = All ROMs mode; array = one or more consoles selected.
- **All Rust browse commands take `consoles: Option<Vec<String>>`** — use `group_matches_consoles()` (not the old `console_matches()`) so cross-console merged groups are handled correctly.
- **`FilterBar` component** — takes `groups`, `leading`, and `trailing` ReactNode props. Renders collapsible chip panels (Category → Language → Region order) with active-count badges. Filter chips are bidirectional: Language chip also matches region-inferred ROMs via `regionUtils.ts`.
- **`regionUtils.ts`** — `REGION_DEFAULT_LANGUAGES` and `getRegionDefaultLanguages()` are the TS mirror of `parser.rs::region_default_languages`. Always keep in sync. Used by filter chips and the Settings inferred-regions note.
- **`romUtils.ts`** — `ROM_SORT_FIELDS` / `RomSortField` / `SortDir` shared by the ROMs tab — import from here, never inline.
- **`DeletionPlan`** — `to_delete` is `DeletionItem[]` (not `RomFile[]`). Each item has `{ rom: RomFile, reason: DeletionReason }`. Frontend must extract `.rom` when passing to `execute_prune` or `export_csv`.
- **Prune filter settings** — persisted via dedicated `get_filter_settings` / `save_filter_settings` commands (KV `settings` table). Not bundled in `AppSettings`. Prune.tsx loads on mount and saves on each toggle.

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

## Tab layout — canonical pattern (macOS convention)
Every tab uses this exact shell. Do not deviate:

```tsx
<div className="flex flex-col h-full">
  {/* Title bar — fixed h-14 (56 px) on every tab AND the sidebar header for pixel-perfect divider alignment */}
  <div className="h-14 flex items-center px-6 border-b border-border">
    <h1 className="text-base font-semibold text-foreground">Tab Name</h1>
  </div>

  {/* Optional: tab-specific toolbar (search, count, etc.) — non-scrolling, below the divider */}
  {/* <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3"> ... </div> */}

  {/* Scrollable content */}
  <div className="flex-1 overflow-auto p-6 space-y-6">
    {/* content */}
  </div>
</div>
```

Rules:
- **`h-14 flex items-center`** (56 px) — must be used on every tab header AND the sidebar header (both open and collapsed states). Never use `py-4` on the header row; it produces a different height depending on text size.
- **No buttons or controls in the title bar.** Action buttons (e.g. "Rescan collection") go at the top of the scrollable content area.
- **No icons in `<h1>`.** Sidebar nav items keep their icons; page titles do not. Section titles inside the page (Settings, etc.) do get icons.
- **Search bars / counts** go in a secondary toolbar row (`py-2 border-b border-border/50`) between the title bar and the scrollable content — never inside the title bar.
- **Settings-style content** (Settings, Prune): wrap scrollable content in `<div className="max-w-2xl mx-auto p-8 space-y-8">` for a centered column. The `flex-1 overflow-auto` wrapper stays on the outer div.
- **`[scrollbar-gutter:stable]`** is applied globally in `Layout.tsx` to prevent layout shift when a scrollbar appears.

## Styling
Dark theme default. CSS variables in `src/App.css`. Toggle via `document.documentElement.classList.toggle('light')`.
Theme stored in SQLite `settings` table (key: `"theme"`).
Always use `motion-safe:` Tailwind prefix on non-essential animations (WCAG 2.1).
Manufacturer accent colors: Nintendo `#E4000F`, Sega `#0066B3`, Sony `#003087`, Atari `#FF6600`.

## Testing
- Rust: `cargo test` in `src-tauri/` — 107 tests, in-memory SQLite only
- Frontend: `npm run test:run` (Vitest + jsdom) — 113 tests in `src/**/*.test.tsx`
- No `#![allow(dead_code)]` — all code is wired; clippy runs clean without suppressors
