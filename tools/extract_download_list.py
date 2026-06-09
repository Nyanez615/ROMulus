#!/usr/bin/env python3
"""
extract_download_list.py — Convert an audit TSV into a torrent download list.

Usage:
  cargo run -p romulus --example audit -- /tmp/3ds_virtual 2>/dev/null \
      | python3 extract_download_list.py > 3ds_download_list.txt

The output is one filename per line (with .zip extension) — the exact filenames
as they appear in the Myrient torrent. Feed this to your torrent client to
selectively download only the preferred English variants.

Flags included in the download list:
  OK               — clearly preferred variant
  GAP_SMALL        — preferred by a small margin, worth downloading
  NO_PREFERRED     — no English version; preferred is best available (e.g. Japan-only)
  PRERELEASE_ONLY  — all variants are pre-release; take the best one
  UNOFFICIAL_ONLY  — no official release; take the best unofficial

Flags excluded (these files will NOT be in the download list):
  PRERELEASE_BUG   — scoring bug; the audit already flags these separately
  (Non-preferred variants are simply not included — only the preferred file
   per group is listed.)

BIOS files are always included regardless of flag (they are tiny and required
for accurate emulation). Add them manually or use --include-bios.
"""

import sys
import os

INCLUDE_FLAGS = {"OK", "GAP_SMALL", "NO_PREFERRED", "PRERELEASE_ONLY", "UNOFFICIAL_ONLY"}

def rom_to_zip(filename: str) -> str:
    """Map a ROM filename (e.g. .3ds, .cci) to its .zip torrent name."""
    base, ext = os.path.splitext(filename)
    if ext.lower() in (".3ds", ".cci", ".cxi", ".app", ".nds", ".gba"):
        return base + ".zip"
    return filename  # already .zip or unknown — return as-is

def main():
    download = []
    skipped_flags = set()

    for line in sys.stdin:
        line = line.rstrip("\n")
        parts = line.split("\t")
        if len(parts) < 5:
            continue  # header or malformed row

        flag = parts[0]
        preferred_file = parts[4]  # preferred column

        if flag == "flag":
            continue  # skip header row

        if flag not in INCLUDE_FLAGS:
            skipped_flags.add(flag)
            continue

        if preferred_file in ("NONE", "-", ""):
            continue

        zip_name = rom_to_zip(preferred_file)
        download.append(zip_name)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for f in download:
        if f not in seen:
            seen.add(f)
            unique.append(f)

    for f in sorted(unique):
        print(f)

    print(f"\n# Total files to download: {len(unique)}", file=sys.stderr)
    if skipped_flags:
        print(f"# Skipped flags (not downloaded): {', '.join(sorted(skipped_flags))}", file=sys.stderr)

if __name__ == "__main__":
    main()
