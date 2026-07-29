---
name: x-diagnose
description: Disciplined bug/performance diagnosis loop for a single session. Use when debugging hard failures, regressions, or unexplained behavior.
---

# Diagnose

Stay in one session. Do not spawn background agents.

## Loop

1. **Reproduce** — Steps, expected vs actual, environment (cwd, OS, relevant tools).
2. **Minimise** — Smallest path that still fails (file, scene, input).
3. **Hypothesise** — 1–3 ranked causes; pick the cheapest to falsify first.
4. **Instrument** — Add temporary logs/asserts or read existing signals; remove noise after.
5. **Fix** — Smallest change that addresses the confirmed cause.
6. **Regression** — Re-run the reproduce path; add or adjust a test if the project has a test harness.

## Anti-patterns

- Shotgun edits across unrelated files before a confirmed cause.
- Claiming “fixed” without re-running the failing path.
