#!/bin/bash
# Deploy the Beekeeper PWA to GitHub Pages.
# Usage: GH_PAT=<token> ./deploy_pages.sh
# The PAT is used transiently via env and never written to disk.
set -euo pipefail

REPO="Bulletharsha/beekeeper-web"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${GH_PAT:-}" ]; then
  echo "GH_PAT is required" >&2
  exit 1
fi

cd "$ROOT"

# 1. Push source to main (first time: remote may not exist yet).
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${REPO}.git"
fi
echo "Pushing source to main..."
git push "https://${GH_PAT}@github.com/${REPO}.git" main

# 2. Push web/dist to the gh-pages branch.
echo "Building gh-pages branch from web/dist..."
git subtree split --prefix web/dist -b gh-pages >/dev/null
git push "https://${GH_PAT}@github.com/${REPO}.git" gh-pages --force

# 3. Enable Pages (idempotent: update if already enabled).
echo "Enabling GitHub Pages..."
GH_TOKEN="$GH_PAT" gh api "repos/${REPO}/pages" -X POST \
  -f 'source[branch]=gh-pages' -f 'source[path]=/' 2>/dev/null \
  || GH_TOKEN="$GH_PAT" gh api "repos/${REPO}/pages" -X PUT \
  -f 'source[branch]=gh-pages' -f 'source[path]=/' --silent

echo "Done. Site: https://bulletharsha.github.io/beekeeper-web/"
