#!/usr/bin/env python3
"""Build the internship feed.

Fetches community trackers and company ATS boards, keeps Summer 2027
postings, scores them against feed/config/profile.json, diffs against the
previous run and writes docs/data/*.json for the GitHub Pages site.

Standard library only, so it runs unchanged in GitHub Actions or a Claude
session. Usage:  python feed/scripts/build_feed.py [--offline]
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match import score_posting, eligibility_flags  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "feed" / "config"
STATE = ROOT / "feed" / "state"
OUT = ROOT / "docs" / "data"
UA = "Mozilla/5.0 (internship-hub feed builder; personal use)"
NOW = int(time.time())
DAY = 86400


def load(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def http(url: str, body: dict | None = None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def strip_html(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def is_intern(title: str) -> bool:
    return bool(re.search(r"\b(intern|internship|co-?op)\b", title, re.I))


def other_season_only(title: str, term: str) -> bool:
    """True for e.g. 'Winter/Spring 2027 Co-op' when we want Summer."""
    season = term.split()[0].lower()
    seasons = set(re.findall(r"\b(summer|fall|autumn|winter|spring)\b", title.lower()))
    return bool(seasons) and season not in seasons


def mentions_term(text: str, term: str) -> bool:
    year = term.split()[-1]
    return bool(re.search(rf"\b{year}\b", text))


def make_id(company: str, title: str, url: str) -> str:
    key = re.sub(r"[?#].*$", "", url.strip().lower())
    key = re.sub(r"^https?://(www\.|job-boards\.)?", "", key).replace("boards.greenhouse.io", "greenhouse.io")
    key = key.rstrip("/") or f"{company}|{title}".lower()
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def posting(company, title, url, locations, posted, source, category="", description=""):
    return {
        "id": make_id(company, title, url),
        "company": company.strip(),
        "title": title.strip(),
        "url": url.strip(),
        "locations": [l.strip() for l in locations if l and l.strip()],
        "posted": int(posted) if posted else None,
        "source": source,
        "category": category or "",
        "description": description,
    }


# ---------- source adapters ----------

def fetch_community(src, term):
    rows = http(src["url"])
    out = []
    for x in rows:
        if not x.get("active", True) or not x.get("is_visible", True):
            continue
        terms = x.get("terms") or ([f'{x.get("season")} 2027'] if x.get("season") else [])
        if term not in terms:
            continue
        out.append(posting(x.get("company_name", ""), x.get("title", ""), x.get("url", ""),
                           x.get("locations") or [], x.get("date_posted"), src["name"], x.get("category", "")))
    return out


def fetch_greenhouse(src, term):
    data = http(f'https://boards-api.greenhouse.io/v1/boards/{src["board"]}/jobs?content=true')
    out = []
    for j in data.get("jobs", []):
        title = j.get("title", "")
        if not is_intern(title) or other_season_only(title, term):
            continue
        desc = strip_html(j.get("content", ""))
        if not mentions_term(title + " " + desc, term):
            continue
        posted = j.get("first_published") or j.get("updated_at")
        out.append(posting(src["company"], title, j.get("absolute_url", ""),
                           [(j.get("location") or {}).get("name", "")], iso_to_ts(posted),
                           f'Greenhouse ({src["company"]})', description=desc[:6000]))
    return out


def fetch_lever(src, term):
    data = http(f'https://api.lever.co/v0/postings/{src["account"]}?mode=json')
    out = []
    for j in data:
        title = j.get("text", "")
        desc = strip_html(j.get("descriptionPlain") or j.get("description", ""))
        if not is_intern(title) or other_season_only(title, term) or not mentions_term(title + " " + desc, term):
            continue
        loc = (j.get("categories") or {}).get("location", "")
        out.append(posting(src["company"], title, j.get("hostedUrl", ""), [loc],
                           (j.get("createdAt") or 0) / 1000, f'Lever ({src["company"]})', description=desc[:6000]))
    return out


def fetch_workday(src, term):
    base = f'https://{src["host"]}/wday/cxs/{src["tenant"]}/{src["site"]}'
    out, offset = [], 0
    while offset < 400:
        page = http(f"{base}/jobs", {"limit": 20, "offset": offset, "searchText": src.get("search", "intern"),
                                     "appliedFacets": {}})
        jobs = page.get("jobPostings", [])
        for j in jobs:
            title = j.get("title", "")
            # Workday titles usually carry the year; accept "Summer ... Intern" without one.
            if not is_intern(title) or other_season_only(title, term) or not (mentions_term(title, term) or re.search(r"summer", title, re.I)):
                continue
            path = j.get("externalPath", "")
            out.append(posting(src["company"], title, f'https://{src["host"]}/{src["site"]}{path}',
                               [tidy_location(j.get("locationsText", ""))], workday_posted(j.get("postedOn", "")),
                               f'Workday ({src["company"]})'))
        offset += 20
        if offset >= page.get("total", 0) or not jobs:
            break
    return out


def tidy_location(loc: str) -> str:
    """'US-IA-CEDAR RAPIDS-108 ~ 400 Collins Rd NE' -> 'Cedar Rapids, IA'."""
    m = re.match(r"^US-([A-Z]{2})-([A-Z .'-]+?)(?:-\w*\d\w*)?\s*(?:~|$)", loc)
    return f"{m.group(2).strip().title()}, {m.group(1)}" if m else loc


def iso_to_ts(s):
    if not s:
        return None
    from datetime import datetime
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def workday_posted(text: str):
    t = text.lower()
    if "today" in t:
        return NOW
    if "yesterday" in t:
        return NOW - DAY
    m = re.search(r"(\d+)\+?\s+days?", t)
    return NOW - int(m.group(1)) * DAY if m else None


ADAPTERS = {"community": fetch_community, "greenhouse": fetch_greenhouse, "lever": fetch_lever,
            "workday": fetch_workday}


# ---------- pipeline ----------

def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def dedupe(items):
    """Merge duplicates across sources. Company ATS entries win (they carry descriptions)."""
    by_key, url_key = {}, {}
    for p in items:
        loc = norm(p["locations"][0]) if p["locations"] else ""
        key = url_key.get(p["id"]) or (norm(p["company"])[:12], norm(p["title"]), loc)
        cur = by_key.get(key)
        if cur is None:
            by_key[key] = p
            url_key.setdefault(p["id"], key)
            continue
        keep, other = (p, cur) if p["description"] and not cur["description"] else (cur, p)
        if other["posted"] and (not keep["posted"] or other["posted"] < keep["posted"]):
            keep["posted"] = other["posted"]
        keep["category"] = keep["category"] or other["category"]
        keep.setdefault("also_on", []).append(other["source"])
        by_key[key] = keep
        url_key.setdefault(other["id"], key)
    return list(by_key.values())


def is_us(locations) -> bool:
    if not locations:
        return True
    for l in locations:
        if re.search(r",\s*[A-Z]{2}$|United States|\bUSA?\b|Remote", l) and not re.search(r"Canada|\bON\b|\bBC\b|\bQC\b", l):
            return True
    return False


def check_watchlist(watch, postings, wstate):
    promoted = []
    for item in watch["items"]:
        st = wstate.setdefault(item["id"], {"status": "NOT_YET", "opened_at": None})
        hits = []
        for p in postings:
            if not re.search(item["company_regex"], p["company"], re.I):
                continue
            if not re.search(item["title_regex"], p["title"], re.I):
                continue
            if item.get("location_regex") and not any(re.search(item["location_regex"], l, re.I) for l in p["locations"]):
                continue
            hits.append(p["id"])
        if hits and st["status"] == "NOT_YET":
            if item.get("notify", True):
                st.update(status="OPEN", opened_at=NOW)
                promoted.append(item["id"])
            else:
                st.update(status="POSTED", opened_at=NOW)
        st["matches"] = hits[:10]
        st["last_checked"] = NOW
    return promoted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="reuse docs/data/raw cache instead of fetching")
    args = ap.parse_args()

    sources = load(CONFIG / "sources.json")
    profile = load(CONFIG / "profile.json")
    watch = load(CONFIG / "watchlist.json")
    term = sources["term"]

    collected, report = [], []
    cache = STATE / "raw_cache.json"
    if args.offline:
        collected = load(cache, [])
        report.append({"name": "offline cache", "ok": True, "count": len(collected)})
    else:
        for kind, fn in ADAPTERS.items():
            for src in sources.get(kind, []):
                name = src.get("name") or f'{kind}:{src.get("company")}'
                try:
                    got = fn(src, term)
                    collected += got
                    report.append({"name": name, "ok": True, "count": len(got)})
                except Exception as e:  # one broken source must not kill the run
                    report.append({"name": name, "ok": False, "count": 0, "error": str(e)[:200]})
                    print(f"WARN {name}: {e}", file=sys.stderr)
        if os.environ.get("FEED_CACHE"):
            save(cache, collected)

    postings = dedupe([p for p in collected if not other_season_only(p["title"], term)])

    seen = load(STATE / "seen.json", {})
    baseline = not seen
    new_ids = []
    for p in postings:
        if p["id"] not in seen:
            seen[p["id"]] = NOW
            new_ids.append(p["id"])
        p["first_seen"] = seen[p["id"]]
        p["us"] = is_us(p["locations"])
        p["match"] = score_posting(p, profile)
        p["flags"] = eligibility_flags(p, profile)
        p["has_description"] = bool(p.pop("description"))
    # Forget ids not seen for 120 days so the state file stays small.
    live = {p["id"] for p in postings}
    seen = {k: v for k, v in seen.items() if k in live or NOW - v < 120 * DAY}

    wstate = load(STATE / "watchlist_state.json", {})
    promoted = check_watchlist(watch, postings, wstate)

    postings.sort(key=lambda p: (p["posted"] or p["first_seen"]), reverse=True)

    save(OUT / "feed.json", {"generated_at": NOW, "term": term, "sources": report, "count": len(postings),
                             "postings": postings})
    save(OUT / "watchlist.json", {"generated_at": NOW, "items": [
        {**item, **wstate[item["id"]]} for item in watch["items"]]})
    by_id = {p["id"]: p for p in postings}
    new_sorted = sorted((by_id[i] for i in new_ids), key=lambda p: -p["match"]["score"])
    changes = {"generated_at": NOW, "baseline": baseline, "new_count": len(new_ids),
               "new_ids": [p["id"] for p in new_sorted], "promoted": promoted}
    save(OUT / "changes.json", changes)
    save(STATE / "seen.json", seen)
    save(STATE / "watchlist_state.json", wstate)
    write_summary(changes, new_sorted, watch, report)
    print((STATE / "run_summary.md").read_text(encoding="utf-8"))


def write_summary(changes, new_sorted, watch, report):
    names = {i["id"]: i["name"] for i in watch["items"]}
    lines = [f"# Internship feed run {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(NOW))}", ""]
    if changes["promoted"]:
        lines += ["## Watchlist programs that just opened", ""]
        lines += [f"- **{names[i]}**" for i in changes["promoted"]] + [""]
    if changes["baseline"]:
        lines += [f"Baseline run: {changes['new_count']} postings recorded. Later runs report only new ones.", ""]
    else:
        lines += [f"## {changes['new_count']} new postings", ""]
    good = [p for p in new_sorted if p["match"]["label"] != "Low" and p["us"]][:25]
    if good:
        lines += ["| Match | Company | Role | Location |", "|---|---|---|---|"]
        for p in good:
            lines.append(f"| {p['match']['label']} ({p['match']['score']}) | {p['company']} | "
                         f"[{p['title']}]({p['url']}) | {', '.join(p['locations'][:2])} |")
        lines.append("")
    bad = [s for s in report if not s["ok"]]
    if bad:
        lines += ["## Sources that failed", ""] + [f"- {s['name']}: {s.get('error', '')}" for s in bad] + [""]
    lines.append("_Match is a keyword heuristic on the title (and the description when the company board provides one), not a prediction._")
    (STATE / "run_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
