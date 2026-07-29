---
name: x-change-brief
description: Distill the current conversation into a short local change brief. Use when locking scope before implementation or when the user runs /x-change-brief.
disable-model-invocation: true
---

# Change brief

Synthesize what was already discussed. Do not run a new interview (use `/x-grill` if alignment is missing).

## Output sections

1. **Goal** — One paragraph.
2. **Non-goals** — Explicit exclusions.
3. **Touch files** — Paths expected to change (best effort from conversation + repo).
4. **Acceptance** — Checkable outcomes.
5. **Risks** — Top 1–3.

## Persist

Prefer writing under the project:

- `.pi/briefs/<short-slug>.md` if `.pi/` exists or may be created, else
- `.scratch/briefs/<short-slug>.md`

Ask once if neither convention fits. Do **not** create GitHub/Linear issues unless the user asks.
