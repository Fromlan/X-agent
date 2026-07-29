---
name: godot-state-machine
description: Godot 4 finite state machine with State base, StateMachine, and transitions. Use when implementing character/AI FSMs or replacing large match/if state logic.
---

# State machine

**Custom pattern** — Godot has no built-in `State` / `StateMachine` node types. Implement as your own scripts/scenes (often child `Node`s).

## Shape

- `State` (your class) — `enter` / `exit` / `update` / `physics_update` / `handle_input` as needed.
- `StateMachine` (your class) — owns current state, `transition_to(name)`, optional `@export` initial state.
- One responsibility per state; shared data via the owner node or a small context object.

## Practice

- Explicit transitions; log illegal ones in debug builds.
- Prefer signals or return codes for “request transition”, not mutating another state’s internals.
- Drive `update` from the owner’s `_process` / `_physics_process` (or call into active state from there).
