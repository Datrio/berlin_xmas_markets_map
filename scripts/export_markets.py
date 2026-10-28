#!/usr/bin/env python3
"""
Writes markets.json from the Cloudflare Worker's /api/export (D1 is the source of truth).

    EXPORT_TOKEN=... python3 scripts/export_markets.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

API = os.environ.get("XMAS_API", "https://xmas-api.datrio.workers.dev")
OUT = Path(__file__).resolve().parent.parent / "markets.json"

req = urllib.request.Request(API + "/api/export", headers={"authorization": "Bearer " + os.environ["EXPORT_TOKEN"], "user-agent": "xmas-export"})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)
if not isinstance(data, list) or len(data) < 50:
    sys.exit(f"Refusing to write: export returned {len(data) if isinstance(data, list) else 'non-list'} markets")
OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print(f"Wrote {len(data)} markets")
