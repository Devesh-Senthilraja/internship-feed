# Internship Feed

A daily Summer 2027 internship feed with a pinned watchlist of programs that haven't opened yet,
published with GitHub Pages: **https://devesh-senthilraja.github.io/internship-feed/**

Everything here is public. Personal files live in a separate private repo.

## How it works

Every 6 hours, `.github/workflows/daily-feed.yml`:

1. pulls the SimplifyJobs and vanshb03 Summer 2027 trackers plus company boards
   (Greenhouse: SpaceX, Anduril, Relativity; Workday: NVIDIA, RTX),
2. keeps Summer 2027 postings, merges duplicates across sources, scores each one and flags eligibility hints,
3. diffs against the last run (`feed/state/seen.json`) and checks the watchlist,
4. commits `docs/data/*.json`, which redeploys the Pages site,
5. opens an issue when a watchlist program opens or new Medium/High US matches appear.

| Path | What it is |
|---|---|
| `feed/config/sources.json` | Data sources |
| `feed/config/watchlist.json` | Pinned programs and the regexes that detect when they open |
| `feed/config/profile.json` | Skill keywords and weights for the match score |
| `feed/config/corrections.json` | Live-site checks that override the aggregators (postings dropped by URL) |
| `feed/scripts/build_feed.py` | The pipeline (Python standard library only) |
| `feed/state/` | First-seen dates, watchlist state, latest run summary |
| `docs/` | The Pages site |

## On the page

- **☆ Pin** keeps a posting at the top of the page. Pins are saved in your browser only.
- **+ Tracker** opens the private My Applications tracker with the posting ready to add, on any device.
- **N sources** in the header lists every source with a link and its posting count. Each tile's "via" line names the sources that listed it.

## Run locally

```sh
python feed/scripts/build_feed.py
python -m http.server -d docs 8000   # http://localhost:8000
```

## Notes

- **Match score** is keyword overlap with a fixed skill list (embedded C++, firmware, CAN, Linux,
  robotics, ROS2, OpenCV…) plus a category bonus. Community listings only carry a title, so treat it
  as a sorting aid, not a prediction.
- **Eligibility flags** (underclass-friendly, grad-level, grad window, ITAR / U.S. person required)
  are keyword guesses. Confirm on the company page; company pages beat aggregators.
- Indeed and Glassdoor are not scraped. careers.rtx.com sits behind Cloudflare, so RTX's Workday API is used instead.

## Setup

- **Pages:** Settings → Pages → Deploy from a branch → `main`, folder `/docs`.
- **Scheduled job:** runs every 6 hours from `main` (01:17, 07:17, 13:17 and 19:17 UTC). Run it by hand from Actions → *Daily internship feed* → Run workflow.
- **Notifications:** turn on GitHub notifications for this repo's issues.
