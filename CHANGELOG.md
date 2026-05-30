# Changelog

All notable changes to ROMulus are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 3 (feature pages)

**New Rust commands**
- `commands/prune.rs`: `apply_filters` (→ DeletionPlan), `export_csv`
- `commands/history.rs`: `get_history` (paginated ActionLogEntry list)
- `commands/group.rs`: `get_unofficial`, `get_system_files`, `get_duplicates`
  new `paginate()` helper; category filter on `get_games`

**8 feature pages**
- **Dashboard** — stats cards (total ROMs, consoles, size, health %), scan button,
  crash recovery banner, recent activity, console health grid
- **Consoles** — manufacturer-grouped grid with health indicators, click-to-filter
- **Games** — virtual-scrolled list (TanStack Virtual), expandable variants,
  TagBadge list, DiscBadge, preferred marker (★), debounced search
- **Hacks & Unofficial** — category-colored badges (Pirate/Unl/Aftermarket/Hack),
  preferred-language fallback indicator
- **System Files** — categorized BIOS/Utility/Demo/Video/e-Reader with protected badge
- **Duplicates** — side-by-side resolution panel, format-pair detection, Keep/Skip
- **Prune** — filter toggles, DeletionPlan preview with scrollable file list,
  CSV export, OneDrive acknowledgment guard, AlertDialog confirmation before execution
- **History** — paginated action log with action-type icons, page controls

All Phase 1–3 dead code is now wired. Only `#![allow(dead_code)]` lint suppressor
remains pending removal before first public release.

### Added — Phase 2 (React frontend scaffold)

**Foundation**
- `src/lib/env.ts` — `isTauri()` helper; all Tauri API calls return safe defaults in browser
- `src/lib/tauri.ts` — fully typed wrappers for all Tauri `invoke()` commands and `listen()` events

**Zustand stores** (`src/store/`)
- `scan.ts` — scan status, console list, progress, selected console
- `preferences.ts` — `UserPreferences`, `FilterSettings`
- `onboarding.ts` — 4-step wizard state with derived step index
- `ui.ts` — active tab, search query, theme, command palette open state

**Shared components** (`src/components/`)
- `TagBadge.tsx` / `TagList.tsx` — region/language/status chips, color-coded by type
- `ConsoleIcon.tsx` — per-console icon + manufacturer accent color (Nintendo/Sega/Sony/etc.)
- `DiscBadge.tsx` — multi-disc game count indicator
- `ErrorBoundary.tsx` — per-page React class error boundary with "Reload tab" action
- `Layout.tsx` — root layout: sidebar + main content + Tauri event subscriptions
- `Sidebar.tsx` — ROMulus logo, 9 navigation tabs, console list with file counts

**Additional shadcn/ui components** — `input`, `alert`, `alert-dialog`, `command`, `accordion`

**Onboarding wizard** (`src/onboarding/`)
- 4-step wizard: Terms + crash opt-in → Language/Region prefs → Add ROM root → First scan
- Blocks main UI until all steps complete; state persisted in SQLite
- Folder picker uses `@tauri-apps/plugin-dialog`

**Settings page** (`src/pages/Settings.tsx`) — full implementation
- Language multi-select, region drag-to-reorder (`@dnd-kit`), ROM root manager
- OneDrive detection warning, dark/light theme toggle, crash reporting toggle, Danger Zone

**Stub pages** — `Dashboard`, `Consoles`, `Games`, `HacksUnofficial`, `SystemFiles`, `Duplicates`, `Prune`, `History` — all implemented in Phase 3

**Rust model fix** — `filesize` and `bytes_to_free` annotated `#[ts(type = "number")]` (u64 → number, not bigint)

### Added — Phase 1 (Rust backend core)

**Database (`src-tauri/src/db.rs`, `src-tauri/migrations/`)**
- 3 SQL migration files: `001_initial.sql` (settings, rom_cache, action_log, rom_roots,
  format_preferences), `002_metadata.sql` (game_metadata, dat_files, dat_entries,
  rom_verifications, thumbnail_cache), `003_onboarding.sql`
- Migration runner via `rusqlite_migration`; runs on every launch, creates DB at platform
  app-data dir (`~/Library/Application Support/com.romulus.app/romulus.db` on macOS)
- `AppState` managed by Tauri: `Mutex<Connection>` + `Mutex<ScanCache>`
- Action log helpers: `log_action`, `update_pending_action`, `has_pending_actions`

**Data models (`src-tauri/src/models.rs`)**
- 18 shared Rust structs/enums with `serde` + `ts-rs` derives
- 18 TypeScript bindings auto-generated to `src/lib/bindings/` via `cargo test`
- Key types: `RomFile`, `RomGroup`, `UserPreferences`, `FilterSettings`, `AppSettings`,
  `DeletionPlan`, `ConsoleStats`, `ScanStatus`, `OnboardingState`, `FormatPair`, `PagedGroups`

**Parser (`src-tauri/src/parser.rs`)**
- Full No-Intro naming convention parser
- Handles: regions (single + multi-value like `USA, Europe`), languages (`En,Fr,De`),
  status flags with numeric suffixes (`Beta 1`, `Proto 2`), revisions (`Rev 1`),
  disc numbers (`Disc 2`), versions (`v1.03`), `[b]` bad dumps, `[BIOS]` prefix,
  `.cue/.bin` pair detection, `.chd`/`.iso`/`.7z`/raw ROM extensions
- `[BIOS]` → `FileCategory::Bios`; `Pirate/Unl/Aftermarket/Hack` → `FileCategory::Unofficial`
- `normalize_title`: lowercase, strip leading articles, remove punctuation, collapse spaces
- 19 unit tests covering all edge cases from the real collection

**Scanner (`src-tauri/src/commands/scan.rs`)**
- `walkdir`-based console folder discovery; emits `scan:progress` Tauri events
- OneDrive zero-byte file guard (skips `filesize == 0`)
- `compute_console_stats` — per-console counts for sidebar

**Grouper + Scorer (`src-tauri/src/commands/group.rs`)**
- `matches_preferred` — language matching via `UserPreferences` (never hardcoded)
- `region_default_languages` — infers language from region when no explicit language tag
- `score_rom` — priority: preferred language > region score > penalties
  (pre-release -100, bad dump -80, unofficial -30, collection tag -10, Alt -5)
- `group_roms` — groups by `(console, title_normalized)`, detects multi-disc sets
- Marks `is_unofficial_preferred_fallback` for unofficial ROMs that are the only
  preferred-language version of a game
- 9 unit tests

**Format pair detection (`src-tauri/src/deduper.rs`)**
- Detects console folder pairs with >80% title overlap (NES Headered/Headerless,
  N64 BigEndian/ByteSwapped, etc.) by comparing last parenthetical suffix
- `mark_format_pairs` propagates `is_format_pair` to affected `RomGroup`s
- 3 unit tests

**Execution engine (`src-tauri/src/commands/execute.rs`)**
- `execute_prune` — atomic trash/delete with `pending → deleted/failed` SQLite pattern
- OneDrive path detection requires acknowledgment header
- `get_interrupted_session` — crash recovery detection on next launch

**Filesystem watcher (`src-tauri/src/watcher.rs`)**
- `notify`-based cross-platform watcher; emits `watcher:new_rom` Tauri events
- 200ms debounce via `HashMap<path, Instant>`; validates new files through parser

**Settings & onboarding (`src-tauri/src/commands/settings.rs`)**
- `get_settings` / `save_settings` — preferences persisted in SQLite settings table
- `get_onboarding_state` / `complete_onboarding_step` — 4-step wizard state

**Infrastructure**
- All 11 Tauri commands registered in `lib.rs`
- `#![allow(dead_code)]` in `lib.rs` — Phase 1 functions not yet called from all
  command handlers; will be removed when Phase 2 wires the frontend

### Added — Phase 0 (scaffold)
- Tauri v2 + React 19 + TypeScript + Vite, bundle ID `com.romulus.app`
- Dark gaming theme (Tailwind CSS variables), shadcn/ui (18 components)
- ESLint, Prettier, Vitest configured; GitHub Actions CI (Rust + TypeScript)
- BSL 1.1 license (Licensor: Nicolas Yanez), PRIVACY.md, CLAUDE.md, README.md
- Public repo: https://github.com/Nyanez615/ROMulus
