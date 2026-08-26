# X-agent

[中文](README.md) · [English](README.en.md)

[![Version](https://img.shields.io/badge/version-0.5.5-blue)](apps/desktop/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-blueviolet)](#requirements)
[![Godot: 4.x](https://img.shields.io/badge/Godot-4.x-478cbf)](#requirements)

**A desktop coding agent for Godot 4**—edit scenes, modify scripts, run the scene, roll back: **all in one session**.

Not a chat UI shell. Not a VS Code replacement. A **long-horizon coding agent**: Shadow Git rollback, hard mode gates, Thinking levels, branded client.

![X-agent main window](docs/screenshots/main-window.png)

> The desktop UI is currently **Chinese-only**. This English README documents the product; an in-app locale switch is not shipped yet.

## Table of contents

- [30-second start](#30-second-start)
- [What do you want to do with X-agent?](#what-do-you-want-to-do-with-x-agent)
- [Key capabilities](#key-capabilities)
- [Should I use X-agent?](#should-i-use-x-agent)
- [Three concepts you must know](#three-concepts-you-must-know)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Settings](#settings)
- [Data locations](#data-locations)
- [Updates & installation](#updates--installation)
- [Security & privacy](#security--privacy)
- [FAQ](#faq)
- [Feedback & contributing](#feedback--contributing)
- [Credits](#credits)
- [Contact](#contact)

## 30-second start

1. **Download**: install the Windows package from [Releases](https://github.com/Fromlan/X-agent/releases/latest)
2. **Open project**: pick your Godot project root (auto-resumes the latest session)
3. **Authenticate**: Settings → General → "Open Pi login" (or `pi login` already signed in locally)
4. **(Optional) Godot editor bridge**: Settings → Godot → Editor connection → install the **X-agent RPC** addon
5. Type a prompt, press Enter

**Going deeper**: four role-based scenarios below.

## What do you want to do with X-agent?

### 🎮 Godot developer · edit code + run scene
Open project → Agent mode → pick model → ask "add a dash to `Player.gd` and run the current scene" → Agent edits the file, editor RPC reloads, runs the scene, error messages stream back—**all in the same session**.

### ✍️ Solo game designer · write design docs (keep `game/` clean)
Pick **design session type** when creating a session → writes are hard-confined to `<cwd>/game-design/` → 5 preinstalled design skills help with project initiation / numbers / core loop → UI flips to a warm theme to distinguish from code sessions.

### 🔬 Read-only research · ask API, look up docs
Switch to **Ask mode** → tool allowlist hard-closes `write` / `edit` → `bash` only allows read-only commands and paths must stay inside the project cwd → perfect for "find out how GDScript singletons work before I touch the code".

### 🎯 Goal-driven · let the agent run until the goal is met
Switch to **Goal mode** → set a completion condition (e.g. "add combo counter to `ScoreManager.gd` + show on HUD") → evaluator auto-continues while the goal is unmet (turn + token double budget).

## Key capabilities

| | |
|---|---|
| **🎯 Design sessions** | Writes hard-confined to `<cwd>/game-design/`, warm theme UI. 5 preinstalled skills: `design-initiation` / `design-process` / `design-systems` / `design-numerical` / `design-core-loop` |
| **🎮 Godot integration** | Editor RPC (port 8765, fallback 8765–8774); 17 tools spanning scene introspection / debugger / resource hygiene / export / config R/W / read-only introspection |
| **📜 godot-docs-4-7** | Engine-conventions skill (auto-discovered by Pi); load SKILL.md on demand via `read`—**0 tokens wasted on methodology you don't need** |
| **↩️ Shadow Git rollback** | Per-turn checkpoints isolated from your `.git`; restores by diff path (won't clobber edits you made during the turn) |
| **🔀 4 modes + 2 types** | Mutually exclusive modes: Agent / Ask / Plan / Goal; `code` / `design` session types (orthogonal to mode) |
| **⚡ Diff display** | Inspect `+/-`-colored diffs before retracting (with file count and `+N` / `-N` stats) |
| **🎨 8 built-in logos + custom upload** | Settings → General → Brand: Neon Cyber / Lava Burn / Plasma Thunder / Holographic Rainbow / Rose Gold Metallic / Pixel 8-bit / Glitch / Cosmic Nebula |
| **🧠 Thinking levels + thinking-orbs** | Auto-clamp Thinking for models like DeepSeek; particle-orbit animation while running, not a spinner |
| **🎨 v1.1 design language** | Elevation-driven hierarchy: the Composer is the single main element; chrome (TopBar / Sidebar / RightPanel) steps back; 10 theme families (default / nord / tokyo / paper / contrast × dark/light) |

## Should I use X-agent?

| Your situation | Recommendation |
|---|---|
| Building a Godot 4 project, **Windows** | ✅ Install it |
| Building a Godot 4 project, **macOS / Linux** | ⏸ Wait for macOS / Linux installers ([ROADMAP 3.4](docs/roadmap.md)) |
| Using Unity / Unreal / general coding | ❌ Not a fit (Godot-specialized) |
| Just want to try LLM chat | ❌ Use [Pi CLI](https://pi.dev) directly—lighter |
| Need cloud / real-time collaboration | ❌ Local desktop, single-maintainer project |

## Three concepts you must know

- **Session mode** (mutually exclusive): Agent / Ask / Plan / Goal—decides **which tools are available**
- **Session type** (orthogonal): `code` (default) / `design`—decides the **scope of writes**
- **Rollback source**: Shadow Git checkpoints (isolated from your `.git`); restores by diff path

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Shift+Tab` | Cycle through modes |
| `F12` / `Ctrl+Shift+I` | DevTools (requires `--x-agent-debug` / `X_AGENT_DEBUG=1`) |
| `Esc` | Close the current modal |
| `Ctrl+,` | Open Settings |
| `Ctrl+Enter` | Send message (when input is multiline) |

## Settings

| Section | Contents |
|---|---|
| General | Theme, default Thinking, bash path, Pi login, auto-update, **Brand (logo selector)** |
| Providers | Model profiles, import Pi / cc-switch configs, Thinking clamp |
| Usage | Local per-day / per-model usage summary |
| Tools | Built-in / Godot editor / Godot docs tool allowlist; active in Agent / Goal modes |
| Plugins | Prompts / Skills / Extensions / Themes / Packages (Pi's five kinds) |
| Godot | **Editor connection** (RPC bridge + addon install / update) |

Full config reference: [`docs/agent.md` §四](docs/agent.md) / [`docs/context.md`](docs/context.md)

## Data locations

App data lives under `~/.pi/agent/`; **shared** with Pi CLI: `auth.json` / `models.json`; everything else is **isolated**:

| Path | Purpose |
|---|---|
| `x-agent.json` | Client preferences (theme / default Thinking / sidebar width / etc.) |
| `x-agent/sessions/` | App sessions (separate from Pi CLI's) |
| `x-agent/checkpoints/` | Shadow Git checkpoints (per project, **does not touch your `.git`**) |
| `x-agent/plans/` / `x-agent/goals/` | Plan files / Goal journals |
| `x-agent-logos/` | Custom brand logos (UUID filenames, **do not edit outside the app**) |
| `x-agent-{providers,packages,usage,godot-rpc}.json` | Profiles / install records / usage / RPC endpoint |

Full list: [`CLAUDE.md` §持久化与隔离](CLAUDE.md)

## Updates & installation

- **Auto-update**: packaged builds silently check [GitHub Releases](https://github.com/Fromlan/X-agent/releases) on launch (no auto-download). When a new version is found, an in-app prompt offers **Update now** / **Later**.
- **Code signing**: optional `CSC_LINK` + `CSC_KEY_PASSWORD` to sign Windows installers (helps with SmartScreen). Builds still succeed without a certificate (unsigned).

## Security & privacy

A coding agent comes with substantial local power—tighten as needed.

### API keys
- `x-agent-providers.json` is encrypted at rest with Electron `safeStorage` when available; on activation the key is also written in plaintext to Pi's `auth.json` (shared with Pi CLI)
- On decryption failure (machine migration / keyring reset) the **on-disk ciphertext (`encryptedKey`) is preserved**—subsequent saves won't overwrite it with an empty string and lose the key
- ⚠️ Don't sync `~/.pi/agent/` to untrusted locations

### Tools
- Defaults: `bash` / `write` / `edit` are on (active in **Agent / Goal modes**)
- **Ask / Plan modes** hard-close `write` / `edit`; `bash` only allows read-only commands and paths must stay inside the project cwd
- `read` / `grep` / `find` / `ls` path parameters are forced inside the project cwd
- Godot tool toggles are validated at the IPC layer (a compromised UI cannot bypass a tool that's off by default)

### Network / processes
- Godot RPC only listens on `127.0.0.1`; endpoints carry a shared token validated on `editor_ready` (handshake failure → update and restart the X-agent RPC addon)
- Provider baseUrl rejects private networks / `*.nip.io` / `localtest.me` (SSRF guard)
- `pi install` skips npm lifecycle scripts

## FAQ

**Q: Does it work offline?**
A: Model calls need API (online); local usage / checkpoints / sessions / rollback are fully offline. The Godot docs skill `godot-docs-4-7` is auto-indexed inside Godot projects.

**Q: Why not just VS Code + Copilot?**
A: 1) Godot editor RPC integration (scene introspection / debugger / resource hygiene) is out of reach for VS Code plugins. 2) Shadow Git rollback is isolated from your `.git` (VS Code doesn't restore by diff path). 3) 4 modes + 2 types are enforced at the IPC layer, not just suggested.

**Q: Can I use it for non-Godot projects?**
A: Technically yes (the IDE is Electron + Pi SDK, generic), but with all Godot tools off it degrades to a plain agent—**no differentiation value**.

**Q: Does my data sync to the cloud?**
A: No. Everything is local (see [Data locations](#data-locations)). Only model calls go through your configured provider.

**Q: Will upgrades wipe my data?**
A: No. Upgrades preserve everything under `~/.pi/agent/`. To roll back, install an older installer over the current one.

## Feedback & contributing

- **Bug / feature requests**: [Issues](../../issues) (three templates: Bug / Feature / Question)
- **Security**: [`SECURITY.md`](SECURITY.md) — **do not** post reproduction details in a public issue
- **Contributing**: [`CONTRIBUTING.md`](CONTRIBUTING.md) / [PR template](.github/PULL_REQUEST_TEMPLATE.md)
- **Code of conduct**: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- **License**: [`LICENSE`](LICENSE) (MIT)
- **Maintenance cadence**: [`docs/maintenance.md`](docs/maintenance.md)
- **Roadmap**: [`docs/roadmap.md`](docs/roadmap.md) (22 milestones / 4 phases)

Release notes: [`CHANGELOG.md`](CHANGELOG.md). Development guide: [`CLAUDE.md`](CLAUDE.md).

## Credits

- Built on [Pi SDK](https://pi.dev)
- Status animations: [thinking-orbs](https://github.com/JakubAntalik/thinking-orbs) (MIT © Jakub Antalik)
- Built-in logo presets: 8 in-house sets (Neon Cyber / Lava Burn / Plasma Thunder / Holographic Rainbow / Rose Gold Metallic / Pixel 8-bit / Glitch / Cosmic Nebula)

## Contact

| Channel | Details |
|---|---|
| Email | [fromlan@qq.com](mailto:fromlan@qq.com) |
| QQ group | `1074500101` |
