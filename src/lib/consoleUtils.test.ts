import { describe, it, expect } from "vitest";
import {
  getCanonicalConsoleName,
  getConsoleParts,
  getConsoleDisplayName,
  resolveConsoleVariants,
  getPlatform,
  getShortConsoleName,
  ABBREV,
} from "./consoleUtils";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeConsole(name: string): ConsoleStats {
  return { name, total_files: 1, total_groups: 1, game_files: 1, game_groups: 1, preferred_groups: 1, all_groups: 1, unofficial_files: 0, preferred_count: 1, preferred_explicit_count: 0, preferred_inferred_count: 0, system_file_count: 0, marked_for_deletion: 0, bytes_to_free: 0, total_bytes: 0 };
}

// ── getCanonicalConsoleName ───────────────────────────────────────────────────

describe("getCanonicalConsoleName", () => {
  it("strips (Multiboot) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Game Boy Advance (Multiboot)"))
      .toBe("Nintendo - Game Boy Advance");
  });

  it("strips (Video) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Game Boy Advance (Video)"))
      .toBe("Nintendo - Game Boy Advance");
  });

  it("strips (e-Reader) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Game Boy Advance (e-Reader)"))
      .toBe("Nintendo - Game Boy Advance");
  });

  it("strips (FDS) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Family Computer Disk System (FDS)"))
      .toBe("Nintendo - Family Computer Disk System");
  });

  it("strips (QD) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Family Computer Disk System (QD)"))
      .toBe("Nintendo - Family Computer Disk System");
  });

  it("strips (BigEndian) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Nintendo 64 (BigEndian)"))
      .toBe("Nintendo - Nintendo 64");
  });

  it("strips (ByteSwapped) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Nintendo 64 (ByteSwapped)"))
      .toBe("Nintendo - Nintendo 64");
  });

  it("strips (Headered) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Nintendo Entertainment System (Headered)"))
      .toBe("Nintendo - Nintendo Entertainment System");
  });

  it("strips (Headerless) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo - Nintendo Entertainment System (Headerless)"))
      .toBe("Nintendo - Nintendo Entertainment System");
  });

  it("leaves clean names unchanged", () => {
    expect(getCanonicalConsoleName("Nintendo - Game Boy")).toBe("Nintendo - Game Boy");
    expect(getCanonicalConsoleName("Nintendo - Game Boy Color")).toBe("Nintendo - Game Boy Color");
    expect(getCanonicalConsoleName("Nintendo - Virtual Boy")).toBe("Nintendo - Virtual Boy");
  });

  it("does not strip non-variant parentheticals (full name)", () => {
    expect(getCanonicalConsoleName("Nintendo - Nintendo 64DD")).toBe("Nintendo - Nintendo 64DD");
  });

  it("resolves N64DD alias when given short name", () => {
    expect(getCanonicalConsoleName("Nintendo 64DD")).toBe("Nintendo 64");
  });

  it("existing variant suffixes still work on short names", () => {
    expect(getCanonicalConsoleName("Game Boy Advance (Multiboot)")).toBe("Game Boy Advance");
  });

  it("non-aliased non-suffixed short name passes through unchanged", () => {
    expect(getCanonicalConsoleName("Game Boy")).toBe("Game Boy");
  });

  it("strips (Encrypted) suffix", () => {
    expect(getCanonicalConsoleName("Nintendo DS (Encrypted)")).toBe("Nintendo DS");
  });

  it("strips (XBLA) suffix", () => {
    expect(getCanonicalConsoleName("Xbox 360 (XBLA)")).toBe("Xbox 360");
  });

  it("recursively strips multiple variant suffixes", () => {
    expect(getCanonicalConsoleName("Nintendo 3DS (Digital) (Decrypted)")).toBe("Nintendo 3DS");
    expect(getCanonicalConsoleName("Nintendo DSi (Digital) (CDN) (Decrypted)")).toBe("Nintendo DSi");
  });

  // New VARIANT_SUFFIXES
  it("strips (Aftermarket) suffix", () => {
    expect(getCanonicalConsoleName("Game Boy (Aftermarket)")).toBe("Game Boy");
  });

  it("strips (Private) suffix", () => {
    expect(getCanonicalConsoleName("Atari ST (Private)")).toBe("Atari ST");
  });

  it("strips (WIP) suffix", () => {
    expect(getCanonicalConsoleName("N-Gage (WIP)")).toBe("N-Gage");
  });

  it("strips (Flux) suffix", () => {
    expect(getCanonicalConsoleName("CPC (Flux)")).toBe("CPC");
  });

  it("strips (Tapes) then (Waveform) recursively", () => {
    expect(getCanonicalConsoleName("Atom (Waveform) (Tapes)")).toBe("Atom");
  });

  it("strips (LNX) and (LYX) for Atari Lynx container formats", () => {
    expect(getCanonicalConsoleName("Atari Lynx (LNX)")).toBe("Atari Lynx");
    expect(getCanonicalConsoleName("Atari Lynx (LYX)")).toBe("Atari Lynx");
  });

  it("strips PC storefront suffixes to canonical PC name", () => {
    expect(getCanonicalConsoleName("PC and Compatibles (Steam)")).toBe("PC and Compatibles");
    expect(getCanonicalConsoleName("PC and Compatibles (GOG)")).toBe("PC and Compatibles");
    expect(getCanonicalConsoleName("PC and Compatibles (Tiger Electronics - Net Jet)"))
      .toBe("PC and Compatibles");
  });

  it("resolves NeoGeo Pocket alias", () => {
    expect(getCanonicalConsoleName("NeoGeo Pocket")).toBe("Neo Geo Pocket");
    expect(getCanonicalConsoleName("NeoGeo Pocket Color")).toBe("Neo Geo Pocket Color");
  });
});

// ── getPlatform ───────────────────────────────────────────────────────────────

describe("getPlatform", () => {
  it("extracts platform from a full console name", () => {
    expect(getPlatform("Nintendo - Game Boy")).toBe("Nintendo");
    expect(getPlatform("Sega - Mega Drive")).toBe("Sega");
  });

  it("falls back to the full string when no separator", () => {
    expect(getPlatform("Sega")).toBe("Sega");
    expect(getPlatform("Other")).toBe("Other");
  });
});

// ── getShortConsoleName ───────────────────────────────────────────────────────

describe("getShortConsoleName", () => {
  it("extracts the console portion after the separator", () => {
    expect(getShortConsoleName("Nintendo - Game Boy Advance")).toBe("Game Boy Advance");
    expect(getShortConsoleName("Sega - Mega Drive")).toBe("Mega Drive");
  });

  it("falls back to the full string when no separator", () => {
    expect(getShortConsoleName("GameBoy")).toBe("GameBoy");
  });

  // indexOf fix: parentheticals with " - " inside must not be severed
  it("preserves parenthetical containing ' - '", () => {
    expect(getShortConsoleName("IBM - PC and Compatibles (Tiger Electronics - Net Jet)"))
      .toBe("PC and Compatibles (Tiger Electronics - Net Jet)");
  });

  // indexOf fix: multi-hyphen Sega console names
  it("returns full multi-segment Sega name", () => {
    expect(getShortConsoleName("Sega - Master System - Mark III"))
      .toBe("Master System - Mark III");
  });

  it("returns full NEC multi-segment name", () => {
    expect(getShortConsoleName("NEC - PC Engine - TurboGrafx-16"))
      .toBe("PC Engine - TurboGrafx-16");
  });

  // META_PREFIX fix: strip category prefix, return actual console (last segment)
  it("strips Non-Redump prefix and returns last segment", () => {
    expect(getShortConsoleName("Non-Redump - Nintendo - Nintendo GameCube"))
      .toBe("Nintendo GameCube");
  });

  it("strips Unofficial prefix and returns last segment", () => {
    expect(getShortConsoleName("Unofficial - Sony - PlayStation Vita (NoNpDrm)"))
      .toBe("PlayStation Vita (NoNpDrm)");
  });

  it("strips Source Code prefix with four segments", () => {
    expect(getShortConsoleName("Source Code - Nintendo - Nintendo - Game Boy Color"))
      .toBe("Game Boy Color");
  });

  it("falls back to second segment when META_PREFIX folder has only one extra segment", () => {
    expect(getShortConsoleName("Various - itch.io")).toBe("itch.io");
  });
});

// ── getConsoleParts ───────────────────────────────────────────────────────────

describe("getConsoleParts", () => {
  it("splits correctly into platform + short canonical name", () => {
    const r = getConsoleParts("Nintendo - Game Boy Advance");
    expect(r.platform).toBe("Nintendo");
    expect(r.canonical).toBe("Game Boy Advance");
  });

  it("strips variant suffix and returns canonical short name", () => {
    const r = getConsoleParts("Nintendo - Game Boy Advance (Multiboot)");
    expect(r.platform).toBe("Nintendo");
    expect(r.canonical).toBe("Game Boy Advance");
  });

  it("handles missing \" - \" separator", () => {
    const r = getConsoleParts("GameBoy");
    expect(r.platform).toBe("GameBoy");
    expect(r.canonical).toBe("GameBoy");
  });

  it("resolves N64DD alias", () => {
    const r = getConsoleParts("Nintendo - Nintendo 64DD");
    expect(r.platform).toBe("Nintendo");
    expect(r.canonical).toBe("Nintendo 64");
  });

  it("returns canonical not raw variant for Sega suffix-less names", () => {
    const r = getConsoleParts("Sega - Saturn");
    expect(r.platform).toBe("Sega");
    expect(r.canonical).toBe("Saturn");
  });
});

// ── resolveConsoleVariants ────────────────────────────────────────────────────

describe("resolveConsoleVariants", () => {
  const consoles: ConsoleStats[] = [
    makeConsole("Nintendo - Game Boy Advance"),
    makeConsole("Nintendo - Game Boy Advance (Multiboot)"),
    makeConsole("Nintendo - Game Boy Advance (Video)"),
    makeConsole("Nintendo - Game Boy Advance (e-Reader)"),
    makeConsole("Nintendo - Nintendo 64"),
    makeConsole("Nintendo - Nintendo 64 (BigEndian)"),
    makeConsole("Nintendo - Nintendo 64DD"),
    makeConsole("Sega - Saturn"),
  ];

  it("returns all GBA variant names for canonical 'Game Boy Advance'", () => {
    const result = resolveConsoleVariants("Game Boy Advance", consoles);
    expect(result).toHaveLength(4);
    expect(result).toContain("Nintendo - Game Boy Advance");
    expect(result).toContain("Nintendo - Game Boy Advance (Multiboot)");
    expect(result).toContain("Nintendo - Game Boy Advance (Video)");
    expect(result).toContain("Nintendo - Game Boy Advance (e-Reader)");
  });

  it("includes N64DD under Nintendo 64 canonical group", () => {
    const result = resolveConsoleVariants("Nintendo 64", consoles);
    expect(result).toContain("Nintendo - Nintendo 64");
    expect(result).toContain("Nintendo - Nintendo 64 (BigEndian)");
    expect(result).toContain("Nintendo - Nintendo 64DD");
  });

  it("returns empty array for unknown canonical", () => {
    expect(resolveConsoleVariants("Super Famicom", consoles)).toHaveLength(0);
  });

  it("returns single item for console with no variants", () => {
    const result = resolveConsoleVariants("Saturn", consoles);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Sega - Saturn");
  });
});

// ── getConsoleDisplayName ─────────────────────────────────────────────────────

describe("getConsoleDisplayName", () => {
  it("useShort=false returns the short console name", () => {
    expect(getConsoleDisplayName("Nintendo - Game Boy Advance", false)).toBe("Game Boy Advance");
  });

  it("useShort=true returns known ABBREV entry", () => {
    expect(getConsoleDisplayName("Nintendo - Game Boy Advance", true)).toBe("GBA");
  });

  it("useShort=true with no ABBREV entry falls back to 4-char uppercase", () => {
    expect(getConsoleDisplayName("Nintendo - Virtual Boy", true)).toBe("VB");
  });

  it("useShort=true for NEC PC Engine returns PCE from ABBREV", () => {
    expect(getConsoleDisplayName("NEC - PC Engine", true)).toBe("PCE");
  });

  it("useShort=true preserves variant suffix for distinguishability", () => {
    // Variant suffixes are kept so paired DATs stay distinguishable in the UI
    // ("3DS (Decrypted)" vs a potential "3DS (Encrypted)")
    expect(getConsoleDisplayName("Nintendo - Nintendo 3DS (Decrypted)", true)).toBe("3DS (Decrypted)");
  });

  // New consoles from catalog expansion
  it("Atari Lynx with modern No-Intro naming", () => {
    expect(getConsoleDisplayName("Atari - Atari Lynx", true)).toBe("LYNX");
  });

  it("Commodore 64", () => {
    expect(getConsoleDisplayName("Commodore - Commodore 64", true)).toBe("C64");
  });

  it("SNK NeoGeo Pocket resolves alias to NGP", () => {
    expect(getConsoleDisplayName("SNK - NeoGeo Pocket", true)).toBe("NGP");
  });

  it("Non-Redump GameCube folder resolves to GCN", () => {
    expect(getConsoleDisplayName("Non-Redump - Nintendo - Nintendo GameCube", true)).toBe("GCN");
  });

  it("Aftermarket variant preserves suffix in label", () => {
    expect(getConsoleDisplayName("Nintendo - Game Boy (Aftermarket)", true)).toBe("GB (Aftermarket)");
  });

  it("Panic Playdate", () => {
    expect(getConsoleDisplayName("Panic - Playdate", true)).toBe("PD");
  });

  it("NEC PC Engine TurboGrafx-16 multi-segment name", () => {
    expect(getConsoleDisplayName("NEC - PC Engine - TurboGrafx-16", true)).toBe("PCE");
  });

  it("IBM PC Tiger Electronics Net Jet variant", () => {
    // Folder has " - " inside its parenthetical; indexOf fix preserves it
    expect(getConsoleDisplayName("IBM - PC and Compatibles (Tiger Electronics - Net Jet)", true))
      .toBe("PC (Tiger Electronics - Net Jet)");
  });
});

// ── ABBREV coverage — new entries ────────────────────────────────────────────

describe("ABBREV — new catalog entries", () => {
  it("Atari modern naming keys", () => {
    expect(ABBREV["Atari 2600"]).toBe("2600");
    expect(ABBREV["Atari Lynx"]).toBe("LYNX");
    expect(ABBREV["Atari Jaguar"]).toBe("JAG");
  });

  it("NEC multi-segment and standalone keys", () => {
    expect(ABBREV["PC Engine - TurboGrafx-16"]).toBe("PCE");
    expect(ABBREV["PC Engine"]).toBe("PCE");
    expect(ABBREV["PC-FX"]).toBe("PCFX");
  });

  it("Sega SG-1000 multi-segment key", () => {
    expect(ABBREV["SG-1000 - SC-3000"]).toBe("SG1K");
    expect(ABBREV["SG-1000"]).toBe("SG1K");
  });

  it("Commodore 64 with manufacturer prefix", () => {
    expect(ABBREV["Commodore 64"]).toBe("C64");
  });

  it("Apple retrocomputer family", () => {
    expect(ABBREV["Macintosh"]).toBe("MAC");
    expect(ABBREV["IIGS"]).toBe("A2GS");
    expect(ABBREV["Pippin"]).toBe("PIP");
  });

  it("WonderSwan family", () => {
    expect(ABBREV["WonderSwan"]).toBe("WS");
    expect(ABBREV["WonderSwan Color"]).toBe("WSC");
  });

  it("Non-game / misc entries", () => {
    expect(ABBREV["amiibo"]).toBe("amiibo");
    expect(ABBREV["Audio CD"]).toBe("ACD");
    expect(ABBREV["DVD-Video"]).toBe("DVDV");
  });

  it("N-Gage after (WIP) strip", () => {
    // ABBREV["N-Gage"] is the key; (WIP) is stripped by VARIANT_SUFFIXES before lookup
    expect(ABBREV["N-Gage"]).toBe("NGE");
  });

  it("Playdate", () => {
    expect(ABBREV["Playdate"]).toBe("PD");
  });

  it("PC and Compatibles → PC", () => {
    expect(ABBREV["PC and Compatibles"]).toBe("PC");
  });
});

// ── ABBREV coverage — Sega and Sony ──────────────────────────────────────────

describe("ABBREV — Sega and Sony coverage", () => {
  it("Master System → SMS", () => {
    expect(ABBREV["Master System"]).toBe("SMS");
    expect(ABBREV["Master System - Mark III"]).toBe("SMS");
  });

  it("Game Gear → GG", () => {
    expect(ABBREV["Game Gear"]).toBe("GG");
  });

  it("Mega Drive → MD", () => {
    expect(ABBREV["Mega Drive"]).toBe("MD");
    expect(ABBREV["Mega Drive - Genesis"]).toBe("MD");
  });

  it("Mega-CD → MCD", () => {
    expect(ABBREV["Mega-CD"]).toBe("MCD");
  });

  it("32X → 32X", () => {
    expect(ABBREV["32X"]).toBe("32X");
  });

  it("Saturn → SAT", () => {
    expect(ABBREV["Saturn"]).toBe("SAT");
  });

  it("Dreamcast → DC", () => {
    expect(ABBREV["Dreamcast"]).toBe("DC");
  });

  it("PlayStation → PSX", () => {
    expect(ABBREV["PlayStation"]).toBe("PSX");
  });

  it("PlayStation 2 → PS2", () => {
    expect(ABBREV["PlayStation 2"]).toBe("PS2");
  });

  it("PlayStation Portable → PSP", () => {
    expect(ABBREV["PlayStation Portable"]).toBe("PSP");
  });

  it("PlayStation Vita → PSV", () => {
    expect(ABBREV["PlayStation Vita"]).toBe("PSV");
  });
});
