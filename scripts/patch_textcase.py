"""One-time pass putting the committed data files into readable case
without a full rebuild (the builders now do this on write)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textcase import apply_display_case  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "public" / "data"


def main() -> None:
    for path in sorted((DATA / "states").glob("*.json")):
        if path.name == "index.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for f in data["facilities"]:
            apply_display_case(f)
        path.write_text(json.dumps(data, separators=(",", ":")))
    for name in ("fqhc_sites.json", "urgent_care_sites.json"):
        path = DATA / name
        data = json.loads(path.read_text(encoding="utf-8"))
        for s in data["sites"]:
            apply_display_case(s)
        path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
