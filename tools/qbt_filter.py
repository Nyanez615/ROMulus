#!/usr/bin/env python3
"""
qbt_filter.py — Apply a ROMulus download list to a qBittorrent torrent.

Files whose basename appears in the list → priority 1 (normal download).
All other files in the torrent       → priority 0 (do not download).

Usage:
    python3 tools/qbt_filter.py --hash <torrent_hash> --list <file.txt>

    # Custom host/port or credentials:
    python3 tools/qbt_filter.py --hash <hash> --list gba.txt \\
        --host localhost:8080 --user admin --password ""

    # Dry-run (show what would change, don't apply):
    python3 tools/qbt_filter.py --hash <hash> --list gba.txt --dry-run

Prerequisites:
    1. qBittorrent Web UI enabled:
       Preferences → Web UI → Enable the Web User Interface
       (default: http://localhost:8080, no password on first run)
    2. The torrent must already be added to qBittorrent.

Finding the torrent hash:
    Right-click the torrent in qBittorrent → Copy → Copy hash
    Or: qBittorrent → torrent list → right-click → Properties → Hash
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path


def qbt_request(host: str, path: str, data: dict | None = None, cookie: str = "") -> bytes:
    url = f"http://{host}{path}"
    headers = {"Referer": f"http://{host}", "Content-Type": "application/x-www-form-urlencoded"}
    if cookie:
        headers["Cookie"] = cookie
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def login(host: str, user: str, password: str) -> str:
    resp = qbt_request(host, "/api/v2/auth/login", {"username": user, "password": password})
    result = resp.decode()
    if result.strip() != "Ok.":
        sys.exit(f"Login failed: {result!r}. Check --user / --password and that the Web UI is enabled.")
    # The cookie is set by the server; for localhost with no auth it's often not needed,
    # but we grab it by using a cookie jar instead.
    return ""  # cookie handled below via CookieJar


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hash",     required=True,          help="Torrent info-hash (40 hex chars)")
    parser.add_argument("--list",     required=True,          help="Path to .txt download list from ROMulus")
    parser.add_argument("--host",     default="localhost:8080", help="qBittorrent Web UI host:port")
    parser.add_argument("--user",     default="admin",        help="Web UI username (default: admin)")
    parser.add_argument("--password", default="",             help="Web UI password (default: empty)")
    parser.add_argument("--dry-run",  action="store_true",    help="Print changes without applying them")
    args = parser.parse_args()

    torrent_hash = args.hash.lower()
    list_path = Path(args.list)

    if not list_path.exists():
        sys.exit(f"List file not found: {list_path}")

    # Load wanted filenames (basenames only — torrent entries may be prefixed with a folder)
    wanted: set[str] = set()
    for line in list_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            wanted.add(Path(line).name)

    print(f"Loaded {len(wanted):,} filenames from {list_path.name}")

    # Use a cookie jar so the session cookie is handled automatically
    import http.cookiejar
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    urllib.request.install_opener(opener)

    # Log in
    host = args.host
    login_url = f"http://{host}/api/v2/auth/login"
    login_data = urllib.parse.urlencode({"username": args.user, "password": args.password}).encode()
    login_req = urllib.request.Request(
        login_url, data=login_data,
        headers={"Referer": f"http://{host}", "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(login_req, timeout=10) as r:
        result = r.read().decode()
    if result.strip() not in ("Ok.", ""):
        sys.exit(f"Login failed: {result!r}")
    print("Logged in.")

    # Fetch file list for this torrent
    files_url = f"http://{host}/api/v2/torrents/files?hash={torrent_hash}"
    files_req = urllib.request.Request(files_url, headers={"Referer": f"http://{host}"})
    with urllib.request.urlopen(files_req, timeout=30) as r:
        files = json.loads(r.read())

    if not files:
        sys.exit(f"No files found for hash {torrent_hash}. Is the hash correct and the torrent added?")

    print(f"Torrent has {len(files):,} files.")

    # Classify each file
    to_download: list[int] = []
    to_skip:     list[int] = []
    unmatched_wanted: set[str] = set(wanted)

    for f in files:
        idx  = f["index"]
        name = Path(f["name"]).name  # strip any leading folder component
        if name in wanted:
            to_download.append(idx)
            unmatched_wanted.discard(name)
        else:
            to_skip.append(idx)

    print(f"\n  Will download : {len(to_download):>6,} files")
    print(f"  Will skip     : {len(to_skip):>6,} files")
    if unmatched_wanted:
        print(f"  Not in torrent: {len(unmatched_wanted):>6,} files from your list")
        if len(unmatched_wanted) <= 10:
            for n in sorted(unmatched_wanted):
                print(f"    {n}")

    if args.dry_run:
        print("\nDry run — no changes applied.")
        return

    # Apply priorities in one request each (qBittorrent accepts pipe-separated index lists)
    base_headers = {"Referer": f"http://{host}", "Content-Type": "application/x-www-form-urlencoded"}

    def set_prio(indices: list[int], priority: int) -> None:
        if not indices:
            return
        data = urllib.parse.urlencode({
            "hash":     torrent_hash,
            "id":       "|".join(str(i) for i in indices),
            "priority": priority,
        }).encode()
        req = urllib.request.Request(f"http://{host}/api/v2/torrents/filePrio", data=data, headers=base_headers)
        urllib.request.urlopen(req, timeout=30).read()

    print("\nApplying priorities…")
    set_prio(to_download, 1)  # normal
    set_prio(to_skip,     0)  # do not download
    print("Done.")


if __name__ == "__main__":
    main()
