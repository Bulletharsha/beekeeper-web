#!/bin/bash
# Deploy the Beekeeper PWA to GitHub Pages.
# Usage: GH_PAT=<token> ./scripts/deploy_pages.sh
# The PAT is used transiently via env and never written to disk.
# NOTE: commit this script before running it — the orphan-branch flow
# below checks out main at the end, which reverts uncommitted changes.
set -euo pipefail

REPO="Bulletharsha/beekeeper-web"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${GH_PAT:-}" ]; then
  echo "GH_PAT is required" >&2
  exit 1
fi

# Git doesn't pick up the egress proxy auth from the environment on its own.
export GIT_PROXY="x"
PROXY_ARGS=(-c "http.proxy=$https_proxy" -c "https.proxy=$https_proxy")

cd "$ROOT"

# 0. Hermetic build: node_modules and .env.local are gitignored and may not
#    survive VM restarts, so install and build here every time.
if [ ! -f web/.env.local ]; then
  echo "web/.env.local missing — recreate it with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY" >&2
  exit 1
fi
echo "Installing dependencies and building..."
(cd web && npm ci --no-audit --no-fund && npm run build) || exit 1

# 1. Push source to main (first time: remote may not exist yet).
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${REPO}.git"
fi
echo "Pushing source to main..."
git "${PROXY_ARGS[@]}" push "https://${GH_PAT}@github.com/${REPO}.git" main

# 2. Push web/dist to the gh-pages branch. (dist/ is gitignored, so build
#    the branch directly instead of subtree-split.)
echo "Publishing web/dist to gh-pages..."
git checkout -q main
git branch -q -D gh-pages-tmp 2>/dev/null || true
git checkout -q --orphan gh-pages-tmp
git rm -q -rf .
cp -r web/dist/. .
touch .nojekyll
# Add only the site files. Never a bare `git add -A` here: `git rm` above
# deleted the tracked .gitignore files, so -A would swallow web/node_modules,
# web/dist and web/.env.local into the pages commit — and the final checkout
# back to main would then delete them from disk.
git add -A -- ':!web'
git -c user.name=Coca -c user.email=coca@local commit -qm "Deploy Beekeeper PWA"
git "${PROXY_ARGS[@]}" push "https://${GH_PAT}@github.com/${REPO}.git" gh-pages-tmp:gh-pages --force
git checkout -q main
git branch -q -D gh-pages-tmp

# 3. Enable Pages (idempotent: update if already enabled).
echo "Enabling GitHub Pages..."
GH_TOKEN="$GH_PAT" gh api "repos/${REPO}/pages" -X POST \
  -f 'source[branch]=gh-pages' -f 'source[path]=/' 2>/dev/null \
  || GH_TOKEN="$GH_PAT" gh api "repos/${REPO}/pages" -X PUT \
  -f 'source[branch]=gh-pages' -f 'source[path]=/' --silent

echo "Done. Site: https://bulletharsha.github.io/beekeeper-web/"
