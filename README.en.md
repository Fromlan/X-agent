# X-agent

[中文](README.md) · [English](README.en.md)

A desktop coding agent for **Godot 4**, built on [Pi](https://pi.dev).

Edit scenes and scripts in your project, drive the editor over RPC (reload / run / import), and search official docs offline—in one session.

## Positioning

| | |
|---|---|
| What it is | A Godot-focused coding agent (Electron desktop client) |
| What it is not | A general-purpose multi-language IDE; Godot is not “just another plugin” |
| Surface | Project files + Godot editor control plane + official docs search |
| Runtime | Reuses Pi auth/models; sessions isolated from Pi CLI |

## Features

### Godot

- **Editor RPC** — open/reload scenes, run current or main scene, reimport resources, multi-editor routing, play-error capture
- **Official docs** — offline search after importing doc sources (enable in Tools)
- **Godot Pi package** — domain skills/prompts (one-click install in Settings → Plugins)
- **Right panel Godot** — bridge status and shortcuts

### Agent & sessions

- **Chat** — open a Godot project, resume sessions, steer/abort while streaming; Thinking; `@path` file refs
- **Sessions** — grouped by project; restore/rename/delete; auto titles; hide projects from the sidebar
- **Turn edits** — rewind, edit-resend, regenerate; file `write`/`edit` reverts by default
- **Right panel** — context usage & compact, tool details, project file tree

### Config & ops

- **Providers** — profiles, model list fetch; import Pi / cc-switch configs
- **Plugins** — prompts, skills, extensions, themes, packages
- **Tool allowlist** — built-in I/O & shell on by default; Godot editor/docs tools off until enabled
- **Usage / auth / updates** — local usage; in-app Pi login; packaged auto-update from GitHub Releases

## Requirements

- Windows (installer currently shipping)
- A Godot **4.x** project (when using the editor control plane)
- Model auth (any of):
  - **Settings → Providers** — create and enable a profile
  - **Settings → General** → Open Pi login
  - Local [Pi CLI](https://pi.dev) already signed in
- Shell tools: [Git for Windows](https://git-scm.com/download/win) recommended, or set bash path in Settings

## Usage

1. Open the app → **Open project** to your Godot project root (resumes the latest session by default)
2. Pick model & Thinking in the top bar, then send prompts
3. For the Godot control plane:
   - Enable Godot editor / docs tools under **Settings → Tools**
   - **Settings → Godot → Editor**: install/enable the **X-agent RPC** addon and keep the bridge connected
   - (Optional) one-click install the Godot Pi package under **Settings → Plugins**; import doc sources under **Settings → Godot → Official docs**
4. Manage history on the left; context, tools, files, and Godot status on the right

| Settings | Contents |
|---|---|
| General | Theme, default Thinking, bash, Pi login, auto-update |
| Providers | Provider profiles and import |
| Usage | Local usage summary |
| Tools | Tool allowlist and group toggles |
| Plugins | Prompts / skills / extensions / themes / Packages |
| Godot | **Editor connection** · **Official docs** |

## Data locations

Under `~/.pi/agent/`:

| Path | Purpose |
|---|---|
| `x-agent.json` | Client preferences |
| `x-agent/sessions/` | App sessions (isolated from Pi CLI) |
| `x-agent-providers.json` | Provider profiles |
| `x-agent-godot-rpc.json` | Godot RPC endpoint |
| `x-agent-usage.json` | Usage stats |
| `x-agent/godot-docs/` | Godot docs cache |
| `auth.json` / `models.json` | Shared Pi auth & models |

## Related packages

| Package | Description |
|---|---|
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot editor RPC addon |
| [`packages/godot-pi`](packages/godot-pi) | Godot domain skills & prompts |

## Updates & trust

- **Auto-update**: packaged builds silently check **GitHub Releases** after launch; Settings → General also has check / download / install. Use **Open Releases** if auto-update fails (or the QQ group link for alternate downloads).
- **Code signing**: Provide `CSC_LINK` + `CSC_KEY_PASSWORD` in the build env so electron-builder signs Windows installers (helps with SmartScreen). Builds still succeed without a certificate (unsigned).

## Security & privacy

This is a coding agent with substantial local power—tighten as needed:

| Area | Notes |
|---|---|
| API keys | Stored in plaintext under `~/.pi/agent/x-agent-providers.json` (and Pi `auth.json` when activated) |
| Tools | Default allowlist includes `bash` / `write` / `edit`; Settings → Tools has a **read-only safe profile** |
| Sandbox | Files tab is cwd-sandboxed; Pi `bash` can still reach broader paths via the shell |
| Godot RPC | Listens on `127.0.0.1` only; no shared-secret handshake yet |
| Packages | `pi install` accepts arbitrary sources—treat as supply-chain sensitive |
| Sessions | Isolated under `~/.pi/agent/x-agent/sessions/` |

## UI language

The desktop UI is currently **Chinese-only**. This English README documents the product; an in-app locale switch is not shipped yet. macOS/Linux installers are not shipped yet (Windows-first).

See [`CHANGELOG.md`](CHANGELOG.md) for release notes and [`CLAUDE.md`](CLAUDE.md) for development guidance.
