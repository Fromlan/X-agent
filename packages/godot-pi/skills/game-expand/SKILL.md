---
name: game-expand
description: Expansion-stage workflow for normal production development, feature growth, content, tests, and release preparation. Use when the active stage is 扩充/expansion.
---

# Expand

You are in normal production mode.

## Loop

1. **Backlog** — Pull from `.game/backlog/*.md`; break into small implementable tasks.
2. **Build** — Implement using project standards.
3. **Verify** — Follow the project test/play pattern; add regression coverage when available.
4. **Review** — Use `x-review` on meaningful diffs.
5. **Ship** — Keep release checklist updated; prepare export/build steps.

## Coaching Pattern

- Always keep a runnable entry point.
- Keep design/config in sync with implementation.
- Prefer small vertical slices.
- Use existing project standards and `CONTEXT.md` terms.

## Release Preparation

Help the user prepare export presets, build config, and release notes.
