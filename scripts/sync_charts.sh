#!/usr/bin/env bash
# Sync freshly-generated top-down chart PNGs from /tmp/ict_topdown_charts/
# into the local dashboard folder so the Daily Report tab can render them.
#
# Safe to re-run. Only touches js/data/charts/.
#   - Copies *.png from /tmp/ict_topdown_charts/ → js/data/charts/
#   - Prunes js/data/charts/ entries whose <MMDD> is older than 14 days
set -eu

SRC="/tmp/ict_topdown_charts"
# Resolve V2 root relative to this script (scripts/ lives at the project root)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="${HERE%/scripts}/js/data/charts"

mkdir -p "$DST"

copied=0
if [ -d "$SRC" ]; then
  shopt -s nullglob
  for f in "$SRC"/*.png; do
    cp "$f" "$DST/"
    copied=$((copied + 1))
  done
  shopt -u nullglob
fi
echo "[sync_charts] Copied $copied PNG(s) from $SRC → $DST"

# Prune charts whose <MMDD> is > 14 days old.
# Filename pattern: <SYM>_<MMDD>_<d|h|m>.png
pruned=0
cutoff_epoch=$(date -v -14d +%s 2>/dev/null || date -d "-14 days" +%s)
current_year=$(date +%Y)
shopt -s nullglob
for f in "$DST"/*.png; do
  name=$(basename "$f" .png)
  mmdd=$(echo "$name" | awk -F_ '{print $2}')
  if ! echo "$mmdd" | grep -Eq '^[0-9]{4}$'; then continue; fi
  mm=${mmdd:0:2}
  dd=${mmdd:2:2}
  file_epoch=$(date -j -f "%Y-%m-%d" "${current_year}-${mm}-${dd}" +%s 2>/dev/null || date -d "${current_year}-${mm}-${dd}" +%s 2>/dev/null || echo "")
  if [ -z "$file_epoch" ]; then continue; fi
  # If date is in the future, it belongs to last year
  now_epoch=$(date +%s)
  if [ "$file_epoch" -gt "$now_epoch" ]; then
    file_epoch=$(date -j -f "%Y-%m-%d" "$((current_year - 1))-${mm}-${dd}" +%s 2>/dev/null || date -d "$((current_year - 1))-${mm}-${dd}" +%s 2>/dev/null || continue)
  fi
  if [ "$file_epoch" -lt "$cutoff_epoch" ]; then
    rm -f "$f"
    pruned=$((pruned + 1))
  fi
done
shopt -u nullglob
echo "[sync_charts] Pruned $pruned chart(s) older than 14 days from $DST"
