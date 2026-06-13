# Changelog

All notable changes to ROMulus are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.11] — 2026-06-13

### Fixed

**Scoring**
- **World releases no longer penalised in region scoring** — a "World" release now scores at `max_preferred_regions × 20` even when "World" is not in the preferred-regions list, matching the user's top preferred region. Previously, "World (Rev 1)" could lose to a region-specific release because it wasn't an explicit match.
- **Version bonus (+6) in all scoring paths** — ROMs with a version tag (`v1.1`) or revision receive +6 in both official and unofficial paths, overcoming the −5 unknown-tag penalty so a versioned publisher-label release always beats an older unversioned one.
- **`version_ord(None)` repositioned** — bare/unversioned files sit just below v1.0 (not at 0). Bare files beat sub-1.0 builds (v0.x signals incompleteness) but still lose to v1.0+.
- **Dynamic collection penalty** — penalty is now `−(region_score + 6)` instead of a flat −100, ensuring no collection re-release (Evercade, LodgeNet, etc.) can beat any unpenalised original even when the re-release is a "World" title with a large region score.
- **`"Patreon"` exempt from extra-tag penalty** — added to `HARDWARE_FEATURE_TAGS`. Developer-direct Patreon builds are typically the latest release from the original author; exempting them from −5 lets the version tiebreaker choose the correct copy. (Regression: Anguna – Warriors of Virtue v1.1 (Patreon) was deleted in favour of v0.95.)
- **`"Tech Demo"` treated as pre-release** — Tech Demo files now score in the pre-release tier (−100) alongside Demo, Proto, Alpha, Beta, etc.
- **Numbered protos rank above date-stamped protos** — `build_ord = 99_000_000 + revision` ensures Proto 2 / Beta 3 (explicitly sequenced by archivists) always outrank any dated snapshot (YYYYMMDD ≤ 20_991_231).

**Grouping / key normalisation**
- **Apostrophe normalisation** — straight `'` and Unicode `'` stripped from group keys. Possessive variants ("Hoodlum's Revenge" / "Hoodlums' Revenge") now share a group.
- **`&` / `+` separator equivalence** — `" & "` (No-Intro Europe) and `" + "` (No-Intro USA) are both normalised to a space. "Uno & Skip-Bo" and "Uno + Skip-Bo" now group together.
- **`vs.` / `vs` normalisation** — collapsed to `" v "` so "Ecks vs. Sever" and "Ecks V Sever" share a key (both collapse to "ecks 5 sever" via the Roman-numeral pass).
- **Trailing article suffix stripping** — `", The"`, `", An"`, `", A"` stripped in both `normalize_key` (grouping) and `normalize_title` (search). "Blues Brothers, The" now groups with "Blues Brothers".
- **ISO date with time component parsed** — `parse_iso_date` strips the `T…` time suffix before parsing, so build dates like `"2000-09-14T121024"` are correctly read as 20000914.
- **Category detection order** — Video / e-Reader / Accessory checks now run before Unofficial. An aftermarket e-Reader card is `FileCategory::EReader`, not `Unofficial`.

**Format pair detection**
- **Category subfolders always detected as pairs** — `is_category_variant` in `deduper.rs` ensures base + `(Aftermarket)` / `(Private)` / etc. always appear as a format pair regardless of title overlap. Previously, low overlap (<80%) could miss the pair and hide it from Format Variant Preferences.

**Format pair merging**
- **Compilation subtitles preserved through merge** — `merge_format_pairs` now uses `picker::group_key` (not `title_normalized`) as the bucket key. "4 Games on One Game Pak (Racing)" vs "(Nickelodeon Movies)" vs "(Nicktoons)" no longer collapse into one group with two phantom deletions.
- **Catalog-number groups stay separated** — `RomGroup` gains `catalog_number: Option<String>`. Groups differing only by catalog number ("4 in 1 (4B-001)" / "4 in 1 (4B-002)") are keyed separately throughout `merge_format_pairs`.

**qBittorrent pre-download**
- **Format preferences wired into pre-download filter** — `run_filter` now calls `merge_format_pairs` with saved preferences, so pre-download decisions are consistent with the post-download prune.
- **Catalog-number groups shown individually in Titles view** — preview now iterates `result.groups` instead of re-keying by `picker::group_key`; each "4 in 1 (4B-00N)" entry is shown separately.

**UI**
- **Single-variant titles expandable in pre-download preview** — all groups can be expanded to see the actual ROM filename, matching the prune preview behaviour. Expand/Collapse button applies to all groups (not just multi-variant).
- **Expand/Collapse merged to a single toggle** in prune preview (was two separate buttons).
- **Left-side category badges removed** from variant rows in ROMs tab.
- **`getFormatVariantLabel`** strips all trailing parens for multi-suffix folders (e.g. "GBA (e-Reader) (Aftermarket)"), preventing label collisions.
- **Format variant folders sorted alphabetically** in Settings.
- **Prune dialog auto-reopen fixed** — `setPrunePlanVersion(null)` on execute prevents the auto-refresh effect from reopening an empty dialog after a successful prune (affected both ROMs tab and Downloads tab).

### Technical
- `RomGroup.catalog_number: Option<String>` — carries original-case catalog tag for disambiguation.
- `is_category_variant` + `strip_one_trailing_paren` added to `deduper.rs`.
- `extract_catalog_number` / `extract_catalog_tag` helpers in `group.rs`.
- `version_ord` sentinel: `None → 27 × 27_000_000 − 1` (just below v1.0).
- Rust tests: 231 → 266 (+35). Vitest: 134 (unchanged).

## [0.2.10] — 2026-06-11

### Added
- **Accessories / amiibo in System Files** — `FileCategory::Accessory` (amiibo NFC dumps and similar non-playable accessories) now appears as an "Accessories" section in the System Files tab. Backend already filtered the category; frontend `ALL_CATEGORIES` array updated with a `Package` icon entry.
- **System Files count everywhere** — `ConsoleStats` gains `system_file_count: u32` (BIOS + Video + e-Reader + Accessory). Sidebar footer shows a 3-line breakdown: Titles / Files · ROMs / System Files · Platforms. Dashboard gains two new stat tiles (Files and System Files), and per-console cards show the system file count inline. `compute_console_stats` counts system files in the per-ROM loop.
- **Format Variant Preferences** — new Settings section replaces the old "Format Variant Cleanup" delete workflow. For each detected format pair (FDS/QD, Headered/Headerless, etc.) the user picks their preferred folder via radio buttons. Selecting a preference saves to the `format_preferences` DB table and immediately triggers a rescan so the ★ preferred marker updates throughout the ROMs tab.
- **Format preference wired into `merge_format_pairs`** — fourth parameter `format_prefs: &HashMap<String, String>` added. After `build_group` scores variants, the function overrides `preferred_idx` when a saved preference matches the pair's `console_group`. `scan_roots` and `reapply_preferences` both load preferences from DB and pass them through. The FDS vs. QD alphabetical tie bug is resolved.
- **Downloads: rescan after applying qBittorrent priorities** — after `apply_qbt_filter` succeeds, the pre-download section automatically rescans ROM roots and shows inline "Scanning…" / "Collection updated." feedback identical to the post-settings-change flow.

### Changed
- **Format Variant Cleanup removed** — `apply_format_pairs` and `execute_format_pairs` Tauri commands deleted from Rust (`prune.rs`, `execute.rs`) and unregistered from `lib.rs`. `applyFormatPairs` and `executeFormatPairs` wrappers removed from `tauri.ts`. The deletion workflow is superseded by the new preference-driven prune flow.
- **`DeletionReason` simplified** — `FormatPairNonPreferred` and `FormatPairNoCounterpart` variants removed. Only `NonPreferred` and `NoPreferredVersion` remain. `PRUNE_REASON_LABELS`/`PRUNE_REASON_COLORS` in `PrunePreviewDialog.tsx` updated accordingly.
- **`matchesCat` in PrunePreviewDialog** — "system" bucket now includes `accessory` to match the updated `get_system_files` filter.

### Technical
- `merge_format_pairs` signature: 3 args → 4 args (`format_prefs: &HashMap<String, String>`). Builds a `folder_a_to_pair` reverse map internally to resolve `console_group` from bucket key.
- `build_format_delete_map`, `apply_format_pairs` functions removed from `prune.rs`.
- `execute_format_pairs` function removed from `execute.rs` (`resume_session` still handles `format_pair_cleanup` rows for crash recovery of interrupted old sessions).
- `ConsoleStats` struct: new `system_file_count: u32` field. TS binding regenerated (`cargo test`).
- `CATEGORY_PRIORITY` dead constant removed from `Roms.tsx`; `CategoryFlag` type removed.
- Rust tests: 197 → 231 (+34). Vitest: 101 → 134 (+33).

## [0.2.9] - 2026-06-09

### Added
- **DAT pre-download filter** — generate a ranked download list from an imported No-Intro DAT before downloading any files. The same `parse_from_filename → group_roms → score_rom` pipeline used by the live pruner scores every title in the DAT against the user's real `UserPreferences`. The output is a deterministic list of preferred filenames ready for use as a torrent include-filter.
  - Migration 010 (`dat_rom_name`) — adds nullable `rom_name TEXT` to `dat_entries`; existing rows get `NULL` until re-imported.
  - `parse_dat()` now captures `<rom name="…">` (actual ROM filename) alongside the game title.
  - `parse_from_filename(filename, console) -> Option<RomFile>` — new parser entry-point with no filesystem access; all tag-parsing logic shared with the live scanner.
  - `generate_download_list(console)` Tauri command — multi-disc aware: collects all variants whose `(i32, u32, usize)` score triple equals the preferred score (sibling discs share an identical triple).
  - `export_download_list(entries, path, format)` Tauri command — Text format maps ROM extensions (`.3ds`, `.nds`, `.gba`, etc.) to `.zip` for torrent client compatibility; CSV exports full metadata.
  - Settings UI: "Generate" button per DAT row; preview panel with search, status chips (Preferred / Pre-release only), entry count, and export buttons (`.txt` / `.csv`); amber re-import prompt when `total_in_dat = 0` (pre-migration import).
- **Right-click context menu on all file rows** — "Show in Folder" and "Copy Path" on every file row: ROM variants, System Files entries, History log entries, and Prune preview items. Calls `tauri-plugin-opener` `revealItemInDir`; toasts on error for already-deleted files. `revealInFinder(path)` added to `tauri.ts` with browser-preview safe fallback.
- **Comprehensive console catalog** — `consoleUtils.ts` expanded to cover every common No-Intro/Redump distribution variant and platform:
  - `VARIANT_SUFFIXES` expanded: `(Decrypted)`, `(Download Play)`, `(Digital)`, `(CDN)`, `(PSN)`, `(NoNpDrm)`, `(PSVgameSD)`, `(Minis)`, `(UMD Video)`, `(UMD Music)`, `(Games on Demand)` — every known variant suffix now collapses onto one console card.
  - `getCanonicalConsoleName` is now recursive: multi-suffix names like `Nintendo 3DS (Digital) (Decrypted)` fully strip to `Nintendo 3DS`.
  - `getAbbrev` / `getConsoleDisplayName` / `getFormatVariantLabel` all try the canonical name as a fallback before truncating, so no variant combination ever shows the `"NINT"` fallback abbreviation.
  - `ABBREV` additions: Nintendo DS / DSi / 3DS / Switch / Wii / WiiU / GCN / FC / BSX, Atari 2600 / 5200 / 7800 / Jaguar / Lynx, SNK NGP / NGPC / NGCD, NEC PCE / SGX, Bandai WS / WSC, Sony PS3 / PS4, Microsoft XBX / X360, 3DO, ColecoVision, Intellivision, Vectrex, MSX, MSX2, and more.
- **Storage size on Dashboard console tiles** — each console tile now shows the folder's total storage size alongside title and ROM counts.

### Fixed
- **Dashboard console tile tooltip** — removed redundant `title` attribute that caused the tooltip to show `"GBA, GBA, GBA"` when `getConsoleDisplayName` collapses sub-variants to the same short name.

### Technical
- `PRERELEASE_FLAGS` constant in `dat.rs` — defines No-Intro status tags that mark pre-release-only titles in the download list (entries with no non-pre-release counterpart get `DownloadStatus::PrereleaseOnly`).
- New TS bindings: `DownloadEntry.ts`, `DownloadList.ts`, `DownloadStatus.ts`, `ExportFormat.ts`.
- `src/components/FileContextMenu.tsx` (new); `src/components/ui/context-menu.tsx` (new shadcn component); `@radix-ui/react-context-menu` added.
- Rust tests: 164 → 197 (+33). Vitest: 97 → 101 (+4 consoleUtils tests).

## [0.2.8] - 2026-06-06

### Added
- **Faceted chip filtering** — selecting a Region chip now hides Category/Status chips that would produce zero results (and vice versa), preventing dead-end filter combinations. Each chip dimension's available items are computed from groups matching all other active filters.
- **`getFormatVariantLabel()`** — new helper in `consoleUtils.ts` that preserves the parenthetical variant suffix after abbreviating, so paired folders are always distinguishable in the UI (e.g. "FDS" vs "FDS (QD)", "N64 (BigEndian)" vs "N64 (ByteSwapped)").
- **Audit binary** — `src-tauri/src/bin/audit.rs` for offline ROM scoring inspection without a running Tauri app.
- **Migration 009** — cleans up stale filter settings rows from previous schema.

### Changed
- **Prune integrated into Settings** — the dedicated Prune tab is removed. The full prune workflow (filter toggles, format variant cleanup, preview, execute, export) now lives inside the Settings page as integrated sections. `Prune.tsx` and `Prune.test.tsx` deleted. Tab count: 6 → 5 (Dashboard · ROMs · System Files · History · Settings).
- **Duplicates tab removed** — tab and all associated code removed. The prune engine already handles every "multiple keep-eligible variants" case; the manual resolution UI added no value.
- **Utilities moved to ROMs tab** — `FileCategory::Utility` (test cartridges, debug builds, SDK tools) moved from `get_system_files` to `get_roms`. System Files now shows only BIOS / Video / e-Reader (firmware-only).
- **"Format Pair" → "Format Variant"** in all user-visible labels (section headings, reason badges, prune preview). Internal identifiers (`FormatPairNonPreferred`, `format_pair_no_counterpart`, `get_format_pairs`, etc.) are unchanged.
- **All deletions are now permanent** — `DeleteMode` enum removed. `execute_prune` uses `fs::remove_file`; `execute_format_pairs` uses `fs::remove_dir_all`. No more staging dirs, no more Trash. Pre-execution backup manifest written to `app_data_dir/manifests/` (was Desktop).
- **Cloud root blocking** — `isCloudPath()` replaces `isOneDrivePath` and covers OneDrive, iCloud, Dropbox, Google Drive, Box, and CloudStorage paths. Cloud roots blocked at picker time in both Settings and the onboarding wizard.

### Fixed
- **Scoring: multi-game compilations** — `parser.rs` now splits same-named multi-game compilations by catalog number to avoid false title-normalization collisions.
- **Scoring: collection penalty raised** — `COLLECTION_TAGS` penalty raised from −10 to −80 so third-party collection re-releases (LodgeNet, Evercade, Limited Run Games, Retro-Bit Generations) are strongly deprioritised vs. original releases.
- **Scoring: Disney Classic Games, Konami Anniversary, QUByte Classics** — added to `COLLECTION_TAGS` (−80 penalty).
- **Scoring: revision bonus** — `rev × 100` added to official ROM score so Rev 2 reliably beats Rev 1 when all other factors are equal.
- **Scoring: prototype ordering** — later prototypes (Proto 2, Beta 3) now score higher than earlier ones within the same pre-release tier.
- **Scoring: BIOS extra-tag penalty** — unrecognised extra tags (e.g. `(GBC Mode)`, `(GameCube)`) now score −5 so the plain release is always preferred.
- **Prune preview tab alignment** — the "ROMs" tab bucket (game / unofficial / demo / utility) and "System Files" bucket (bios / video / e_reader) in `PrunePreviewDialog` now match the actual tab split after Utilities were moved.
- **CSV export scope** — Export CSV now includes all checked items across all category tabs, not just the active tab. Previously, exporting from the "ROMs" tab silently omitted BIOS items visible in the "System Files" tab.
- **CSV export filename** — now includes the console abbreviation and wall-clock time (e.g. `romulus-prune-gb-2026-06-06-0917.csv`) so multiple prune sessions don't produce the same default filename.
- **Empty category chips hidden** — Category filter chips in the ROMs tab are now computed from groups actually loaded, not from the historic DB `known_tags` table. Tags no longer present in the current collection are hidden.

### Technical
- `src/pages/Duplicates.tsx` + `src/pages/Duplicates.test.tsx` deleted.
- `src/pages/Prune.tsx` + `src/pages/Prune.test.tsx` deleted (workflow absorbed by Settings).
- `group::get_duplicates` Rust command removed from `group.rs` and deregistered from `lib.rs`.
- `TabId` union: removed `"duplicates"`; keyboard shortcuts renumbered (History = ⌘4, Settings = ⌘5).
- `PrunePreviewDialog.tsx`: `checkedItems` (tab-scoped, used for Delete button) vs. `allCheckedItems` (all tabs, used for Export CSV).
- Rust tests: 137 → 164. Vitest tests: 114 → 97 (net: removed Duplicates + Prune suites, added faceted filtering tests).

## [0.2.6] - 2026-06-05

### Added
- **Alphabet scrubber** — narrow `#` / A–Z strip on the left edge of the ROMs list when sorted by Name (ascending or descending). Active-letter highlight tracks scroll; clicking a letter jumps to the first matching group. Tooltip shows title count per letter (e.g. "B — 183 titles"). Hidden when a search query is active or there are fewer than 50 results. Strip reverses to Z→# in descending order.
- **Variant count scrubber** — analogous strip showing distinct variant counts in sort order when sorted by Variants. Tooltip shows "3 variants — 142 titles".
- **Titles Count Architecture** — `ConsoleStats` gains four count fields: `total_files`, `total_groups` (all categories), `game_files`, `game_groups` (game category only). The Dashboard adds a sixth **Titles** stat tile positioned between ROMs and Consoles. Console cards show "X titles · Y ROMs". Platform header rows show "· X titles · Y ROMs · Z GB". Dashboard sort-by-count now ranks by title count. Sidebar All/platform/console rows show title counts (via `canonicalTitleCount`). ROMs tab header counts "X titles · Y ROMs" using only game + unofficial files.
- **Prune category filter tabs** — "All / Games / System Files" tabs above the deletion preview list, allowing focused review of each category.

### Fixed
- **Multi-language tag parsing** — `is_language_tag()` in `parser.rs` was a pure whitelist lookup; combined codes like `(Fr,De)` were not recognised and the ROM was assigned `languages = []`. The function now accepts any comma-separated sequence of valid ISO 639-1 single codes, so `Asterix & Obelix (Europe)(Fr,De)` is correctly parsed and no longer incorrectly preferred over the Spanish (En,Es) release for English users.
- **`alt_penalty` was dead code** — the Alt penalty read `rom.extra_tags` but `"Alt"` is stored in `status_flags` by the parser, so the penalty was always 0. Fixed: `is_alt = rom.status_flags.iter().any(|f| f == "Alt")` is now computed at the top of `score_rom` and applied in every scoring path (official, unofficial, pre-release, bad-dump). Non-Alt variants are now correctly preferred over Alt variants at the same tier.
- **Pre-release and bad-dump tiebreakers** — both early-return paths returned a two-element score `(-100 + alt_penalty, rom.revision)`, so USA (Proto) and Europe (Proto) could tie and be resolved by filename. The third tuple element now includes `lang_count * 1000 + r_score`, matching the tiebreaker used for unofficial ROMs. USA (Proto) now beats Europe (Proto) for English users.
- **Version tiebreaker** — `build_group` sort had no way to distinguish `v2.1` from `v1.0` when score and revision tied. A `version_ord()` helper (v`major.minor.patch` → u64) is now inserted between the score tuple and filename, so newer versioned ROMs beat older ones and versioned beats unversioned.

### Changed
- **Hacks & Unofficial merged into ROMs tab** — `HacksUnofficial.tsx` removed; all unofficial ROMs (Hack / Pirate / Aftermarket / Unl) now appear in the single unified ROMs tab with coloured category badges on each row. The Hacks & Unofficial navigation entry is gone; the tab count drops from 8 to 7.
- **"Preferred" moved from sort to filter** — the "Preferred" sort option (which was ambiguous with the alphabet scrubber) is replaced by a **Preferred** chip group in the Filter Bar with "Has preferred" and "No preferred" options.
- **`LANGUAGE_CODES` cleaned** — redundant hardcoded multi-language combinations (e.g. `"En,Fr"`, `"En,De"`) removed; only single ISO 639-1 codes remain. `is_language_tag` now dynamically accepts any comma-separated sequence.

### Technical
- `AlphabetScrubber.tsx` (new) — `src/components/AlphabetScrubber.tsx`
- `VariantCountScrubber.tsx` (new) — `src/components/VariantCountScrubber.tsx`
- `VirtualRomList` now accepts `showScrubber`, `reverseStrip`, `showCountScrubber`, `sortDir` props; `onChange` callback on `useVirtualizer` updates `firstVisibleIndex` state for scrubber synchronisation.
- `ConsoleStats` in `models.rs`: new fields `preferred_groups: u32`, `all_groups: u32`, `unofficial_files: u32`. TS binding regenerated.
- `consoleUtils.ts`: `stripFormatSuffix`, `canonicalTitleCount` helpers exported.
- Rust tests: 128 → 137 (4 parser tests for multi-language tag parsing; 4 group tests for tiebreaker correctness; 1 existing test comment updated). Vitest: 114 (unchanged).

## [0.2.5] - 2026-06-04

### Added
- **Sort controls** — `SortControl` component: a field `<select>` and direction `<button>` (ArrowUp/Down icons) joined as a pill. Used on ROMs, Hacks & Unofficial, Duplicates, and Dashboard tabs, replacing the previous shadcn `<Select>` controls.
- **Bidirectional sort on all browse tabs** — ROMs and Hacks & Unofficial: Name (A–Z / Z–A), Variants (most/least), Preferred (starred first/last). Duplicates: Title, Console (hidden when a console is selected), Count. Dashboard: Name, Count (by title count).
- **Expand/Collapse all** — "Expand all" / "Collapse all" button in the FilterBar `trailing` slot on ROMs and Hacks & Unofficial. Computed from `displayGroups.every(g => expandedSet.has(key))`; resets automatically when the displayed list changes.
- **Format pair subset indicator** — `FormatPair` carries `folder_a_count` and `folder_b_count` (title counts per folder). `deduper.rs` assigns `folder_a` as the smaller (subset) folder and `folder_b` as the larger. Pair cards show `A ⊂ B · X of Y titles` when it is a proper subset, `X titles each · 100% overlap` when equal, and `XX% overlap · X / Y titles` for partial overlap. Subset folder gets a sky-blue "subset" badge.
- **Auto-rescan after format pair execution** — after `execute_format_pairs` completes, Prune triggers `scanRoots → setStatus → setConsoles → refreshTagStore → bumpCacheVersion`. The success banner shows "Rescanning collection…" during the scan, then "Collection updated." All tabs update without manual action.

### Fixed
- **Collection tag over-penalisation** — `COLLECTION_TAGS` (−10 each) previously included official Nintendo re-release platforms (Virtual Console, Wii VC, Switch Online, Classic Mini, GameCube). These are now split into three tiers: Official Nintendo digital re-releases get **0 penalty** (fall-through). `FORMAT_VARIANT_TAGS` (Disk Writer, Satellaview, Sega Channel, 64DD, Meganet, NP, Animal Crossing) get **−5**. Third-party / non-standard collections (LodgeNet, Evercade, Limited Run Games, Retro-Bit Generations) keep **−10**.
- **`matchesCat` in Prune was defined inside component body** — moved to module scope; the two `useMemo` hooks that called it now have a correct dependency array.

### Changed
- **Prune filter descriptions** — previously shown on hover via `<Tooltip>`; now always visible as a `<p className="text-xs text-muted-foreground">` line below each toggle label. `TooltipProvider` removed from `Prune.tsx`.
- **Prune preview scroll** — `ScrollArea` replaced with plain `div overflow-y-auto overflow-x-hidden`; `min-w-0` on filename spans prevents horizontal overflow in flex rows; preview list height `h-64` → `h-72`; "Show all" button in the footer reveals all items without a hard cap.
- **Console name abbreviations** — `xxx.split(" - ")[1] ?? xxx` patterns replaced with `getAbbrev(xxx)` from `consoleUtils.ts` in Prune, SystemFiles, History, Duplicates, and Settings (5 + existing callsites).
- **Format pair cards** — folder rows ordered subset-first (folder_a) rather than alphabetically; title counts shown next to each folder name.

### Technical
- `SortControl.tsx` (new) — `src/components/SortControl.tsx`; `ROM_SORT_FIELDS` / `RomSortField` / `SortDir` types in `romUtils.ts` (replaces `ROM_SORT_OPTIONS` / `RomSortKey`)
- `FormatPair` struct: `folder_a_count: usize`, `folder_b_count: usize` added. TS binding regenerated.
- `deduper.rs`: `folder_a`/`folder_b` canonical assignment (smaller ≤ larger).
- React Compiler v7 hardening (proactive — lint was already clean): all `Set<T>` state → `T[]` arrays in SystemFiles, Sidebar, Dashboard, Duplicates, Roms, HacksUnofficial; `useVirtualizer` isolated in `VirtualRomList`/`VirtualHacksList` child components; `Dashboard.totalCanonicals` deps `[consoles]` (plain array) instead of `[platformStats]` (Map).
- Rust tests: 128 (4 new scoring tests; prior 124 unchanged). Vitest: 114 (+1 Preferred sort test).

## [0.2.4] - 2026-06-02

### Fixed
- **`(GameCube Preview)` and `(Preview)` treated as unpenalised extra tags** — added both to `STATUS_FLAGS` so they score −100 (pre-release). Fixes `(GameCube Preview)` ROMs incorrectly winning the preferred ★ over regular releases (confirmed: Pokémon Puzzle Collection).
- **Language match not used as tiebreaker** — `score_rom()` now returns `(i32, u32, usize)`; the third element is the preferred-language explicit match count. Breaks ties where region score and revision are equal (e.g. `(Europe)(En,Fr,De)` vs `(Europe)(En,Ja,Fr)`).
- **Non-deterministic variant order within a group** — filename alphabetical tiebreaker added as the final fallback in `build_group` sort, making the order fully stable across runs.
- **Format pairs wired into `apply_filters_inner`** — format pair cleanup no longer runs inside `apply_filters_inner`. Its `format_prefs` / `format_pairs` parameters are removed. Format pair deletion is now a dedicated workflow in the Prune tab, so regular variant pruning and format pair cleanup no longer interfere.
- **BIOS files silently skipped in format pair cleanup** — `build_format_delete_map` (renamed from `build_format_delete_set`) previously exempted BIOS files. That exemption was correct for variant pruning but wrong for format pair cleanup where the entire non-preferred folder is removed; BIOS files in that folder are now included.
- **`(Preview)` / `(GameCube Preview)` not propagated to `remove_prerelease` filter and `get_duplicates` eligible-count** — both call-sites now see the updated `STATUS_FLAGS` and handle these tags correctly.

### Added
- **Format Pair Cleanup section in Prune tab** — pair-selection cards (same UI that was in Settings), "Analyze Removals" button, inline scrollable preview list (`h-64`, full search bar, no row cap), per-row reason badges, and a dedicated "Execute" button with confirmation dialog. Post-execute triggers `reapplyPreferences()` for immediate refresh.
- **`DeletionReason::FormatPairNoCounterpart`** — when a title exists only in the non-preferred folder (no counterpart in the preferred folder), it is tagged with this reason instead of `FormatPairNonPreferred`. Displayed with an amber "No counterpart" badge per row. No-counterpart items are sorted to the top of the preview list with an amber left border, amber background, and amber filename text. An amber warning banner above the list shows the count.
- **`apply_format_pairs` Tauri command** — returns a `DeletionPlan` containing only `FormatPairNonPreferred` / `FormatPairNoCounterpart` items for the selected format pair.
- **`execute_format_pairs` Tauri command** — deletes the flagged files, then inspects each source parent directory: removes visibly empty dirs (`std::fs::remove_dir_all`), and purges deleted dirs from `rom_roots` in the DB. Returns `ExecutionResult` including the new `folders_removed: Vec<String>` field. The success alert shows how many empty folders were removed from scan roots.

### Changed
- **Format Pairs moved from Settings to Prune** — the Format Pairs section is removed from Settings.tsx. Pair selection and cleanup now live entirely in the Prune tab's new Format Pair Cleanup section.
- **No-counterpart items sorted to top** — `filteredFpItems` memo sorts `FormatPairNoCounterpart` rows before `FormatPairNonPreferred` rows so the highest-risk deletions are immediately visible.

### Technical
- `score_rom()` return type: `(i32, u32)` → `(i32, u32, usize)`. All call-sites in `group.rs` use tuple comparison unchanged.
- `apply_filters_inner(groups, &settings)` — `format_prefs` and `format_pairs` parameters removed.
- `build_format_delete_map` (renamed from `build_format_delete_set`): returns `HashMap<String, DeletionReason>` instead of `HashSet<String>`.
- `delete_files_inner()` helper extracted in `execute.rs` — shared by `execute_prune` and `execute_format_pairs`.
- `ExecutionResult`: new `folders_removed: Vec<String>` field (empty `vec![]` for `execute_prune`).
- `DeletionReason`: new `FormatPairNoCounterpart` variant (serialised as `"format_pair_no_counterpart"`).
- Rust tests: 107 → 119. Vitest: 115 (mocks updated).

## [0.2.3] - 2026-06-02

### Fixed
- **Language Match always 0% after rescan** — `scan_roots` passed a clone of `roms` to `group_roms()` (which tagged the clone with `matches_preferred_language`), then stored the original untagged roms in `cache.roms`. `get_consoles()` reads from `cache.roms`, so `preferred_count` was always 0. Fixed by rebuilding `cache.roms` from group variants after merging, which carry the correct flags.
- **`scan:complete` event never fired** — Dashboard and browse tabs only refreshed via the filesystem watcher event, which doesn't always fire after a manual rescan. `scan_roots` now emits `scan:complete` on finish; `Layout.tsx` subscribes and calls `getConsoles()` + `refreshTagStore()` + `bumpCacheVersion()` unconditionally.
- **"Unl" appearing in ROMs tab Category filter** — stale `(tag_type='status', value='Unl')` row from before `CATEGORY_FLAGS` was added to the scanner. Migration 008 purges and re-inserts it as `category`. Also removed "Unl" from `STATUS_PRIORITY` in `Roms.tsx` (Unl ROMs are not served by `get_roms`).
- **Prune filter toggles resetting on restart** — filter settings were Zustand-only with no DB persistence. Added `get_filter_settings` / `save_filter_settings` Tauri commands (KV `settings` table, decoupled from `AppSettings`). Prune loads on mount and saves on each toggle.

### Added
- **Complete region → language inference map** — `parser.rs::region_default_languages` extended from 12 to 30+ regions (World, Europe, Canada, Austria, Switzerland, Belgium, Scandinavia, Finland, Mexico, Latin America, Argentina, South America, Greece, Poland, Czech Republic, Hungary, Romania, Turkey, and more). `(World)` and `(Europe)` ROMs without an explicit language tag now correctly match `preferred_languages = ["En"]`.
- **`regionUtils.ts`** — TypeScript mirror of `region_default_languages` (`REGION_DEFAULT_LANGUAGES`, `getRegionDefaultLanguages`, `getRegionsForLanguage`). Kept in sync with the Rust function.
- **Bidirectional filter chips** — Language chip in ROMs and Hacks tabs now also surfaces ROMs with no explicit language tag whose primary region infers the selected language. Region chip also matches ROMs with an explicit language but no region tag.
- **Settings inferred-regions note** — below the Preferred Languages section, each selected language shows which regions will be inferred (e.g. `En → inferred for: USA, Australia, United Kingdom, World, Europe, Canada…`).
- **Deletion reason codes** — `DeletionReason` enum (`NonPreferredLanguage`, `Prerelease`, `OlderRevision`, `Unofficial`, `FormatPairNonPreferred`, `NoPreferredVersion`) added to `models.rs`. `DeletionPlan.to_delete` is now `Vec<DeletionItem>` (was `Vec<RomFile>`). Each item carries its reason. Reason badge displayed on each row in the Prune preview.
- **Format pairs wired into `apply_filters`** — format preferences set in Settings are now enforced during pruning: variants from the non-preferred format folder are marked for deletion with reason `FormatPairNonPreferred`, unconditionally when a preference is set.
- **Prune staging area** — interactive checkboxes on each to-delete row with "Select All / Deselect All" controls. Execute and CSV export use only the checked (approved) subset.
- **Search within Prune preview** — search bar filters the to-delete list by filename or title.
- **Language Match tile breakdown tooltip** — hovering the tile shows: matched by explicit tag / matched by region inference / no match / total ROMs. `ConsoleStats` extended with `preferred_explicit_count` and `preferred_inferred_count` fields.
- **macOS universal binary** — CI now builds `--target universal-apple-darwin` (replaces separate arm64 + x86_64 builds). Eliminates the "Support Ending for Intel-based Apps" Rosetta notification on Apple Silicon. Auto-updater `latest.json` updated; both `darwin-aarch64` and `darwin-x86_64` keys point at the single universal bundle.
- **Shared sort constant** — `ROM_SORT_OPTIONS` and `RomSortKey` extracted to `src/lib/romUtils.ts`; both ROMs and Hacks tabs import from there.

### Changed
- **ROMs tab filter bar** — filter order changed from Region → Status → Language to **Category → Language → Region**. "Status" label renamed to "Category" (key unchanged). "Unl" removed from Category items (those ROMs live in Hacks & Unofficial).
- **Hacks & Unofficial tab filter bar** — filter order changed from Category → Region → Language to **Category → Language → Region**.
- **`keep_preferred_only` semantics** — now keeps exactly **one copy** per title (the highest-scored preferred variant), deleting all others including other language-matching variants. Previously, all language-matching variants were kept.
- **Prune filter toggle labels** — updated to reflect new semantics: "Keep one copy per title", "Delete if no preferred version exists", "Remove pre-release", "Remove older revisions", "Keep unofficial as fallback", "Delete ALL unofficial regardless of language". Each toggle shows a tooltip on hover.
- **CSV export** — header expanded from 5 to 10 columns: `path, filename, console, title, regions, languages, status_flags, file_category, filesize, reason`. Multi-value fields join with `|`. CSV export now includes only checked (approved) items from the staging area.

### Technical
- Migration 008: removes stale `(status, Pirate/Unl/Aftermarket/Hack)` rows and re-inserts as `(category, …)`.
- `apply_filters_inner` signature extended with `format_prefs` and `format_pairs` parameters. All existing tests updated; 4 new prune tests added.
- Rust tests: 95 → 107. Vitest: 115 (unchanged, tests updated for new types).

## [0.2.2] - 2026-06-01

### Fixed
- **Language filter contamination** — `is_language_tag()` was a heuristic (any 2–3 char uppercase-first string) that misclassified `Unl`, `Alt`, `CES`, `DSi`, `PAL`, `Wii`, `NP`, and many others as language codes. Replaced with an explicit ISO 639-1 whitelist. Migration 007 cleans existing `known_tags` rows and pre-seeds `Unl`/`Alt` as status-type tags so filter chips are immediately correct.
- **`Unl`-only ROMs missing from Hacks & Unofficial** — because `Unl` was misclassified as a language, files tagged only `(Unl)` (without `Aftermarket` or `Pirate`) were silently categorised as `FileCategory::Game`. After rescan they now correctly appear in Hacks & Unofficial.
- **`Alt` missing from Status filter** — `Alt` was not in `STATUS_FLAGS`; it now is, so it appears in the Status filter alongside Beta, Proto, Unl, etc.
- **Black placeholder box on expanded ROM rows** — `RomThumbnail` rendered a visible `bg-muted/40` div when no thumbnail was available. It now returns `null` — no box, no gap.
- **Duplicates tab showed format pairs** — `get_duplicates()` unconditionally included all `is_format_pair` groups. Format pairs (FDS/QD, Headered/Headerless) are not true duplicates; they are now excluded. Prune handles format-pair preferences as before.

### Changed
- **Hacks & Unofficial tab layout** — refactored from a flat per-variant list to the same grouped, expandable layout as the ROMs tab: one collapsible row per canonical title, variants shown on expand. Category badge (Aftermarket / Pirate / Hack / Unl) appears on the left of each group header. Full feature parity with ROMs: virtualisation, lazy thumbnails, console badge in All-Hacks mode, format-pair sub-headers, "Most variants" sort option, priority-ordered Category filter.
- **Duplicates tab redesign** — preferred variant is now clearly marked with a green left border and ✓ KEEP chip. When no preferred version is detected (`preferred_idx = null`), an amber warning is shown. Button renamed from "Keep preferred, mark others for deletion" to "Confirmed — keep preferred" (or "Queue for Prune — manual" when no preferred). Helper text clarifies that Prune performs the actual deletion.
- **`RomThumbnail` extracted** to `src/components/RomThumbnail.tsx` — shared between ROMs and Hacks & Unofficial tabs.

### Added
- 4 new Rust parser tests: `(Unl)` → Unofficial, `(Alt)` → status flag, `(CES)` → extra tag, `(DSi Enhanced)` → extra tag

## [0.2.1] - 2026-06-01

### Fixed
- **App icon on white backgrounds** — icon canvas was transparent, causing the cartridge to float on a white background in Finder, DMG windows, and any non-Dock context. Canvas is now solid dark navy (`BODY_BOT`); macOS/Windows/Linux apply their own platform rounding. All icon sizes regenerated.

## [0.2.0] - 2026-06-01

### Added
- **Dashboard overhaul** — 5 stat tiles: Total ROMs, Consoles (aggregated canonical count), Platforms (new), Collection Size, Language Match; all tiles are linked and navigate to the relevant filtered view
- **Cross-console title merging** — `merge_format_pairs()` in `group.rs` collapses same-title groups across paired console folders (FDS + QD, Headered + Headerless, BigEndian + ByteSwapped) into one `RomGroup`; expanded view shows per-format sub-headers (e.g. FDS / QD)
- **Console abbreviation badge in All-ROMs mode** — ROMs tab shows a short console badge (N64, GBA…) on each row when no console is selected, so same-title entries from different consoles are distinguishable
- **Collapsible FilterBar component** — `src/components/FilterBar.tsx` replaces flat chip rows on the ROMs and Hacks & Unofficial tabs; three buttons (Region ▾ / Status ▾ / Language ▾) open inline chip panels with active-count badges and per-panel Clear action
- **Status filter priority order** — Beta → Proto → Demo → Sample → Kiosk → Promo → Alt → Unl, then alphabetical, matching No-Intro release-quality convention
- **System Files per-category toggle** — "Show all / Show fewer" toggle per category; pagination cap raised so all entries are reachable
- **Dashboard CONSOLES section** — collapsible platform headers with per-console stat cards; replaces the removed Consoles tab

### Changed
- **Consoles tab removed** — its browse, search, sort, and collapse UI merged into the Dashboard CONSOLES section; tab count is now 8
- **Console display names** — sidebar tooltips and card headings now show canonical names without variant suffixes (e.g. "Family Computer Disk System" not "Family Computer Disk System (FDS)")
- **`group_matches_consoles()` replaces `console_matches()`** across all 5 Rust browse commands (`get_roms`, `get_unofficial`, `get_system_files`, `get_duplicates`, `apply_filters` in prune.rs) so merged cross-console groups are filtered correctly
- **ROM browsing cap raised** — `ALL_GROUPS` limit raised from 9,999 → 100,000 in both `Roms.tsx` and `HacksUnofficial.tsx`; System Files `perPage` raised to 9,999

### Fixed
- **Abbreviation corrections** — Pokémon Mini (é vs e encoding mismatch) now correctly resolves to "PM"; Master System → SMS; PlayStation → PSX; PlayStation Vita → PSV
- **GBA BIOS visibility** — `perPage` cap that hid the GBA BIOS entry in System Files is resolved by the raised limit above

## [0.1.1] - 2026-05-31

### Added
- Collapsible sidebar icon rail: collapse to a `w-10` icon strip with tooltip labels and active-tab highlight; expand/collapse via `PanelLeftClose` / `PanelLeft` buttons; `sidebarOpen` state in `ui.ts` store
- Settings page footer: version, author, GitHub link, and license line
- `__APP_VERSION__` Vite define injected from `package.json`; typed in `vite-env.d.ts`
- Games tab: "No games found" empty state (was missing)
- `scripts/generate_icon.py`: canonical icon generator (dark navy-indigo gradient cartridge, ROMulus wordmark ROM=white/ulus=gold, "Collection Hub" subtitle)
- **Allow permanent delete** — full-stack opt-in: `AppSettings.allow_permanent_delete`, migration `004_permanent_delete.sql`, `save_settings` persists the flag, red `data-[state=checked]:bg-destructive` Switch in Settings → Danger Zone, wired in Prune's execute flow with matching dialog label
- Settings: icons added to Appearance (`Monitor`), Privacy (`ShieldCheck`), and Danger Zone (`AlertTriangle`) section titles for visual consistency
- Prune: "Hide preview" toggle (EyeOff icon) and `×` close button in preview pane header so the plan can be dismissed without re-running filters
- Test suite: Vitest configured with jsdom + `@testing-library/react`; 15 Settings tests, 14 Prune tests; 5 new Rust unit tests for settings persistence (65 Rust total, 29 frontend)

### Fixed
- **ROM root persistence** (critical): `save_settings` now syncs the `rom_roots` table (DELETE + re-INSERT) — folders no longer vanished on navigation
- **Recursive scanner**: replaced two-step scan (`scan_all_roots` + `scan_console_dir`) with a single `WalkDir` recursive walk; console name = immediate parent directory of each ROM file; supports any nesting depth below the root (flat, one-level, multi-level all work)
- Region priority reorder in Settings now uses `@dnd-kit/core` PointerSensor + SortableContext — replaced broken native HTML5 drag that did not fire in WKWebView
- All 9 tab headers use `h-14 flex items-center` (56 px) for a pixel-exact divider match with the sidebar header at every resolution

### Changed
- **App icon redesigned** — dark navy-indigo gradient cartridge fills the canvas; inline wordmark with ROM=white and ulus=gold; "Collection Hub" subtitle; underline rule below text; all platform sizes regenerated
- Settings: ROM Libraries section promoted to first position
- Settings: "Allow permanent delete" and Prune's "Delete ALL unofficial" Switches both use `data-[state=checked]:bg-destructive` red styling
- Prune: execute confirm dialog and button label now reflect trash vs. permanent delete mode
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
