#!/usr/bin/env python3
"""
batch_import_dats.py — Bulk-import No-Intro DAT files directly into the
ROMulus SQLite database without going through the UI.

Usage:
    python3 tools/batch_import_dats.py [--db <path>] [--dats <dir>] [--dry-run]

Defaults:
    --db   ~/Library/Application Support/com.romulus.app/romulus.db
    --dats ~/Downloads

IMPORTANT: Close ROMulus before running this script.

For each .dat file in <dats>:
  1. Parses <header><name> and <header><version> from the XML.
  2. INSERT OR REPLACE into dat_files (console = header name).
  3. DELETE old dat_entries for that dat_file_id.
  4. INSERT all (name, rom_name, crc32) entries.

This replicates exactly what import_dat() does in dat.rs.
"""

import argparse
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


DB_DEFAULT = Path.home() / "Library/Application Support/com.romulus.app/romulus.db"
DATS_DEFAULT = Path.home() / "Downloads"


def parse_dat(path: Path):
    """Return (name, version, entries) where entries = list of (game_name, rom_name, crc32)."""
    tree = ET.parse(path)
    root = tree.getroot()

    header = root.find("header")
    name    = (header.findtext("name")    or "").strip() if header is not None else ""
    version = (header.findtext("version") or "").strip() if header is not None else ""

    entries = []
    for game in root.findall(".//game") + root.findall(".//machine"):
        game_name = (game.get("name") or "").strip()
        rom = game.find("rom")
        rom_name = rom.get("name") if rom is not None else None
        crc32    = rom.get("crc")  if rom is not None else None
        entries.append((game_name, rom_name, crc32))

    return name, version, entries


def import_dat(conn: sqlite3.Connection, path: Path, dry_run: bool) -> tuple[str, int]:
    name, version, entries = parse_dat(path)
    if not name:
        print(f"  SKIP {path.name} — no <header><name> found")
        return "", 0

    filename   = path.name
    now        = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if dry_run:
        print(f"  DRY  {name!r}  ({len(entries)} entries)  ver={version!r}")
        return name, len(entries)

    # Mirrors import_dat in dat.rs exactly.
    conn.execute("DELETE FROM dat_files WHERE console = ?", (name,))
    conn.execute(
        "INSERT INTO dat_files (console, filename, version, imported_at) VALUES (?,?,?,?)",
        (name, filename, version or None, now),
    )
    dat_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.executemany(
        "INSERT INTO dat_entries (dat_file_id, name, rom_name, crc32) VALUES (?,?,?,?)",
        [(dat_id, gname, rom_name, crc32) for gname, rom_name, crc32 in entries],
    )
    return name, len(entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db",      default=DB_DEFAULT,   help="Path to romulus.db")
    parser.add_argument("--dats",    default=DATS_DEFAULT, help="Directory containing .dat files")
    parser.add_argument("--dry-run", action="store_true",  help="Parse only — do not write to DB")
    args = parser.parse_args()

    db_path   = Path(args.db)
    dats_dir  = Path(args.dats)

    if not db_path.exists():
        sys.exit(f"DB not found: {db_path}")
    if not dats_dir.is_dir():
        sys.exit(f"DATs directory not found: {dats_dir}")

    dat_files = sorted(dats_dir.glob("*.dat"))
    if not dat_files:
        sys.exit(f"No .dat files found in {dats_dir}")

    print(f"DB:   {db_path}")
    print(f"DATs: {dats_dir}  ({len(dat_files)} files)")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'WRITE'}")
    print()

    conn = sqlite3.connect(db_path)
    total_entries = 0
    imported = []

    try:
        with conn:
            for path in dat_files:
                name, count = import_dat(conn, path, args.dry_run)
                if name:
                    imported.append((name, count))
                    if not args.dry_run:
                        print(f"  OK   {name!r}  ({count} entries)")
                    total_entries += count
    finally:
        conn.close()

    print()
    print(f"{'Would import' if args.dry_run else 'Imported'} {len(imported)} DATs / {total_entries:,} entries total")

    if args.dry_run:
        print()
        print("Re-run without --dry-run to write.")


if __name__ == "__main__":
    main()
