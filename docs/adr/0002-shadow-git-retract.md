# ADR-0002: Shadow Git checkpoints for retract

## Status

Accepted

## Context

Retract / edit-resend / regenerate must undo workspace file changes made during a turn. Relying on the user's project `.git` is unsafe and often unavailable.

## Decision

Prefer an isolated **Shadow Git** store under `~/.pi/agent/x-agent/checkpoints/` (per project). Fall back to `turn-file-tracker` baselines for `write`/`edit` when Git is unavailable.

Binding must occur after Pi `appendMessage` so the leaf entry id matches the checkpoint (see AGENT_CONTEXT / CHANGELOG 0.3.4).

## Consequences

- Retract of cwd-external bash side effects is still not guaranteed.
- Shadow Git is independent of the user's repository history.
