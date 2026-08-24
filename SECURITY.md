# Security Policy

## Supported Versions

X-agent follows a single-main-branch model: only the latest release line on
the `master` branch receives security fixes. We do not backport patches to
older releases.

| Release line | Status | Notes |
|---|---|---|
| `master` (latest) | ✅ Supported | Receives all security and stability fixes |
| Tagged releases older than the latest | ❌ Unsupported | Please upgrade |

The current latest release is read from
[`apps/desktop/package.json`](apps/desktop/package.json) `version` field
and the most recent Git tag; the authoritative user-facing artifacts are
GitHub Releases (see [`README.md`](README.md) for the download link).

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for security-sensitive reports.**

Use one of the following channels:

- **Email**: [fromlan@qq.com](mailto:fromlan@qq.com) (preferred for sensitive
  issues; include `[SECURITY]` in the subject line)
- **GitHub Security Advisories**: use the "Report a vulnerability" button on
  the [Security tab](../../security/advisories/new) of this repository

A good report includes:

1. A clear description of the issue and its impact
2. Reproduction steps (project state, Godot version, model provider, OS)
3. The X-agent version (from `apps/desktop/package.json` or the About dialog)
4. Any known mitigations you've already tried

## Response Targets

- **Initial acknowledgement**: within 7 days of receiving your report
- **Status update / triage decision**: within 14 days
- **Coordinated disclosure**: we will agree on a disclosure timeline with you
  before any public release; default is 90 days after the report is
  acknowledged

## Security Boundaries of This Project

X-agent is a coding Agent with strong on-host capabilities by design. The
following layers are security-relevant and any report touching them is
high-priority:

- **Tool hard-gates** in `shared/mode-tools.ts` and the Ask/Plan/Goal mode
  read-only enforcement
- **CWD sandbox** in `electron/agent/cwd-sandbox.ts`
- **Godot RPC bridge**: only listens on `127.0.0.1`, requires handshake
  token (`electron/agent/godot-rpc-bridge.ts`)
- **Provider URL DNS gate** in `provider-store.ts` (SSRF protection for model
  fetch + baseUrl persistence)
- **Atomic writes** for prefs / usage / provider / auth / godot-rpc
  (`electron/agent/lib/atomic-write.ts`)
- **Shell guard** for `bash` `shellPath` (must be a real GNU bash)

## Out of Scope

- Reports about the upstream Pi SDK (please open them upstream)
- Reports about the upstream Electron / Node.js / React / TypeScript
- Issues caused by running a fork that diverges from `master`
- Issues requiring physical access to the user's machine

## Acknowledgements

We appreciate coordinated disclosure and will credit reporters in the fix
release notes unless they prefer to remain anonymous.
