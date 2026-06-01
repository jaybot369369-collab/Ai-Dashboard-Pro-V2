#!/usr/bin/env python3
"""Local pull-only backup of the AI Dashboard Pro V2 (Railway-hosted).

One pass, then exits — launchd re-runs it every 5 minutes.

  json/  : trade data ONLY, pulled from the Railway fund API.
           json/dashboard_state.json  — full latest state (ai_key stripped)
           json/trades/<trade.id>/    — per-trade subfolder:
                trade.json + screenshot_0.<ext>, screenshot_1.<ext>, ...
  html/  : a git mirror of the V2 site repo (git pull keeps it current).

Read-only / pull-only: it NEVER writes to the dashboard, the fund DB, or
pushes git. Network/host failures are non-fatal (logged, exit 0, retry next tick).
"""

import base64
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# --- config -----------------------------------------------------------------
BACKUP_ROOT = "/Users/claudebot-1/_2026 Dashboard Backup"
STATE_URL = "https://q2-2026-fund-production.up.railway.app/api/dashboard/state"
GIT_REMOTE = "https://github.com/jaybot369369-collab/Ai-Dashboard-Pro-V2.git"

JSON_DIR = os.path.join(BACKUP_ROOT, "json")
TRADES_DIR = os.path.join(JSON_DIR, "trades")
HTML_DIR = os.path.join(BACKUP_ROOT, "html")
LAST_FILE = os.path.join(BACKUP_ROOT, "_last_backup.txt")

MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
}


def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)


def get_screenshots(t):
    """Mirror of js/data.js:getScreenshots — array field preferred, legacy comma-string fallback."""
    urls = t.get("screenshotUrls")
    if isinstance(urls, list):
        return [u for u in urls if u]
    legacy = t.get("screenshotUrl")
    if not legacy:
        return []
    return [s.strip() for s in re.split(r",(?=https?:|data:)", legacy) if s.strip()]


def ext_from_dataurl(header):
    m = re.match(r"data:([^;,]+)", header or "")
    return MIME_EXT.get((m.group(1).lower() if m else ""), "png")


def ext_from_http(url, content_type):
    if content_type:
        e = MIME_EXT.get(content_type.split(";")[0].strip().lower())
        if e:
            return e
    path = url.split("?")[0].split("#")[0]
    tail = path.rsplit(".", 1)[-1].lower()
    if tail in ("png", "jpg", "jpeg", "webp", "gif", "svg"):
        return "jpg" if tail == "jpeg" else tail
    return "png"


def save_screenshot(folder, idx, url):
    """Write one screengrab. Returns True if a new file was written."""
    # base64 data URL — decode locally
    if url.startswith("data:"):
        try:
            header, b64 = url.split(",", 1)
            ext = ext_from_dataurl(header)
            path = os.path.join(folder, f"screenshot_{idx}.{ext}")
            if os.path.exists(path):
                return False
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(b64))
            return True
        except Exception as e:
            log(f"  ! base64 screenshot {idx} failed: {e}")
            return False

    # remote (R2) URL — immutable, skip if already pulled for any extension
    if url.startswith("http"):
        for e in ("png", "jpg", "webp", "gif", "svg"):
            if os.path.exists(os.path.join(folder, f"screenshot_{idx}.{e}")):
                return False
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dashboard-backup"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                ext = ext_from_http(url, resp.headers.get("Content-Type"))
            with open(os.path.join(folder, f"screenshot_{idx}.{ext}"), "wb") as fh:
                fh.write(data)
            return True
        except Exception as e:
            log(f"  ! remote screenshot {idx} failed ({url[:60]}): {e}")
            return False
    return False


def backup_trades():
    """Pull state from Railway, write json/ + per-trade screengrab folders. Returns (n_trades, n_imgs)."""
    try:
        req = urllib.request.Request(STATE_URL, headers={"User-Agent": "dashboard-backup"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            state = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log(f"trade pull FAILED (will retry next tick): {e}")
        return None, 0

    state.pop("ai_key", None)  # never persist the secret
    trades = state.get("trades") or []

    os.makedirs(TRADES_DIR, exist_ok=True)
    with open(os.path.join(JSON_DIR, "dashboard_state.json"), "w") as fh:
        json.dump(state, fh, indent=2)

    new_imgs = 0
    for t in trades:
        tid = str(t.get("id") or t.get("createdAt") or "").strip()
        if not tid:
            continue
        tid = re.sub(r"[^A-Za-z0-9._-]", "_", tid)
        folder = os.path.join(TRADES_DIR, tid)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "trade.json"), "w") as fh:
            json.dump(t, fh, indent=2)
        for idx, url in enumerate(get_screenshots(t)):
            if save_screenshot(folder, idx, url):
                new_imgs += 1

    log(f"trades: {len(trades)} saved, {new_imgs} new screengrab(s)")
    return len(trades), new_imgs


def backup_html():
    """Maintain html/ as a shallow git mirror of the V2 repo. Returns short HEAD or None."""
    try:
        if not os.path.isdir(os.path.join(HTML_DIR, ".git")):
            os.makedirs(BACKUP_ROOT, exist_ok=True)
            subprocess.run(["git", "clone", "--depth=1", GIT_REMOTE, HTML_DIR],
                           check=True, capture_output=True, timeout=180)
            log("html: cloned fresh mirror")
        else:
            subprocess.run(["git", "-C", HTML_DIR, "fetch", "--depth=1", "origin"],
                           check=True, capture_output=True, timeout=180)
            subprocess.run(["git", "-C", HTML_DIR, "reset", "--hard", "origin/HEAD"],
                           check=True, capture_output=True, timeout=60)
        head = subprocess.run(["git", "-C", HTML_DIR, "rev-parse", "--short", "HEAD"],
                              check=True, capture_output=True, text=True, timeout=30).stdout.strip()
        log(f"html: mirror at {head}")
        return head
    except subprocess.CalledProcessError as e:
        log(f"html mirror FAILED: {e.stderr.decode('utf-8', 'replace')[:200] if e.stderr else e}")
        return None
    except Exception as e:
        log(f"html mirror FAILED: {e}")
        return None


def main():
    os.makedirs(JSON_DIR, exist_ok=True)
    n_trades, n_imgs = backup_trades()
    head = backup_html()
    stamp = datetime.now(timezone.utc).isoformat()
    with open(LAST_FILE, "w") as fh:
        fh.write(f"last backup: {stamp}\n")
        fh.write(f"trades: {n_trades if n_trades is not None else 'FETCH FAILED'}\n")
        fh.write(f"new screengrabs this run: {n_imgs}\n")
        fh.write(f"html mirror HEAD: {head or 'FETCH FAILED'}\n")
    log("done")


if __name__ == "__main__":
    sys.exit(main())
