#!/usr/bin/env python3
"""
dat_to_stubs.py — Create zero-byte stub files from a No-Intro DAT XML.

Usage:
  python3 dat_to_stubs.py <dat_file.xml> <console_folder_name> <output_dir>

Example:
  python3 dat_to_stubs.py "Nintendo - Nintendo 3DS (Decrypted).dat" \
      "Nintendo - Nintendo 3DS (Decrypted)" /tmp/3ds_virtual

The output directory will contain:
  <output_dir>/<console_folder_name>/<rom_filename>   (zero-byte files)

These stubs can then be scanned by the ROMulus audit binary to produce a
preferred-variant list without downloading any actual ROMs.
"""

import sys
import os
import xml.etree.ElementTree as ET

def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    dat_path, console_name, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]

    stub_dir = os.path.join(out_dir, console_name)
    os.makedirs(stub_dir, exist_ok=True)

    tree = ET.parse(dat_path)
    root = tree.getroot()

    # Logiqx DAT format: <game><rom name="..." .../></game>
    # The rom.name attribute is the actual filename (e.g. "Game (USA).3ds")
    count = 0
    for rom in root.findall(".//rom"):
        name = rom.get("name")
        if not name:
            continue
        stub_path = os.path.join(stub_dir, name)
        with open(stub_path, "w"):
            pass  # zero-byte file
        count += 1

    print(f"Created {count} stub files in: {stub_dir}")

if __name__ == "__main__":
    main()
