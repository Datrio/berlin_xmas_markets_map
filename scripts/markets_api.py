"""Fetches the market list from the live Worker API (D1 is the source of truth)."""
import json
import os
import urllib.request

API = os.environ.get("XMAS_API", "https://xmas.dariuszsiedlecki.com")


def fetch_markets():
    req = urllib.request.Request(API + "/api/markets", headers={"user-agent": "xmas-build"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if not isinstance(data, list) or len(data) < 50:
        raise SystemExit(f"Refusing to continue: API returned {len(data) if isinstance(data, list) else 'non-list'} markets")
    return data
