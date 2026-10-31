#!/usr/bin/env python3
"""
Compares the dates in markets.json with the official berlin.de market pages and
flags possible duplicates. It only reports; it never changes any data.

    python3 scripts/check_berlin_dates.py            # fetches every berlin.de page (~1 min)
    python3 scripts/check_berlin_dates.py --cache f  # reuse/store the fetched pages in f (JSON)

Run it before each season. Apply any fix in the D1 database (the source of truth),
then let the nightly export update markets.json.
"""
import argparse
import collections
import datetime
import html
import http.cookiejar
import itertools
import json
import math
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MONTHS = {m: i + 1 for i, m in enumerate(
    "Januar Februar März April Mai Juni Juli August September Oktober November Dezember".split())}
TOKEN = re.compile(r"(\d{1,2})\.|(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)|(bis)|(\d{4})")
STOPS = {"Termin", "Termine", "Öffnungszeiten", "Eintritt", "Adresse", "Es folgt eine Kartendarstellung.", "Zum Stadtplan", "Verkehrsanbindungen"}


def fetch_lines(url):
    # berlin.de answers some pages with a redirect loop until a cookie is set, so keep a cookie jar.
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; xmas-map-check/1.0)"})
    page = opener.open(req, timeout=30).read().decode("utf-8", "replace")
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", text))
    return [l.strip() for l in text.split("\n") if l.strip()]


def block(lines, labels):
    for label in labels:
        if label in lines:
            i, out = lines.index(label) + 1, []
            while i < len(lines) and lines[i] not in STOPS:
                out.append(lines[i])
                i += 1
            return out
    return None


def scrape(url):
    lines = fetch_lines(url)
    return {"termine": block(lines, ["Termine", "Termin"]), "oeff": block(lines, ["Öffnungszeiten"])}


def parse_line(line):
    """'27. bis 29. November 2026' / '5., 6. und 12. Dezember' -> [('day'|'range', start, end)]."""
    seq, pending, year = [], [], None
    for m in TOKEN.finditer(line):
        tok, kind = m.group(0), m.lastindex
        if kind == 1:
            seq.append(["d", int(tok[:-1]), None])
            pending.append(len(seq) - 1)
        elif kind == 3:
            seq.append(["bis", None, None])
        elif kind == 2:
            for i in pending:
                seq[i][2] = MONTHS[tok]
            pending = []
        elif kind == 4:
            year = int(tok)
    items = [x for x in seq if x[0] == "bis" or (x[0] == "d" and x[2])]
    y, prev_month, years = year or 2026, None, []
    for x in reversed(items):  # the year is written once, at the end
        if x[0] == "d":
            if prev_month is not None and x[2] > prev_month:
                y -= 1
            years.append(y)
            prev_month = x[2]
        else:
            years.append(None)
    years.reverse()
    out, i = [], 0
    while i < len(items):
        if items[i][0] == "d":
            a = datetime.date(years[i], items[i][2], items[i][1])
            if i + 2 < len(items) and items[i + 1][0] == "bis" and items[i + 2][0] == "d":
                b = items[i + 2]
                out.append(("range", a, datetime.date(years[i + 2], b[2], b[1])))
                i += 3
                continue
            out.append(("day", a, a))
        i += 1
    return out


def official(page):
    lines = page.get("termine")
    if not lines or any("nicht bekannt" in l.lower() for l in lines):
        return None
    # Ignore "..., geschlossen am 15. November": those are closed days, not the market's dates.
    items = [x for l in lines for x in parse_line(re.split(r",?\s*geschlossen", l)[0])]
    if not items:
        return "unparsed"
    ranges = [x for x in items if x[0] == "range"]
    return {"first": min(x[1] for x in items), "last": max(x[2] for x in items),
            "days": None if ranges else {x[1] for x in items}}


def ours(m):
    if m.get("dates"):
        ds = sorted(datetime.date.fromisoformat(x) for x in m["dates"])
        return {"first": ds[0], "last": ds[-1], "days": set(ds)}
    if m.get("start") and m.get("end"):
        return {"first": datetime.date.fromisoformat(m["start"]), "last": datetime.date.fromisoformat(m["end"]), "days": None}
    return None


def distance_m(a, b):
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b["lng"] - a["lng"]) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="JSON file to read fetched pages from and write them to")
    args = ap.parse_args()
    markets = json.loads((ROOT / "markets.json").read_text())
    cache = json.loads(Path(args.cache).read_text()) if args.cache and Path(args.cache).exists() else {}

    report = collections.defaultdict(list)
    for m in markets:
        url = m["url"]
        if "berlin.de/weihnachtsmarkt/" not in url:
            report["not checked (other site)"].append(f"{m['name']}  {url}")
            continue
        if url not in cache:
            try:
                cache[url] = scrape(url)
            except Exception as e:  # keep going; one bad page shouldn't hide the rest
                cache[url] = {"error": repr(e)[:80]}
            time.sleep(0.4)
        page = cache[url]
        if "error" in page:
            report["fetch failed"].append(f"{m['name']}  {page['error']}")
            continue
        off, mine, tbc = official(page), ours(m), bool(m.get("tbc"))
        mine_s = f"{mine['first']}..{mine['last']}" if mine else "none"
        if off is None:
            if mine and not tbc:
                report["WE HAVE DATES, berlin.de does not (tbc not set)"].append(f"{m['name']}  ours={mine_s}")
            continue
        if off == "unparsed":
            report["could not parse"].append(f"{m['name']}  {page['termine']}")
            continue
        off_s = f"{off['first']}..{off['last']}" + (f" days={sorted(map(str, off['days']))}" if off["days"] else "")
        if mine is None:
            report["berlin.de has dates, we do not"].append(f"{m['name']}  berlin.de={off_s}")
        elif (mine["first"], mine["last"]) != (off["first"], off["last"]) or (off["days"] and mine["days"] and off["days"] != mine["days"]):
            report["DATES DIFFER (check berlin.de text; may be its typo or a parse limit)"].append(f"{m['name']}  ours={mine_s}  berlin.de={off_s}  text={page['termine']}")
        elif tbc:
            report["dates confirmed on berlin.de but still marked tbc"].append(f"{m['name']}  {off_s}")

    ids = collections.defaultdict(list)
    for m in markets:
        mm = re.search(r"/weihnachtsmarkt/(\d+)-", m["url"])
        if mm:
            ids[mm.group(1)].append(m["name"])
    for names in ids.values():
        if len(names) > 1:
            report["DUPLICATE: same berlin.de page"].append(" / ".join(names))
    for a, b in itertools.combinations(markets, 2):
        d = distance_m(a, b)
        if d < 150:
            report["close together (<150 m), maybe the same market"].append(f"{d:.0f} m  {a['name']}  /  {b['name']}")

    if args.cache:
        Path(args.cache).write_text(json.dumps(cache, ensure_ascii=False, indent=1, default=str))
    if not report:
        print("No differences found.")
    for title, rows in report.items():
        print(f"\n## {title} ({len(rows)})")
        for r in rows:
            print(" -", r)


if __name__ == "__main__":
    main()
