#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -e .git ]; then
  echo "ERROR: this folder is not a git checkout (no .git/ here)." >&2
  echo "Please unzip a fresh copy of biodata and try again." >&2
  exit 1
fi

echo "Fetching latest from release..."
git fetch origin --quiet

HEAD_BEFORE=$(git rev-parse HEAD)
HEAD_AFTER=$(git rev-parse origin/release)

if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
  echo "Already on the latest release ($HEAD_BEFORE)."
  exit 0
fi

echo
echo "Pending commits:"
git log --oneline --no-decorate "$HEAD_BEFORE..$HEAD_AFTER"
echo

PKG_OLD=$(shasum src/package.json 2>/dev/null | awk '{print $1}' || true)

echo "Applying update..."
git reset --hard origin/release

PKG_NEW=$(shasum src/package.json 2>/dev/null | awk '{print $1}' || true)
if [ "$PKG_OLD" != "$PKG_NEW" ] && [ -f src/package.json ]; then
  echo "package.json changed - installing dependencies..."
  npm --prefix src install
else
  echo "package.json unchanged or absent - skipping npm install."
fi

NEW_SHA=$(git rev-parse --short HEAD)
N_COMMITS=$(git rev-list --count "$HEAD_BEFORE..$HEAD_AFTER")
echo
echo "Updated to $NEW_SHA. $N_COMMITS commit(s) applied."
echo "Try /search to query the dataset, or /setup if anything looks off."
