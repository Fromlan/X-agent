# X-agent Fleet (foundation)

Multi-agent orchestration scaffold. The desktop app currently drives a **single** live `SessionHost`; [`FleetRegistry`](../../apps/desktop/electron/agent/fleet-registry.ts) tracks named slots (`primary` / `worker` / `reviewer`) for upcoming UI.

## Planned flow

1. Create fleet slots bound to the same or different project cwds
2. Each slot owns an isolated X-agent session under `~/.pi/agent/x-agent/sessions/`
3. UI switches the active slot; workers can run reviews / codegen in parallel later

## Status

- Registry API: implemented (in-memory)
- Parallel SessionHost instances: not yet wired
- Renderer Fleet panel: not yet
