#!/bin/bash
# Refreshes cookies.txt from the dedicated throwaway-account Firefox profile.
#
# Doesn't launch Firefox itself: snap-packaged Firefox has a documented bug
# where the classic -P/--profile command-line flag can't reliably switch
# profiles, and Firefox's newer profile-management UI (Firefox 144+) is a
# separate system that isn't controllable from the command line at all. So
# you switch profiles by hand (hamburger menu -> Profiles), and this script
# only takes over afterward, reading that profile's cookies straight off
# disk via yt-dlp — which doesn't go through Firefox's own launch mechanism,
# so the snap bug doesn't apply to it.
#
# Order also matters: the export has to happen AFTER Firefox is fully
# closed, not before — YouTube actively rotates session cookies while a tab
# is open, so reading the cookie database while Firefox is still running
# risks capturing a value mid-rotation instead of the settled final one.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# --- fill this in once ---
# Full on-disk path to the throwaway profile's directory. Don't guess this
# from folder names/about:profiles — Firefox's new profile system can
# silently recreate a profile under a fresh folder (it did once already
# here). To get the authoritative current path, query its own database:
#   python3 -c "
#   import sqlite3, glob
#   db = glob.glob('$HOME/snap/firefox/common/.mozilla/firefox/Profile Groups/*.sqlite')[0]
#   con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
#   print(con.execute('SELECT name, path FROM Profiles').fetchall())
#   "
# and match the profile by its `name` (the nickname you gave it, e.g.
# "Throwaway1") to get its current `path`.
PROFILE_PATH="/home/lluis/snap/firefox/common/.mozilla/firefox/jy7echav.default-1790542158038"
# --- end config ---

COOKIES_FILE="cookies.txt"
YTDLP_BIN=".venv/bin/yt-dlp"
CHECK_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"

if [ "$PROFILE_PATH" = "CHANGE_ME" ]; then
  echo "Edit this script and set PROFILE_PATH (see the comment above) to your throwaway profile's current directory." >&2
  exit 1
fi
if [ ! -d "$PROFILE_PATH" ]; then
  echo "WARNING: \"$PROFILE_PATH\" doesn't exist anymore — Firefox's profile system may have moved it again." >&2
  echo "Re-run the sqlite query in this script's comments to find its current path." >&2
  exit 1
fi

echo "1. Open Firefox normally."
echo "2. Click the hamburger menu (☰, top-right) -> Profiles -> switch to Throwaway1."
echo "3. Confirm you're logged into YouTube there (log in again if needed)."
echo "4. Optionally play a few seconds of any video, to keep it a real, human-looking session."
echo "5. Fully close Firefox entirely."
read -rp "Press Enter once Firefox is fully closed... "
echo "Exporting cookies..."

if [ -f "$COOKIES_FILE" ]; then
  rm -f "$COOKIES_FILE"
fi

"$YTDLP_BIN" --js-runtimes node --remote-components ejs:github \
  --cookies-from-browser "firefox:$PROFILE_PATH" --cookies "$COOKIES_FILE" --skip-download \
  "$CHECK_URL"

FIRST_LINE=$(head -n1 "$COOKIES_FILE" 2>/dev/null || true)
if [ "$FIRST_LINE" != "# HTTP Cookie File" ] && [ "$FIRST_LINE" != "# Netscape HTTP Cookie File" ]; then
  echo "WARNING: $COOKIES_FILE doesn't look like a valid Netscape cookie file (first line: \"$FIRST_LINE\")." >&2
  exit 1
fi

echo "Success: wrote a fresh $COOKIES_FILE."
echo "If you're using Docker, no rebuild is needed — it's bind-mounted and picked up on the next download."
