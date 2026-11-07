"""Writes public/data/hospitals_index.json: every hospital without its
per-procedure prices (83% of the bytes), so the app can start from a small
file and fetch a state's prices only when a search needs them. Run after
build_data.py (which also calls write_index)."""
from __future__ import annotations

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"


def write_index() -> Path:
    sites = []
    for path in sorted((DATA / "states").glob("*.json")):
        if path.name == "index.json":
            continue
        for f in json.loads(path.read_text(encoding="utf-8"))["facilities"]:
            slim = {k: v for k, v in f.items() if k != "drg_charges"}
            # Whether a state file has prices for it, so the app knows to fetch.
            slim["priced"] = bool(f.get("drg_charges"))
            sites.append(slim)
    out = DATA / "hospitals_index.json"
    out.write_text(json.dumps({"facilities": sites}, separators=(",", ":")), encoding="utf-8")
    return out


if __name__ == "__main__":
    p = write_index()
    print(p, p.stat().st_size)
