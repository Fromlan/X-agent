---
name: x-tdd
description: Red-green-refactor TDD in small vertical slices. Use when building a feature or bugfix that should be proven with automated tests.
---

# TDD

Work in one session. Prefer the project's existing test runner.

## Loop

1. **Slice** — One behaviour small enough to finish in one red-green cycle.
2. **Red** — Write a failing test that names the behaviour. Run it; confirm it fails for the right reason.
3. **Green** — Minimal production code to pass. No speculative abstractions.
4. **Refactor** — Clean structure only while green. Re-run tests.
5. Repeat for the next slice.

## Guidance

- Prefer testing through a stable interface (public API, node script contract), not private guts.
- Skip TDD only when the user opts out or there is no runnable test setup — say so and propose a manual check instead.
