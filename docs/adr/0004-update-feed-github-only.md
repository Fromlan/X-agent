# ADR-0004: Auto-update feed is GitHub Releases only

## Status

Accepted

## Context

Dual update sources (GitHub + Gitee) added prefs complexity and feed-resolution bugs. Distribution is Windows-first via GitHub Releases for `Fromlan/X-agent`.

## Decision

Packaged builds use `electron-updater` with `provider: "github"` only. Legacy `updateSource` prefs are ignored on load. Settings can open the Releases page as a manual fallback.

## Consequences

- Gitee mirrors are not supported for auto-update.
- CI release workflow remains the canonical artifact publisher.
