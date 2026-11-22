#!/usr/bin/env bash
# Prints the next semver tag for HEAD as GitHub Actions outputs
# (next=, last=, bump=, skip=), based on Conventional Commits since the
# latest vX.Y.Z tag. Used by .github/workflows/release.yml.
set -euo pipefail

# Already released (e.g. a re-run of the workflow): do nothing.
if git tag --points-at HEAD | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "skip=true"
  exit 0
fi

LAST=$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)
if [ -z "$LAST" ]; then
  LAST=v0.0.0
  RANGE=HEAD
else
  # merge-base, not the tag itself, so a tag cut on another branch still works.
  BASE=$(git merge-base "$LAST" HEAD || true)
  RANGE=${BASE:+$BASE..}HEAD
fi

LOG=$(git log --format='%s%n%b' "$RANGE")

# No `grep -q` here: it exits on the first match, and with a long log `printf`
# then dies on the closed pipe, which `pipefail` reports as "no match".
if printf '%s\n' "$LOG" | grep -E '^[a-zA-Z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:' > /dev/null; then
  BUMP=major
elif printf '%s\n' "$LOG" | grep -E '^feat(\([^)]*\))?:' > /dev/null; then
  BUMP=minor
else
  BUMP=patch
fi

IFS=. read -r MAJOR MINOR PATCH <<< "${LAST#v}"
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

echo "skip=false"
echo "last=$LAST"
echo "bump=$BUMP"
echo "next=v$MAJOR.$MINOR.$PATCH"
