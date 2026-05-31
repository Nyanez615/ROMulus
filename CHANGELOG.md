# Changelog

All notable changes to ROMulus are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Collapsible sidebar icon rail: collapse to a `w-10` icon strip with tooltip labels and active-tab highlight; expand/collapse via `PanelLeftClose` / `PanelLeft` buttons; `sidebarOpen` state in `ui.ts` store
- Settings page footer: version, author, GitHub link, and license line
- `__APP_VERSION__` Vite define injected from `package.json`; typed in `vite-env.d.ts`
- Games tab: "No games found" empty state (was missing)
- `scripts/generate_icon.py`: canonical icon generator (dark navy-indigo gradient cartridge, ROMulus wordmark ROM=white/ulus=gold, "Collection Hub" subtitle)

### Changed
- **App icon redesigned** — dark navy-indigo gradient cartridge fills the canvas; inline wordmark with ROM=white and ulus=gold; "Collection Hub" subtitle; underline rule below text; all platform sizes regenerated
- **Canonical tab layout** applied to all 9 tabs: fixed `px-6 py-4 border-b` title bar with a text-only `<h1>`; optional secondary toolbar row (`py-2 border-b border-border/50`) for search/count; scrollable content below. No buttons or icons in the title bar.
- Dashboard "Rescan collection" button moved into scrollable content (below title bar)
- Search bars for Games and Hacks & Unofficial moved to secondary toolbar row
- Settings and Prune content centered with `max-w-2xl mx-auto`
- Layout.tsx: added `[scrollbar-gutter:stable]` to prevent layout shift on scroll
- Empty states: all tabs now use `text-sm text-muted-foreground`; Duplicates and History empty states changed from vertically centered to `pt-16` top-aligned (consistent with System Files)
- History: removed `Clock` icon from `<h1>` (canonical pattern: no icons in page titles)
- Duplicates: empty state spans full content width; list content uses `max-w-4xl mx-auto`
- macOS About panel: `build_menu()` + `AboutMetadata` with icon, copyright, license, website; `short_version: Some(String::new())` suppresses the duplicate version string
- `Cargo.toml`: `authors = ["Nicolas Yanez"]`; `[[bin]] name = "ROMulus"` fixes the lowercase Dock label in dev builds
- `tauri.conf.json`: window title set to `""` (removes redundant native title bar label); `center: true`
- Copyright year updated to 2026 in About panel and Settings footer

## [0.1.0] - 2026-05-30

### Added — Phase 5 (polish & distribution)

**Console icons & branding** (Steps 36–37)
- `ConsoleIcon.tsx`: per-console colored icon + manufacturer accent color; `getConsoleColor()` utility
- `ManufacturerIcon.tsx`: Simple Icons SVG for Sega, Sony/PlayStation, Atari (Nintendo/Microsoft not in SI)
- Manufacturer accent colors: Nintendo `#E4000F`, Sega `#0066B3`, Sony `#003087`, Atari `#FF6600`
- Sidebar: selected console highlighted with manufacturer accent left-border

**Keyboard shortcuts** (Step 38)
- `useKeyboardShortcuts` hook in `Layout.tsx`; `⌘K/Ctrl+K` palette, `⌘F` search, `Escape` clear, `⌘1-9` jump to tab
- `CommandPalette.tsx`: navigation + action palette using shadcn/ui Command component

**Accessibility** (Step 39)
- `focus-visible` CSS ring for keyboard navigation (WCAG 2.4.7)
- Default outline removed on mouse interaction; `aria-label` on icon-only elements

**Auto-updater + release pipeline** (Step 40)
- `@tauri-apps/plugin-updater` installed; updater endpoint in `tauri.conf.json`
- `release.yml`: matrix build for macOS arm64+x86_64, Ubuntu, Windows via `tauri-apps/tauri-action@v0`

### Added — Phase 4 (enrichment, DAT, notifications)

**IGDB metadata enrichment** (`commands/metadata.rs`)
- OAuth2 client credentials flow; token cached in SQLite
- Client ID + secret stored in OS Keychain via `keyring` crate
- Three enrichment modes: automatic background (250ms rate-limited), on-demand per game, bulk
- `get_game_metadata`, `enrich_all_games`, `get_enrichment_status` Tauri commands
- Emits `enrich:progress` + `enrich:complete` events; writes back to `scan_cache.enrichment`
- Settings UI: Client ID + secret inputs, "Enrich all games" button, "Remove credentials" button

**SteamGridDB thumbnails** (`commands/thumbnail.rs`)
- API key stored in Keychain; fetches capsule art via search → grid → download pipeline
- Cached locally in `app_data_dir/thumbnails/<hash>.jpg`
- Served via `asset://` protocol (`convertFileSrc`); `protocol-asset` Tauri feature enabled
- Settings UI: API key input, connected status badge
- Games page: `GameThumbnail` component lazy-loads when row is expanded

**OS notifications** (via `tauri-plugin-notification`)
- Fires on scan complete, enrichment complete, deletion complete, verification complete

**No-Intro DAT support** (`commands/dat.rs`)
- Import XML DAT files; parses `<game>/<rom>` elements via `quick-xml`
- CRC32 verification: reads ZIP central directory via `zip` crate (no extraction)
- Collection completeness: cross-references collection against DAT entries
- `import_dat`, `get_dat_files`, `remove_dat`, `verify_roms`, `get_verification_status`,
  `get_completeness` Tauri commands
- Emits `verify:complete` event; writes back to `scan_cache.verification`
- Settings UI: import DAT (file picker), list of imported DATs, Verify/Remove per DAT

**New models** (5 new Rust structs + TypeScript bindings)
`GameMetadata`, `EnrichmentStatus`, `DatFile`, `Completeness`, `VerificationStatus`

**AppState refactor**
- `db` and `scan_cache` changed from `Mutex<T>` to `Arc<Mutex<T>>`
  so background tokio tasks can clone the Arc without lifetime constraints

**Dashboard additions**
- Live enrichment progress bar (event-driven)
- Collection completeness progress bars per console (after DAT import)

**Games additions**
- `GameThumbnail` — lazy SteamGridDB cover art via `convertFileSrc`
- `VerificationBadge` — ✅/⚠️/❓ per variant row after DAT verification

### Fixed — post-Phase-4 cleanup
- SQL injection in `verify_roms` console filter (parameterized nullable WHERE)
- Removed `#![allow(dead_code)]` — all 60+ symbols wired, clippy clean without suppressor
- Removed duplicate `COLLECTION_TAGS` from `parser.rs`
- Watcher bug fixed: `RecommendedWatcher` now stored in `AppState.watcher` (was dropped immediately)
- Backup manifest path fixed: uses `app.path().desktop_dir()` not `process.env.HOME`
- `assetProtocol` + `protocol-asset` feature added for thumbnail serving in production

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
