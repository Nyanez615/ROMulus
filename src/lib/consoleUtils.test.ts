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
  return { name, total_files: 1, preferred_count: 1, marked_for_deletion: 0, bytes_to_free: 0, total_bytes: 0 };
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

  it("useShort=true for console with no known abbreviation uses slice fallback", () => {
    // "PC Engine" has no ABBREV entry → "PC E"
    expect(getConsoleDisplayName("NEC - PC Engine", true)).toBe("PC E");
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
