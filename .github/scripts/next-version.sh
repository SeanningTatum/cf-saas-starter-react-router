#!/usr/bin/env bash
# Prints the next semver tag for HEAD as GitHub Actions outputs
# (next=, last=, bump=, skip=), based on Conventional Commits since the
# latest vX.Y.Z tag. Used by .github/workflows/release.yml.
#
# Never use the quiet flag of grep here. It exits on the first match, and with
# a long log the writer then dies on the closed pipe, which `pipefail` reports
# as "no match" (a breaking change would be read as a patch). Every grep below
# reads its whole input.
set -euo pipefail

SEMVER_TAG='^v[0-9]+\.[0-9]+\.[0-9]+$'
BREAKING='^[a-zA-Z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:'
FEATURE='^feat(\([^)]*\))?:'

TAGS_AT_HEAD=$(git tag --points-at HEAD | grep -E "$SEMVER_TAG" || true)
if [ -n "$TAGS_AT_HEAD" ]; then
  echo "skip=true"
  exit 0
fi

LAST=$(git tag -l 'v*' --sort=-v:refname | grep -E "$SEMVER_TAG" | sed -n 1p || true)
if [ -z "$LAST" ]; then
  LAST=v0.0.0
  RANGE=HEAD
else
  # merge-base, not the tag itself, so a tag cut on another branch still works.
  BASE=$(git merge-base "$LAST" HEAD || true)
  RANGE=${BASE:+$BASE..}HEAD
fi

LOG=$(git log --format='%s%n%b' "$RANGE")

BREAKING_HITS=$(printf '%s\n' "$LOG" | grep -E "$BREAKING" || true)
FEATURE_HITS=$(printf '%s\n' "$LOG" | grep -E "$FEATURE" || true)

if [ -n "$BREAKING_HITS" ]; then
  BUMP=major
elif [ -n "$FEATURE_HITS" ]; then
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
