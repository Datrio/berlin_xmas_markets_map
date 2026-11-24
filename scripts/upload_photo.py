"""Uploads a market's banner photo to R2 and records it in D1 (via Wrangler, so no Cloudflare Access needed).

  python3 scripts/upload_photo.py "Market name" photo.jpg                      # your own photo: no credit needed
  python3 scripts/upload_photo.py "Market name" photo.jpg --credit "Photo: Name" --source https://official.site/page
  python3 scripts/upload_photo.py "Market name" --remove

Photos should be about 800 px wide JPEG or WebP under 500 KB (2 MB is the hard limit). Someone else's photo needs a credit and its source page, and its licence checked first.
"""
import argparse
import difflib
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import unicodedata

from markets_api import API, fetch_markets

BUCKET = "berlin-xmas-photos"
DATABASE = "berlin-xmas-markets"
MAX_BYTES = 2 * 1024 * 1024
WORKER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker")


def slugify(name):
    """Same rules as marketSlug() in worker/src/validate.js."""
    s = name.replace("ß", "ss")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def photo_key(market_name, data, ext):
    """<slug>-<first 8 hex of sha256>.<ext>: a replaced photo gets a new URL despite the day-long cache."""
    return f"{slugify(market_name)}-{hashlib.sha256(data).hexdigest()[:8]}.{ext}"


def detect_type(data):
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def sql_quote(value):
    return "'" + value.replace("'", "''") + "'"


def sql_value(value):
    """Quoted text, or NULL for a missing or empty value."""
    return sql_quote(value) if value else "NULL"


def wrangler(*args):
    subprocess.run(["npx", "wrangler@4", *args], cwd=WORKER_DIR, check=True)


def run_sql(sql, target):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql)
    try:
        wrangler("d1", "execute", DATABASE, target, f"--file={f.name}")
    finally:
        os.unlink(f.name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("market", help="exact market name, as in the API")
    ap.add_argument("file", nargs="?", help="JPEG or WebP file to upload")
    ap.add_argument("--credit", help="credit line shown on the banner, e.g. 'Photo: Name' (omit for your own photos)")
    ap.add_argument("--source", help="http(s) URL of the page the photo came from (omit for your own photos)")
    ap.add_argument("--remove", action="store_true", help="clear the market's photo (the R2 object is left in place)")
    ap.add_argument("--local", action="store_true", help="use the local dev R2/D1 instead of production (for testing)")
    ap.add_argument("--dry-run", action="store_true", help="validate and print what would happen, change nothing")
    args = ap.parse_args()
    target = "--local" if args.local else "--remote"

    names = [m["name"] for m in fetch_markets()]
    if args.market not in names:
        close = difflib.get_close_matches(args.market, names, n=5)
        sys.exit(f"No market named {args.market!r}." + (f" Did you mean: {', '.join(close)}?" if close else ""))
    where = f"WHERE name = {sql_quote(args.market)};"

    if args.remove:
        if args.file:
            sys.exit("Use either a file or --remove, not both.")
        sql = f"UPDATE markets SET image = NULL, image_credit = NULL, image_source = NULL {where}\n"
        print(sql if args.dry_run else "Clearing photo...")
        if not args.dry_run:
            run_sql(sql, target)
        return

    if not args.file:
        sys.exit("A photo file is required.")
    if args.source and not re.match(r"^https?://", args.source):
        sys.exit("--source must start with http:// or https://")
    with open(args.file, "rb") as f:
        data = f.read()
    if len(data) > MAX_BYTES:
        sys.exit(f"{args.file} is {len(data) // 1024} KB; the limit is {MAX_BYTES // 1024} KB.")
    ext = detect_type(data)
    if not ext:
        sys.exit(f"{args.file} is not a JPEG or WebP file.")

    key = photo_key(args.market, data, ext)
    sql = (f"UPDATE markets SET image = {sql_quote(key)}, image_credit = {sql_value(args.credit)}, "
           f"image_source = {sql_value(args.source)} {where}\n")
    url = f"{API}/img/{key}"
    if args.dry_run:
        print(f"Would upload {args.file} to r2://{BUCKET}/{key}\n{sql}{url}")
        return
    wrangler("r2", "object", "put", f"{BUCKET}/{key}", f"--file={os.path.abspath(args.file)}",
             f"--content-type={'image/jpeg' if ext == 'jpg' else 'image/webp'}", target)
    run_sql(sql, target)
    print(f"Done. The API picks it up within about a minute.\n{url}")


if __name__ == "__main__":
    main()
