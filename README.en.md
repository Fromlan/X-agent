# X-agent

[中文](README.md) · [English](README.en.md)

A desktop coding agent for **Godot 4**, built on [Pi](https://pi.dev).

Edit scenes and scripts in your project, drive the editor over RPC (reload / run / import), and search official docs offline—in one session. Version: see [`apps/desktop/package.json`](apps/desktop/package.json).

## Positioning

| | |
|---|---|
| What it is | A Godot-focused coding agent (Electron desktop client) |
| What it is not | A general-purpose multi-language IDE; Godot is not “just another plugin” |
| Surface | Project files + Godot editor control plane + official docs search |
| Runtime | Reuses Pi auth/models; sessions isolated from Pi CLI |

## Features

### Godot

- **Editor RPC** — open/reload scenes, run current or main scene, reimport resources, multi-editor routing, play-error capture; default port `8765` (fallback `8765–8774`)
- **Official docs** — offline search after importing doc sources or a zip (enable in Tools)
- **Godot Pi package** — domain skills/prompts (one-click install in Settings → Plugins)
- **Right panel Godot** — bridge status and shortcuts
- **Ready checklist** — guided setup for auth / bash·Git / RPC addon / Godot tools / docs; optional “don’t remind again”

### Agent & sessions

- **Chat** — open a project, resume sessions, steer/abort while streaming; Thinking; `@path` file refs (shown as expandable chips after send)
- **Session modes** — mutually exclusive **Agent | Plan | Goal** in the composer
  - **Agent** — normal coding within the tool allowlist
  - **Plan** — read-only research + `write_plan`; editable plan in the right panel / save to workspace; **Build plan** switches back to Agent to implement; hard `tool_call` gate against writes
  - **Goal** — set a completion condition; independent evaluator auto-continues until met
- **Sessions** — grouped by project; restore/rename/delete; auto titles; hide projects from the sidebar
- **Turn edits** — rewind, edit-resend, regenerate; Shadow Git checkpoints restore the workspace (separate from the user `.git`); without Git, falls back to `write`/`edit` baselines; confirm dialog with risk hints
- **Skill cards** — `read` of a `SKILL.md` shows as a “Skill · name” card
- **Right panel** — context breakdown & compact, **Plan**, tool details, project file tree (Markdown preview), Godot status

### Config & ops

- **Providers** — profiles, model list fetch; import Pi / cc-switch configs; Thinking level clamp/fix for models like DeepSeek
- **Plugins** — prompts, skills, extensions, themes, packages
- **Tool allowlist** — built-in I/O & shell on by default; Godot editor/docs tools off until enabled; **read-only safe profile** turns off bash/write/edit
- **Usage** — local usage summary (Settings → Usage)
- **Auth** — in-app Pi login guidance
- **Theme** — dark default / light; toggle in Settings and the top bar
- **Updates** — packaged builds silently check GitHub Releases; Settings has check / download / install; **Open Releases** fallback in the browser

## Requirements

- Windows (installer currently shipping)
- A Godot **4.x** project (when using the editor control plane)
- Node.js 22+ (for building from source)
- Model auth (any of):
  - **Settings → Providers** — create and enable a profile
  - **Settings → General** → Open Pi login
  - Local [Pi CLI](https://pi.dev) already signed in
- Shell tools: [Git for Windows](https://git-scm.com/download/win) recommended, or set bash path (`shellPath`) in Settings

## Usage

1. Open the app → **Open project** to your Godot project root (resumes the latest session by default)
2. Pick model & Thinking; switch **Agent / Plan / Goal** as needed; send prompts
3. For the Godot control plane:
   - Enable Godot editor / docs tools under **Settings → Tools**
   - **Settings → Godot → Editor**: install/enable the **X-agent RPC** addon and keep the bridge connected
   - (Optional) one-click install the Godot Pi package under **Settings → Plugins**; import doc sources under **Settings → Godot → Official docs**
4. Manage history on the left; context, plan, tools, files, and Godot status on the right
5. Plan flow: switch to Plan → describe the task → agent researches and writes a plan → review/edit in the right panel → **Build plan**

| Settings | Contents |
|---|---|
| General | Theme, default Thinking, bash, Pi login, auto-update |
| Providers | Provider profiles and import |
| Usage | Local usage summary |
| Tools | Tool allowlist, group toggles, read-only safe profile |
| Plugins | Prompts / skills / extensions / themes / Packages |
| Godot | **Editor connection** · **Official docs** |

## Data locations

Under `~/.pi/agent/`:

| Path | Purpose |
|---|---|
| `x-agent.json` | Client preferences |
| `x-agent/sessions/` | App sessions (isolated from Pi CLI) |
| `x-agent/checkpoints/` | Shadow Git workspace checkpoints (per project) |
| `x-agent/plans/` | Plan Mode plans (optional save to `<cwd>/.pi/plans/`) |
| `x-agent-providers.json` | Provider profiles |
| `x-agent-godot-rpc.json` | Godot RPC endpoint |
| `x-agent-packages.json` | Installed Packages record |
| `x-agent-usage.json` | Usage stats |
| `x-agent/godot-docs/` | Godot docs cache |
| `auth.json` / `models.json` | Shared Pi auth & models |

## Related packages

| Package | Description |
|---|---|
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot editor RPC addon |
| [`packages/godot-pi`](packages/godot-pi) | Godot domain skills & prompts |

## Updates & trust

- **Auto-update**: packaged builds silently check **GitHub Releases** after launch; Settings → General also has check / download / install. Use **Open Releases** if auto-update fails (or the contact channels below).
- **Code signing**: Provide `CSC_LINK` + `CSC_KEY_PASSWORD` in the build env so electron-builder signs Windows installers (helps with SmartScreen). Builds still succeed without a certificate (unsigned).

## Security & privacy

This is a coding agent with substantial local power—tighten as needed:

| Area | Notes |
|---|---|
| API keys | Stored in plaintext under `~/.pi/agent/x-agent-providers.json` (and Pi `auth.json` when activated) |
| Tools | Default allowlist includes `bash` / `write` / `edit`; Settings → Tools has a **read-only safe profile**; Plan mode adds a hard read-only gate |
| Sandbox | Files tab is cwd-sandboxed; Pi `bash` can still reach broader paths via the shell |
| Godot RPC | Listens on `127.0.0.1` only; no shared-secret handshake yet |
| Packages | `pi install` accepts arbitrary sources—treat as supply-chain sensitive |
| Sessions | Isolated under `~/.pi/agent/x-agent/sessions/` |

## UI language

The desktop UI is currently **Chinese-only**. This English README documents the product; an in-app locale switch is not shipped yet. macOS/Linux installers are not shipped yet (Windows-first).

See [`CHANGELOG.md`](CHANGELOG.md) for release notes, [`CLAUDE.md`](CLAUDE.md) for development guidance, and [`docs/research-plan-goal-modes.md`](docs/research-plan-goal-modes.md) for Plan / Goal design notes.

## Contact & feedback

| Channel | Details |
|---|---|
| Email | [fromlan@qq.com](mailto:fromlan@qq.com) |
| QQ group | `1074500101` |
