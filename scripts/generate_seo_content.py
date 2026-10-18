#!/usr/bin/env python3
"""
Regenerates the static, crawlable market list and JSON-LD structured data
in index.html from markets.json.

Search engines don't execute the app's own fetch('markets.json') + Leaflet
rendering reliably, so this bakes the same data into plain HTML/JSON-LD at
build time instead. Run this again whenever markets.json changes:

    python3 scripts/generate_seo_content.py
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKETS_JSON = ROOT / "markets.json"
INDEX_HTML = ROOT / "index.html"
SITE_URL = "https://xmas.dariuszsiedlecki.com/"

LIST_START = "<!-- SEO:MARKET_LIST:START -->"
LIST_END = "<!-- SEO:MARKET_LIST:END -->"
JSONLD_START = "<!-- SEO:JSONLD:START -->"
JSONLD_END = "<!-- SEO:JSONLD:END -->"


def fmt_date(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%b %d").replace(" 0", " ")


def date_text(market):
    dates = market.get("dates")
    if dates:
        text = ", ".join(fmt_date(d) for d in sorted(dates))
    elif market.get("start") and market.get("end"):
        text = f"{fmt_date(market['start'])} – {fmt_date(market['end'])}"
    else:
        return "Dates to be announced"
    if market.get("tbc"):
        text += " (estimated)"
    return text


def event_dates(market):
    dates = market.get("dates")
    if dates:
        s = sorted(dates)
        return s[0], s[-1]
    if market.get("start") and market.get("end"):
        return market["start"], market["end"]
    return None, None


def escape(s):
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_market_list_html(markets):
    groups = defaultdict(list)
    for m in markets:
        groups[m.get("loc") or "Berlin"].append(m)

    parts = [LIST_START]
    parts.append('    <section class="market-directory" id="all-markets">')
    parts.append("        <h2>All Christmas Markets in Berlin (2026 Season)</h2>")
    parts.append(
        f"        <p>Browse all {len(markets)} Christmas markets (Weihnachtsmärkte) in Berlin "
        "for the 2026 season, grouped by neighborhood. Use the interactive map above to filter "
        "by date and find the nearest market to you — dates marked “estimated” are "
        "pending official confirmation from the market organizers.</p>"
    )
    parts.append('        <div class="market-directory-grid">')
    for loc in sorted(groups):
        parts.append('            <div class="market-directory-group">')
        parts.append(f"                <h3>{escape(loc)}</h3>")
        parts.append("                <ul>")
        for m in sorted(groups[loc], key=lambda m: m["name"]):
            name = escape(m["name"])
            dt = escape(date_text(m))
            url = m.get("url")
            if url:
                label = f'<a href="{escape(url)}" target="_blank" rel="noopener">{name}</a>'
            else:
                label = name
            parts.append(
                f"                    <li>{label}"
                f'<span class="market-directory-date">{dt}</span></li>'
            )
        parts.append("                </ul>")
        parts.append("            </div>")
    parts.append("        </div>")
    parts.append("    </section>")
    parts.append(f"    {LIST_END}")
    return "\n".join(parts)


def build_jsonld(markets):
    items = []
    for m in markets:
        start, end = event_dates(m)
        if not start:
            continue
        event = {
            "@type": "Event",
            "name": m["name"],
            "startDate": start,
            "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
            "eventStatus": "https://schema.org/EventScheduled",
            "location": {
                "@type": "Place",
                "name": m.get("loc") or "Berlin",
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Berlin",
                    "addressCountry": "DE",
                },
            },
        }
        if end and end != start:
            event["endDate"] = end
        if m.get("lat") is not None and m.get("lng") is not None:
            event["location"]["geo"] = {
                "@type": "GeoCoordinates",
                "latitude": m["lat"],
                "longitude": m["lng"],
            }
        if m.get("url"):
            event["url"] = m["url"]
        items.append(event)

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "name": "Berlin Christmas Markets Map",
                "url": SITE_URL,
                "description": (
                    "Interactive map of every Christmas market in Berlin for the "
                    "2026 season."
                ),
            },
            {
                "@type": "ItemList",
                "name": "Berlin Christmas Markets 2026",
                "numberOfItems": len(items),
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "item": ev}
                    for i, ev in enumerate(items)
                ],
            },
        ],
    }
    payload = json.dumps(graph, ensure_ascii=False, indent=2)
    return (
        f"{JSONLD_START}\n"
        f'    <script type="application/ld+json">\n{payload}\n    </script>\n'
        f"    {JSONLD_END}"
    )


def replace_block(html, start_marker, end_marker, new_block):
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker), re.S
    )
    if not pattern.search(html):
        raise SystemExit(f"Could not find markers {start_marker} ... {end_marker} in index.html")
    return pattern.sub(new_block, html, count=1)


def main():
    markets = json.loads(MARKETS_JSON.read_text(encoding="utf-8"))
    html = INDEX_HTML.read_text(encoding="utf-8")

    html = replace_block(html, LIST_START, LIST_END, build_market_list_html(markets))
    html = replace_block(html, JSONLD_START, JSONLD_END, build_jsonld(markets))

    INDEX_HTML.write_text(html, encoding="utf-8")
    print(f"Updated {INDEX_HTML} from {len(markets)} markets in {MARKETS_JSON}")


if __name__ == "__main__":
    main()
