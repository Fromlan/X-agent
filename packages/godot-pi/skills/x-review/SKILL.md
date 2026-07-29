---
name: x-review
description: Single-agent two-axis review of a diff (Standards vs Spec). Use when reviewing a branch, commit range, or WIP changes since a fixed point.
---

# Review

One session, one agent. No parallel sub-agents.

## 1. Fixed point

Ask for the comparison base if missing (`main`, SHA, tag, `HEAD~n`). Verify with `git rev-parse` and a non-empty `git diff <base>...HEAD`.

## 2. Spec source (optional)

In order: commit/issue references the user cares about → a path they pass → brief/PRD under `docs/`, `specs/`, `.pi/briefs/`, `.scratch/`. If none, skip Spec and say so.

## 3. Standards sources

Repo docs (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, `CLAUDE.md` / `AGENTS.md` sections). Judgement-call smells only when they matter in the diff (mystery names, duplication, shotgun edits, speculative generality). Skip anything already enforced by the project's linters/formatters.

## 4. Report

```markdown
## Standards
- …

## Spec
- … (or "no spec available")

## Summary
Standards: N findings. Spec: M findings. Worst in each axis: …
```

Do not merge the axes into one ranked list.
