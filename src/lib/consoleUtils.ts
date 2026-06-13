/**
 * Console grouping utilities — single source of truth for all console data/logic.
 *
 * No-Intro folder names follow "Platform - Console Name (Variant)".
 * These helpers extract semantic parts, strip variant suffixes, resolve aliases,
 * and provide display-name formatting used across all tabs.
 */

import { siSega, siSony, siAtari, siPlaystation } from "simple-icons";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

// ── Variant suffix list ───────────────────────────────────────────────────────

const VARIANT_SUFFIXES = [
  // Famicom Disk System media formats
  " (FDS)",
  " (QD)",
  // Game Boy Advance special cart types
  " (Multiboot)",
  " (Video)",
  " (e-Reader)",
  " (Play-Yan)",          // GBA MP3/video player accessory
  // Nintendo 64 byte-order variants
  " (BigEndian)",
  " (ByteSwapped)",
  // NES ROM header variants
  " (Headered)",
  " (Headerless)",
  // Nintendo DS / 3DS / DSi encryption + distribution variants
  " (Encrypted)",
  " (Decrypted)",
  " (Download Play)",
  " (Digital)",
  " (CDN)",
  " (SpotPass)",           // 3DS SpotPass DLC
  " (Pre-Install)",        // pre-installed software
  " (Dev ROMs)",           // development ROMs
  " (Lotcheck)",           // Wii U CDN Lotcheck build
  " (Dev)",                // Wii U CDN Dev build
  " (DSvision SD cards)",  // DS DSvision
  " (Updates and DLC)",    // 3DS/Wii update content
  " (Split DLC)",          // Wii Split DLC packages
  " (WAD)",                // Wii WAD packages
  // Nintendo kiosk / GameCube special media
  " (CardImage)",          // Kiosk Video Compact Flash
  " (Extracted)",          // Kiosk extracted files
  " (Memory Card)",        // GameCube Memory Card dumps
  " (NPDP Carts)",         // GameCube NPDP dev carts
  " (Starlight Fun Center)", // Wii kiosk
  " (Mario no Photopi SmartMedia)", // N64 special
  // Nintendo audio content
  " (M4A)",
  " (Tracks)",
  // PlayStation distribution variants (PSP / PS3 / Vita)
  " (PSN)",
  " (NoNpDrm)",
  " (PSVgameSD)",
  " (Minis)",
  " (UMD Video)",
  " (UMD Music)",
  " (PS one Classics)",    // PS1 PSN classics
  " (Avatars)",            // PS3 PSN Avatars
  " (Content)",            // PS3/Vita PSN Content
  " (DLC)",                // PS3 PSN DLC
  " (Themes)",             // PS3 PSN Themes
  " (Updates)",            // PS3/Vita PSN Updates
  // Sony Vita / PSP unofficial formats
  " (BlackFinPSV)",
  " (VPK)",
  " (PSX2PSP)",
  " (BD-Video Extras)",
  // Xbox 360 digital storefronts
  " (Games on Demand)",
  " (XBLA)",
  " (Title Updates)",      // Xbox 360 title updates
  // Content-category variants (same hardware, different ROM set status)
  " (Aftermarket)",
  " (Private)",
  // Atari container formats
  " (A78)",                // Atari 7800
  " (LNX)",                // Atari Lynx
  " (LYX)",                // Atari Lynx alternate
  " (BLL)",                // Atari Lynx binary
  " (JAG)",                // Atari Jaguar
  " (J64)",                // Atari Jaguar
  " (ROM)",                // Atari Jaguar ROM
  " (ABS)",                // Atari Jaguar absolute binary
  " (COF)",                // Atari Jaguar COFF
  " (BIN)",                // raw binary (Atari, Bandai Little Jammer, Toshiba)
  // Commodore
  " (PP)",                 // Commodore 64 PowerPacker
  // Casio Loopy byte-order
  " (LittleEndian)",
  // NEC disk formats
  " (Greaseweazle)",       // Greaseweazle disk preservation
  " (HardDisk)",
  " (HDM)",                // hard disk image
  // Floppy/tape preservation formats
  " (Flux)",
  " (A2R)",                // Applesauce (Apple II)
  " (WOZ)",                // WOZ (Apple II/IIGS)
  " (Kryoflux)",
  " (KryoFlux)",
  " (IPF)",                // Interchangeable Preservation Format
  " (SCP)",                // SuperCard Pro
  " (Bitstream)",
  " (Sector)",
  " (DC42)",               // Apple DiskCopy 4.2
  " (Floppies)",           // Pippin floppy dumps
  " (FluxDumps)",          // Apple Macintosh BETA flux
  " (BETA)",               // Apple Macintosh BETA releases
  // Tape/audio formats
  " (Tapes)",
  " (Waveform)",
  " (WAV)",
  // Sega special hardware accessories
  " (Visual Memory Unit)", // Dreamcast VMU
  " (Development Kit Hard Drives)",
  // Preservation / content formats
  " (WARC)",               // Super Mario Maker archive
  " (Mame)",               // MAME format (Nichibutsu)
  " (PDF)",
  " (CBZ)",                // Comic Book archive
  " (RAW)",
  " (JPEG)",
  " (Playbutton)",         // Video Game OSTs Playbutton
  " (Catalog)",            // Panic Playdate catalog
  " (itch.io)",            // Panic Playdate itch.io distribution
  " (APK)",                // Android package
  " (Amazon Appstore)",
  " (Google Play Store)",
  " (Samsung Galaxy Apps)",
  // Deprecation / misc
  " (WIP)",
  " (Deprecated)",
  " (Uncategorized)",
  " (Misc)",
  " (Various)",
  // IBM PC digital storefronts (each stripped so all collapse to "PC and Compatibles")
  " (Tiger Electronics - Net Jet)", // full parenthetical preserves closing paren
  " (Steam)",
  " (GOG)",
  " (Epic Games Launcher)",
  " (Humble Bundle)",
  " (GamersGate)",
  " (Microsoft Store)",
  " (Amazon)",
  " (BOOTH)",
  " (Ci-en)",
  " (DLsite)",
  " (Denpasoft)",
  " (Desura)",
  " (FANZA)",
  " (Freem!)",
  " (Getchu.com)",
  " (Groupees)",
  " (JAST USA)",
  " (Johren)",
  " (Kagura Games)",
  " (MangaGamer)",
  " (NovelGameCollection)",
  " (Games for Windows Live)",
  " (Games for Windows Marketplace)",
  " (Press Kits)",
  " (LooseFilesArchive)",
  " (Flash)",
  " (Doujin)",
  " (Hentai)",
  " (Unknown)",
  " (Spillover Tracks)",
] as const;

// ── Category prefixes that precede "Platform - Console" sub-structure ─────────
// Folders: "Non-Redump - Platform - Console", "Unofficial - Platform - Console", etc.
// getShortConsoleName uses lastIndexOf for these to return the actual console name.

const META_PREFIXES = new Set([
  "Non-Redump",
  "Unofficial",
  "Source Code",
  "TEMP",
  "Various",
]);

// ── Alias map: separate products grouped under one canonical console ──────────
// Distinct from VARIANT_SUFFIXES: aliases are separate hardware (N64DD has
// different games) but we group them for browsing.

const CONSOLE_ALIASES: Record<string, string> = {
  "Nintendo 64DD":          "Nintendo 64",
  // SNK: Minerva uses "NeoGeo" (no space); ABBREV has "Neo Geo" (with space)
  "NeoGeo Pocket":          "Neo Geo Pocket",
  "NeoGeo Pocket Color":    "Neo Geo Pocket Color",
  // Non-Redump entries expose "Manufacturer ConsoleX" names after prefix-stripping
  "Sega Saturn":            "Saturn",
  "Nintendo GameCube":      "GameCube",
  "Sega Mega CD + Sega CD": "Mega-CD",
};

// ── Platform metadata ─────────────────────────────────────────────────────────

export interface PlatformInfo {
  name: string;
  color: string;
  siIcon?: { path: string; hex: string };
}

export const PLATFORMS: Record<string, PlatformInfo> = {
  nintendo:    { name: "Nintendo",    color: "#E4000F" },
  sega:        { name: "Sega",        color: "#0066B3", siIcon: siSega },
  sony:        { name: "Sony",        color: "#003087", siIcon: siSony },
  playstation: { name: "PlayStation", color: "#003791", siIcon: siPlaystation },
  atari:       { name: "Atari",       color: "#FF6600", siIcon: siAtari },
  snk:         { name: "SNK",         color: "#C8102E" },
  microsoft:   { name: "Microsoft",   color: "#00A4EF" },
  commodore:   { name: "Commodore",   color: "#0043A0" },
  nec:         { name: "NEC",         color: "#CC0000" },
  bandai:      { name: "Bandai",      color: "#E4000F" },
  apple:       { name: "Apple",       color: "#555555" },
  panasonic:   { name: "Panasonic",   color: "#0044CC" },
  sharp:       { name: "Sharp",       color: "#CC2200" },
  other:       { name: "Other",       color: "#6B7280" },
};

export function detectPlatform(folder: string): keyof typeof PLATFORMS {
  const l = folder.toLowerCase();
  if (l.startsWith("nintendo"))  return "nintendo";
  if (l.startsWith("sega"))      return "sega";
  if (l.startsWith("sony"))      return l.includes("playstation") ? "playstation" : "sony";
  if (l.startsWith("atari"))     return "atari";
  if (l.startsWith("snk"))       return "snk";
  if (l.startsWith("microsoft")) return "microsoft";
  if (l.startsWith("commodore")) return "commodore";
  if (l.startsWith("nec"))       return "nec";
  if (l.startsWith("bandai"))    return "bandai";
  if (l.startsWith("apple"))     return "apple";  // also catches "apple-bandai"
  if (l.startsWith("panasonic")) return "panasonic";
  if (l.startsWith("sharp"))     return "sharp";
  return "other";
}

// ── Console abbreviation map ──────────────────────────────────────────────────

export const ABBREV: Record<string, string> = {
  // ── Nintendo ─────────────────────────────────────────────────────────────────
  "Game Boy":                                    "GB",
  "Game Boy Color":                              "GBC",
  "Game Boy Advance":                            "GBA",
  "Game Boy Advance (Multiboot)":                "GBA",
  "Game Boy Advance (Video)":                    "GBA",
  "Game Boy Advance (e-Reader)":                 "GBA",
  "Nintendo Entertainment System":               "NES",
  "Nintendo Entertainment System (Headered)":    "NES",
  "Nintendo Entertainment System (Headerless)":  "NES",
  "Super Nintendo Entertainment System":         "SNES",
  "Nintendo 64":                                 "N64",
  "Nintendo 64 (BigEndian)":                     "N64",
  "Nintendo 64 (ByteSwapped)":                   "N64",
  "Nintendo 64DD":                               "64DD",
  "Family Computer Disk System":                 "FDS",
  "Family Computer Disk System (FDS)":           "FDS",
  "Family Computer Disk System (QD)":            "FDS",
  "Family Computer":                             "FC",
  "Family Computer Network System":              "FCNS",
  "Family BASIC":                                "FBASIC",
  "Virtual Boy":                                 "VB",
  "Pokemon Mini":                                "PM",
  "Satellaview":                                 "BSX",
  "Sufami Turbo":                                "SFT",
  "Game & Watch":                                "GW",
  "Wii":                                         "Wii",
  "Wii U":                                       "WiiU",
  "GameCube":                                    "GCN",
  "Nintendo GameCube":                           "GCN",   // Non-Redump prefix-stripped name
  "Nintendo DS":                                 "NDS",
  "Nintendo DSi":                                "DSi",
  "Nintendo 3DS":                                "3DS",
  "New Nintendo 3DS":                            "N3DS",
  "Nintendo Switch":                             "NSW",
  "Nintendo Music":                              "NM",
  "Kiosk Video Compact Flash":                   "KVFC",
  "amiibo":                                      "amiibo",
  "Misc":                                        "MISC",
  "Wallpapers":                                  "WALL",
  "SDKs":                                        "SDK",

  // ── Sega ──────────────────────────────────────────────────────────────────────
  "Master System - Mark III":                    "SMS",
  "Master System":                               "SMS",
  "Game Gear":                                   "GG",
  "Mega Drive - Genesis":                        "MD",
  "Mega Drive":                                  "MD",
  "Mega-CD":                                     "MCD",
  "Mega-CD 32X":                                 "MCD32",
  "32X":                                         "32X",
  "Saturn":                                      "SAT",
  "Sega Saturn":                                 "SAT",   // Non-Redump prefix-stripped
  "Dreamcast":                                   "DC",
  "DreamCast":                                   "DC",    // Source Code - Sega - DreamCast casing
  "SG-1000":                                     "SG1K",
  "SG-1000 - SC-3000":                           "SG1K",  // required after indexOf fix
  "PICO":                                        "PICO",
  "Beena":                                       "BNA",
  "Sega Mega CD + Sega CD":                      "MCD",   // Non-Redump combined DAT (pre-alias)
  "ALLS":                                        "SGALLS",
  "Nu":                                          "SGNU",
  "Nu 1.1":                                      "SGNU11",
  "Nu 2":                                        "SGNU2",
  "Nu SX":                                       "SGNUX",
  "Sega NAOMI Satellite Terminal PC":            "NAOMI",

  // ── Sony ──────────────────────────────────────────────────────────────────────
  "PlayStation":                                 "PSX",
  "PlayStation 2":                               "PS2",
  "PlayStation 3":                               "PS3",
  "PlayStation 4":                               "PS4",
  "PlayStation Portable":                        "PSP",
  "PlayStation Vita":                            "PSV",
  "PlayStation Mobile":                          "PSM",

  // ── NEC ───────────────────────────────────────────────────────────────────────
  "PC Engine":                                   "PCE",
  "PC Engine - TurboGrafx-16":                   "PCE",   // required after indexOf fix
  "PC Engine CD":                                "PCECD",
  "PC Engine CD + TurboGrafx CD":               "PCECD",  // Non-Redump combined DAT
  "PC Engine SuperGrafx":                        "SGX",
  "SuperGrafx":                                  "SGX",
  "PC-FX":                                       "PCFX",
  "PC-88":                                       "PC88",
  "PC-98":                                       "PC98",

  // ── Atari ─────────────────────────────────────────────────────────────────────
  // Modern No-Intro naming uses "Atari X"; keep legacy keys for older-style folders
  "2600":                                        "2600",
  "Atari 2600":                                  "2600",
  "5200":                                        "5200",
  "Atari 5200":                                  "5200",
  "7800":                                        "7800",
  "Atari 7800":                                  "7800",
  "8-bit Family":                                "A8",
  "Jaguar":                                      "JAG",
  "Atari Jaguar":                                "JAG",
  "Atari Jaguar CD":                             "JAGCD",
  "Lynx":                                        "LYNX",
  "Atari Lynx":                                  "LYNX",
  "ST":                                          "AST",
  "Atari ST":                                    "AST",

  // ── SNK ───────────────────────────────────────────────────────────────────────
  "Neo Geo Pocket":                              "NGP",
  "NeoGeo Pocket":                               "NGP",
  "Neo Geo Pocket Color":                        "NGPC",
  "NeoGeo Pocket Color":                         "NGPC",
  "Neo Geo CD":                                  "NGCD",

  // ── Bandai ────────────────────────────────────────────────────────────────────
  "WonderSwan":                                  "WS",
  "WonderSwan Color":                            "WSC",
  "Design Master Denshi Mangajuku":              "DMDM",
  "Gundam RX-78":                                "GRX",
  "Bandai Little Jammer":                        "BLJ",   // no " - " separator; full name is key
  "Bandai Little Jammer Pro":                    "BLJP",

  // ── Microsoft ─────────────────────────────────────────────────────────────────
  "Xbox":                                        "XBX",
  "Xbox 360":                                    "X360",
  "XBOX 360":                                    "X360",
  "MSX":                                         "MSX",
  "MSX 2":                                       "MSX2",
  "MSX2":                                        "MSX2",  // Minerva: "Microsoft - MSX2"

  // ── Panasonic / 3DO ───────────────────────────────────────────────────────────
  "3DO Interactive Multiplayer":                 "3DO",

  // ── Philips ───────────────────────────────────────────────────────────────────
  "CD-i":                                        "CDi",
  "Videopac+":                                   "VDP",

  // ── Commodore ─────────────────────────────────────────────────────────────────
  "64":                                          "C64",
  "Commodore 64":                                "C64",   // "Commodore - Commodore 64"
  "Amiga":                                       "AMI",
  "Amiga CD":                                    "AMICD", // Non-Redump - Commodore - Amiga CD
  "Plus-4":                                      "PL4",
  "VIC-20":                                      "VIC",

  // ── Apple ─────────────────────────────────────────────────────────────────────
  "I":                                           "A1",    // Apple - I (Tapes)
  "II":                                          "A2",
  "II Plus":                                     "A2P",
  "IIe":                                         "A2E",
  "IIGS":                                        "A2GS",
  "Macintosh":                                   "MAC",
  "Pippin":                                      "PIP",   // Apple-Bandai - Pippin

  // ── Amstrad ───────────────────────────────────────────────────────────────────
  "CPC":                                         "CPC",

  // ── Acorn ─────────────────────────────────────────────────────────────────────
  "Archimedes":                                  "ARCH",
  "Atom":                                        "ATOM",
  "Risc PC":                                     "RPC",
  "Flash Media":                                 "FMD",   // Acorn RISC OS Flash Media

  // ── APF ───────────────────────────────────────────────────────────────────────
  "Imagination Machine":                         "APFM",
  "MP-1000":                                     "MP1K",

  // ── Analogue ──────────────────────────────────────────────────────────────────
  "Analogue Pocket":                             "APCK",

  // ── Arduboy ───────────────────────────────────────────────────────────────────
  "Arduboy":                                     "ABY",

  // ── Bally ─────────────────────────────────────────────────────────────────────
  "Astrocade":                                   "BALY",  // avoid "AST" — conflicts with Atari ST

  // ── Benesse ───────────────────────────────────────────────────────────────────
  "Pocket Challenge V2":                         "PCV2",
  "Pocket Challenge W":                          "PCW",

  // ── Bit Corporation ───────────────────────────────────────────────────────────
  "Gamate":                                      "GAM",

  // ── Blaze Entertainment ───────────────────────────────────────────────────────
  "Evercade":                                    "EVC",

  // ── Casio ─────────────────────────────────────────────────────────────────────
  "Loopy":                                       "LOOP",
  "PV-1000":                                     "PV1K",

  // ── Coleco ────────────────────────────────────────────────────────────────────
  "ColecoVision":                                "CV",

  // ── Emerson ───────────────────────────────────────────────────────────────────
  "Arcadia 2001":                                "ARC2",

  // ── Entex ─────────────────────────────────────────────────────────────────────
  "Adventure Vision":                            "ADVS",

  // ── Epoch ─────────────────────────────────────────────────────────────────────
  "Game Pocket Computer":                        "GPC",
  "Super Cassette Vision":                       "SCV",

  // ── Fujitsu ───────────────────────────────────────────────────────────────────
  "FM Towns":                                    "FMT",
  "FM-7":                                        "FM7",
  "FMR50":                                       "FMR5",

  // ── Fukutake Publishing ───────────────────────────────────────────────────────
  "StudyBox":                                    "SB",

  // ── Funtech ───────────────────────────────────────────────────────────────────
  "Super Acan":                                  "SCA",

  // ── GamePark ──────────────────────────────────────────────────────────────────
  "GP32":                                        "GP32",
  "GP2X":                                        "GP2X",

  // ── GCE ───────────────────────────────────────────────────────────────────────
  "Vectrex":                                     "VEC",

  // ── Google ────────────────────────────────────────────────────────────────────
  "Android":                                     "AND",

  // ── Hartung ───────────────────────────────────────────────────────────────────
  "Game Master":                                 "GM",

  // ── Hitachi ───────────────────────────────────────────────────────────────────
  "S1":                                          "HS1",

  // ── IBM / PC ──────────────────────────────────────────────────────────────────
  "PC and Compatibles":                          "PC",
  "PC Compatible (Discs)":                       "PCCD",  // Non-Redump - IBM - PC Compatible

  // ── iQue ──────────────────────────────────────────────────────────────────────
  "iQue":                                        "IQUE",

  // ── Interton ──────────────────────────────────────────────────────────────────
  "VC 4000":                                     "VC4K",

  // ── Konami (arcade) ───────────────────────────────────────────────────────────
  "Picno":                                       "PCN",
  "M2":                                          "KM2",
  "Python 2":                                    "KPY2",

  // ── Capcom (arcade) ───────────────────────────────────────────────────────────
  "Play System III":                             "CPS3",

  // ── LeapFrog ──────────────────────────────────────────────────────────────────
  "Explorer":                                    "LFE",
  "LeapPad":                                     "LPD",
  "Leapster Learning Game System":               "LLS",

  // ── Luxor ─────────────────────────────────────────────────────────────────────
  "ABC 800":                                     "ABC8",

  // ── Magnavox ──────────────────────────────────────────────────────────────────
  "Odyssey 2":                                   "O2",

  // ── Mattel ────────────────────────────────────────────────────────────────────
  "Intellivision":                               "INTV",

  // ── Merit ─────────────────────────────────────────────────────────────────────
  "Merit Megatouch":                             "MGT",

  // ── Milton-Bradley ────────────────────────────────────────────────────────────
  "Omni":                                        "MBO",

  // ── Mobile ────────────────────────────────────────────────────────────────────
  "J2ME":                                        "J2ME",
  "Palm OS":                                     "PALM",
  "Pocket PC":                                   "PPC",
  "Symbian":                                     "SYM",

  // ── Nichibutsu ────────────────────────────────────────────────────────────────
  "My Vision":                                   "MYV",

  // ── Nokia ─────────────────────────────────────────────────────────────────────
  "N-Gage":                                      "NGE",   // "(WIP)" stripped by VARIANT_SUFFIXES

  // ── Non-Redump arcade / special hardware ──────────────────────────────────────
  "Game Wave Family Entertainment System":       "GWFE",
  "iON Educational Gaming System":               "ION",
  "Purikura":                                    "PKR",   // FuRyu & Omron / Namco photo booth
  "Polymega":                                    "POLY",
  "Zaurus":                                      "ZAUR",

  // ── Ouya ──────────────────────────────────────────────────────────────────────
  "Ouya":                                        "OUYA",

  // ── Panic ─────────────────────────────────────────────────────────────────────
  "Playdate":                                    "PD",

  // ── RCA ───────────────────────────────────────────────────────────────────────
  "Studio II":                                   "RCA2",

  // ── Fairchild ─────────────────────────────────────────────────────────────────
  "Channel F":                                   "CHF",

  // ── Sanyo ─────────────────────────────────────────────────────────────────────
  "MBC-550":                                     "MBC5",

  // ── Seta (arcade) ─────────────────────────────────────────────────────────────
  "Aleck64":                                     "A64",   // N64-based arcade system

  // ── Sharp ─────────────────────────────────────────────────────────────────────
  "MZ-700":                                      "MZ7",
  "MZ-2200":                                     "MZ22",
  "X1":                                          "SX1",
  "X68000":                                      "X68K",

  // ── Sinclair ──────────────────────────────────────────────────────────────────
  "ZX Spectrum +3":                              "ZX3",

  // ── TeleNova ──────────────────────────────────────────────────────────────────
  "Compis":                                      "CPS",

  // ── Texas Instruments ─────────────────────────────────────────────────────────
  "TI-99-4A":                                    "TI99",

  // ── Tiger ─────────────────────────────────────────────────────────────────────
  "Game.com":                                    "GCO",
  "Gizmondo":                                    "GZM",

  // ── Toshiba ───────────────────────────────────────────────────────────────────
  "Pasopia":                                     "PAS",   // (BIN) and (WAV) strip away
  "Visicom":                                     "VSC",

  // ── VM Labs ───────────────────────────────────────────────────────────────────
  "NUON":                                        "NUON",

  // ── VTech ─────────────────────────────────────────────────────────────────────
  "CreatiVision":                                "CVS",
  "V.Smile":                                     "VSM",

  // ── Watara ────────────────────────────────────────────────────────────────────
  "Supervision":                                 "SVN",

  // ── Welback ───────────────────────────────────────────────────────────────────
  "Mega Duck":                                   "MDK",

  // ── Yamaha ────────────────────────────────────────────────────────────────────
  "Copera":                                      "COP",

  // ── Zeebo ─────────────────────────────────────────────────────────────────────
  "Zeebo":                                       "ZBO",

  // ── Unofficial content (after META_PREFIX strip) ──────────────────────────────
  "Obscure Gamers":                              "OBG",
  "Super Mario Maker Courses":                   "SMMC",
  "Video Game Documents":                        "VGD",
  "Video Game Magazine Scans":                   "VGMG",
  "Video Game Manual Scans":                     "VGMAN",
  "Video Game OSTs":                             "VGOST",
  "Video Game Scans":                            "VGSCN",

  // ── Source Code edge cases ────────────────────────────────────────────────────
  "Various":                                     "VAR",   // "Source Code - Various"

  // ── Optical / digital media formats (no " - " separator) ─────────────────────
  "Audio CD":                                    "ACD",
  "BD-Video":                                    "BDV",
  "CD+G":                                        "CDG",
  "CD-ROM":                                      "CDROM",
  "DVD-Audio":                                   "DVDA",
  "DVD-ROM":                                     "DVDR",
  "DVD-Video":                                   "DVDV",
  "Enhanced CD":                                 "ECD",
  "HD DVD":                                      "HDDV",
  "MP3 CD":                                      "MP3C",
  "MovieCD":                                     "MVCD",
  "SACD":                                        "SACD",
  "UHD-BD":                                      "UHDB",
  "Video CD":                                    "VCD",

  // ── Misc / digital distribution ───────────────────────────────────────────────
  "Project EGG":                                 "EGG",
  "itch.io":                                     "ITCH",
  "Humble Play":                                 "HPL",
  "Apricot PC Xi":                               "APCX",
  "Firecore":                                    "FRC",   // Digital Media Cartridge - Firecore
};

export function getAbbrev(consoleName: string): string {
  const short = getShortConsoleName(consoleName);
  const canonical = getCanonicalConsoleName(short);
  return ABBREV[short] ?? ABBREV[canonical] ?? short.slice(0, 4).toUpperCase();
}

/**
 * Like getAbbrev, but preserves the parenthetical format suffix so paired
 * folders are always distinguishable in the UI:
 *   "Nintendo - Family Computer Disk System"       → "FDS"
 *   "Nintendo - Family Computer Disk System (QD)"  → "FDS (QD)"
 *   "Nintendo - Nintendo 64 (ByteSwapped)"         → "N64 (ByteSwapped)"
 */
export function getFormatVariantLabel(folder: string): string {
  const short = getShortConsoleName(folder);
  // Strip ALL trailing parentheticals to reach the pure console base name so that
  // multi-suffix folders like "Game Boy Advance (e-Reader) (Aftermarket)" look up
  // ABBREV["Game Boy Advance"] → "GBA" and re-attach "(e-Reader) (Aftermarket)" as
  // the full suffix — not just "(Aftermarket)" — preventing label collisions.
  const base = stripAllTrailingParens(short);
  const suffix = short.slice(base.length).trim(); // e.g. "(e-Reader) (Aftermarket)"
  const canonical = getCanonicalConsoleName(base);
  const abbrev = ABBREV[base] ?? ABBREV[canonical] ?? base.slice(0, 4).toUpperCase();
  return suffix ? `${abbrev} ${suffix}` : abbrev;
}

function stripAllTrailingParens(name: string): string {
  let result = name.trim();
  while (result.endsWith(")")) {
    const idx = result.lastIndexOf("(");
    if (idx < 0) break;
    result = result.slice(0, idx).trim();
  }
  return result;
}

export function getShortLabel(folder: string): string {
  return getShortConsoleName(folder);
}

/** Returns the accent hex color for a console folder name. */
export function getConsoleColor(consoleName: string): string {
  return PLATFORMS[detectPlatform(consoleName)].color;
}

// ── Name extraction helpers ───────────────────────────────────────────────────

/**
 * Returns the platform name — the part before " - " in a console folder name.
 *
 * @example
 * getPlatform("Nintendo - Game Boy")  // → "Nintendo"
 * getPlatform("Sega")                 // → "Sega"  (fallback to full name)
 */
export function getPlatform(name: string): string {
  return name.split(" - ")[0] ?? name;
}

/**
 * Returns the short console name — the meaningful console part of a No-Intro
 * folder name, with two structural fixes over a naive split:
 *
 * 1. Uses indexOf (not split[1]) to avoid severing parentheticals that contain
 *    " - " (e.g. "IBM - PC and Compatibles (Tiger Electronics - Net Jet)").
 *
 * 2. For META_PREFIX folders ("Non-Redump - Platform - Console", etc.) uses
 *    lastIndexOf to return the final segment (the actual console name):
 *      "Non-Redump - Sega - Nu"  →  "Nu"
 *      "Source Code - Nintendo - Nintendo - Game Boy Color"  →  "Game Boy Color"
 *
 * @example
 * getShortConsoleName("Nintendo - Game Boy Advance")  // → "Game Boy Advance"
 * getShortConsoleName("Sega - Master System - Mark III")  // → "Master System - Mark III"
 * getShortConsoleName("Non-Redump - Nintendo - Nintendo GameCube")  // → "Nintendo GameCube"
 */
export function getShortConsoleName(name: string): string {
  const firstDash = name.indexOf(" - ");
  if (firstDash === -1) return name;
  const prefix = name.slice(0, firstDash);
  if (META_PREFIXES.has(prefix)) {
    const lastDash = name.lastIndexOf(" - ");
    return name.slice(lastDash + 3);
  }
  return name.slice(firstDash + 3);
}

/**
 * Returns the canonical console name with known variant suffixes stripped and
 * console aliases resolved (works on both short names and full folder names).
 *
 * When called via getConsoleParts the input is the short name (after " - ").
 * When called directly with a full folder name, suffixes are still stripped.
 *
 * @example
 * getCanonicalConsoleName("Game Boy Advance (Multiboot)")  // → "Game Boy Advance"
 * getCanonicalConsoleName("Nintendo 64DD")                 // → "Nintendo 64"  (alias)
 * getCanonicalConsoleName("Nintendo - Game Boy Advance (Multiboot)")  // → "Nintendo - Game Boy Advance"
 */
export function getCanonicalConsoleName(name: string): string {
  if (CONSOLE_ALIASES[name]) return CONSOLE_ALIASES[name]!;
  for (const suffix of VARIANT_SUFFIXES) {
    if (name.endsWith(suffix)) {
      // recurse so multi-suffix names like "3DS (Digital) (Decrypted)" collapse fully
      return getCanonicalConsoleName(name.slice(0, name.length - suffix.length));
    }
  }
  return name;
}

/**
 * Splits a full No-Intro folder name into platform + canonical console name.
 *
 * @example
 * getConsoleParts("Nintendo - Game Boy Advance (Multiboot)")
 * // → { platform: "Nintendo", canonical: "Game Boy Advance" }
 *
 * getConsoleParts("Nintendo - Nintendo 64DD")
 * // → { platform: "Nintendo", canonical: "Nintendo 64" }  (via CONSOLE_ALIASES)
 */
export function getConsoleParts(fullName: string): { platform: string; canonical: string } {
  const idx = fullName.indexOf(" - ");
  if (idx === -1) {
    return { platform: fullName, canonical: getCanonicalConsoleName(fullName) };
  }
  const platformPart = fullName.slice(0, idx);
  const consolePart  = fullName.slice(idx + 3);
  return {
    platform: platformPart,
    canonical: getCanonicalConsoleName(consolePart),
  };
}

/**
 * Returns all raw variant names for a given canonical console name.
 * e.g. "Game Boy Advance" → ["Nintendo - Game Boy Advance",
 *                            "Nintendo - Game Boy Advance (Multiboot)", …]
 * Used by Sidebar, Dashboard, and Consoles tab click handlers.
 */
export function resolveConsoleVariants(canonical: string, allConsoles: ConsoleStats[]): string[] {
  return allConsoles
    .filter((c) => getConsoleParts(c.name).canonical === canonical)
    .map((c) => c.name);
}

/**
 * Strip the last parenthetical format-variant suffix from a full No-Intro
 * folder name.  Mirrors the Rust `strip_format_suffix` used in ConsoleStats
 * game_groups computation.
 *
 * @example
 * stripFormatSuffix("Nintendo - Nintendo 64 (BigEndian)") // → "Nintendo - Nintendo 64"
 * stripFormatSuffix("Nintendo - Nintendo 64DD")           // → "Nintendo - Nintendo 64DD"
 */
export function stripFormatSuffix(name: string): string {
  const idx = name.lastIndexOf("(");
  return idx >= 0 ? name.slice(0, idx).trim() : name;
}

/**
 * Compute the total game-title count for a canonical console's sub-folder
 * variants, correctly handling cases where some sub-folders use a non-paren
 * naming convention (e.g. "Nintendo 64DD") and are therefore tracked under a
 * separate Rust canonical key.
 *
 * Within each `stripFormatSuffix` base-group (e.g. all "NES (Headered/less)"
 * sub-folders share the same deduplicated `game_groups`) we take one count.
 * Across base-groups (e.g. N64 BigEndian/ByteSwapped vs. N64DD) we sum.
 *
 * @example
 * // variants = [N64_BigEndian(game_groups=510), N64_ByteSwapped(510), N64DD(12)]
 * canonicalTitleCount(variants) // → 522
 */
export function canonicalTitleCount(variants: ConsoleStats[]): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v.game_groups);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/** Like canonicalTitleCount but reads all_groups (game + unofficial titles). */
export function canonicalAllTitleCount(variants: ConsoleStats[]): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v.all_groups);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/** Canonical-dedup sum for preferred_groups or all_groups. */
export function canonicalFieldSum(
  variants: ConsoleStats[],
  field: "preferred_groups" | "all_groups",
): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v[field]);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/**
 * Returns the display name for a console — full short name or abbreviation
 * depending on the toggle.  fullName is a raw No-Intro folder name.
 *
 * @example
 * getConsoleDisplayName("Nintendo - Game Boy Advance", false)  // → "Game Boy Advance"
 * getConsoleDisplayName("Nintendo - Game Boy Advance", true)   // → "GBA"
 */
export function getConsoleDisplayName(fullName: string, useShort: boolean): string {
  const shortName = getShortConsoleName(fullName);
  if (!useShort) return shortName;
  // Preserve the variant suffix so "GBA (Multiboot)" stays distinguishable from "GBA"
  return getFormatVariantLabel(fullName);
}
