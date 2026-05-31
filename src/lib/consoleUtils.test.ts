import { describe, it, expect } from "vitest";
import {
  getCanonicalConsoleName,
  getPlatform,
  getShortConsoleName,
} from "./consoleUtils";

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

  it("does not strip non-variant parentheticals", () => {
    // 64DD has no variant suffix — the name is the canonical name
    expect(getCanonicalConsoleName("Nintendo - Nintendo 64DD")).toBe("Nintendo - Nintendo 64DD");
  });
});

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

describe("getShortConsoleName", () => {
  it("extracts the console portion after the separator", () => {
    expect(getShortConsoleName("Nintendo - Game Boy Advance")).toBe("Game Boy Advance");
    expect(getShortConsoleName("Sega - Mega Drive")).toBe("Mega Drive");
  });

  it("falls back to the full string when no separator", () => {
    expect(getShortConsoleName("GameBoy")).toBe("GameBoy");
  });
});
