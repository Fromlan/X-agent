# ADR-0001: Session modes (Ask / Plan / Goal)

## Status

Accepted

## Context

Coding agents need distinct interaction modes: read-only Q&A, plan-then-build, and auto-continue until a verifiable goal. Competitors (Cursor, Claude Code, Codex) expose these as first-class product surfaces.

## Decision

X-agent hosts Ask / Plan / Goal as **mutually exclusive session modes** in the Electron main process (`SessionModeController`), not as a separate Pi Extension package.

- Ask / Plan: temporary read-only tool sets + `tool_call` hard gate; prefs.tools unchanged.
- Plan: custom `write_plan` + right-panel editor + 「执行计划」.
- Goal: completion condition + independent `completeSimple` evaluator + auto-continue with **turn budget**, **pause/resume**, and **on-disk journal** keyed by session path.

## Consequences

- Mode state lives in SessionHost; IPC facades under `plan.*`.
- Follow-ups (dedicated small evaluator model, richer clarify UX) can evolve without changing the mode enum.
