<h1 align="center">X-agent</h1>

<p align="center">A desktop AI development assistant for Godot 4</p>

<p align="center">
  <a href="https://github.com/Fromlan/X-agent/releases/latest"><img src="https://img.shields.io/github/v/release/Fromlan/X-agent?label=latest" alt="Latest release"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blueviolet" alt="Windows 10/11"/>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Fromlan/X-agent" alt="MIT License"/></a>
</p>

<p align="center">
  <a href="https://github.com/Fromlan/X-agent/releases/latest">Download</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="https://github.com/Fromlan/X-agent/issues">Issues</a> ·
  <a href="README.md">简体中文</a>
</p>

X-agent lets you edit scripts and scenes, call the Godot editor, and inspect runtime errors in the same conversation. You can research a change and prepare a plan before implementing it, or open a design session to work on gameplay, systems, and balancing documents.

Built on [Pi SDK](https://pi.dev), it uses the models and credentials you configure. The project is in beta. Installers are currently available for Windows, and the interface is in Chinese.

<p align="center">
  <img src="docs/screenshots/main-window.png" alt="X-agent workbench with projects and sessions, conversation and tool activity, and an execution plan" width="1000"/>
</p>

## Getting started

Download `X-agent-Setup-<version>-<arch>.exe` from [GitHub Releases](https://github.com/Fromlan/X-agent/releases/latest) and follow the installer. Packaged builds check for updates on launch; downloading and installing require your confirmation.

Have Godot 4 and [Git for Windows](https://gitforwindows.org/) installed. Git supplies Bash for command execution and supports workspace checkpoints. Pi login and package installation also need Node.js 24+ and Pi CLI; the in-app readiness checklist provides setup actions.

1. **Open a project**: select the root folder containing `project.godot`.
2. **Configure a model**: add and enable a profile in Settings → Providers, or open Pi login from Settings → General to reuse local credentials.
3. **Bash is configured automatically**: on startup, the app discovers and configures installed Git Bash while preserving valid custom paths. It only prompts when Bash is missing or configuration fails.
4. **Start a conversation**: select a model and working mode in the input area, then describe the task.

### Connect the Godot editor

Once connected, the agent can inspect the current scene, run the project, and retrieve errors.

1. Open a Godot project. X-agent automatically attaches to its editor, or discovers an engine, installs and enables the addon, and opens the project.
2. If the engine is missing or several suitable versions are found, choose one in Settings → Godot. The choice is remembered per project.
3. If Godot was already open without the addon loaded, enable **X-agent RPC** or save and reopen the project as prompted. Wait for the connected status; automatic connection can be disabled or retried in Settings.
4. Enable the **Godot editor tools** you need in Settings → Tools. They are off by default.

See the [Godot addon documentation](packages/godot-editor-rpc/README.md) for available tools and connection troubleshooting.

## Features

### Work with Godot from a conversation

The app provides **27 Godot tools** covering scene and node inspection, opening and reloading scenes, running scenes and collecting errors, checking scripts, importing resources, and exporting projects. If several editors are connected, select the active editor in Settings.

The native skill package includes the `godot-docs-4-7` knowledge base, loaded on demand in Godot projects. See [godot-pi](packages/godot-pi/README.md) for package contents and installation.

### Research, plan, and implement

Code sessions offer four working modes. Select one in the input area or cycle through them with `Shift+Tab`.

| Mode | Behavior |
|---|---|
| Agent | Read and edit project files, call enabled tools, and carry out development tasks. |
| Ask | Inspect the project, research, and answer questions without file writes. Terminal commands are restricted to read-only operations within the project. |
| Plan | Research without changing project files and produce a plan. Review, edit, or save it in the right panel; executing it switches to Agent mode. |
| Goal | Work toward completion criteria, with a separate evaluator deciding whether to continue, subject to turn and token budgets. |

Goal budgets control continuation and include evaluator usage. A single request can exceed the budget. Use tests and actual runtime results to verify completion.

### Review changes and roll back

Review file diffs after each turn, retract a turn, edit and resend a message, or regenerate a response. The retraction dialog previews what will be restored.

With Git available, checkpoints use a separate Shadow Git repository without changing your project's Git history. Without Git, the app falls back to file baselines for the `write` and `edit` tools. Retraction restores affected paths and preserves files the agent did not touch. Manual edits within the same file may still be affected, so inspect the diff before retracting.

### Write game design documents

Select the design session type in the sidebar before creating a session. The agent can use project code as reference, with writes confined to the project's `game-design/` directory. Built-in skills cover project initiation, design process, systems, balancing, and the core loop. Switching working modes does not remove the directory restriction.

### Include files, images, and web sources

Use `@` to reference project files and `/` to select skills, prompts, or commands. Paste or drag in images and files; image input requires a model that supports it.

Web search and page fetching use DeepSeek's official API and can be called by different chat models. Add and enable an official DeepSeek provider profile, then select it under Settings → Tools → DeepSeek Web and enable search or fetching. Both are off by default. Queries and target URLs are sent to DeepSeek. Requests are billed separately and are not currently included in the app's model token cost totals.

### Choose models and extensions

Import provider profiles from local Pi or cc-switch configuration, switch models, adjust thinking levels, and inspect usage by day or model. Manage Pi skills, prompts, extensions, themes, and packages in Settings.

The right panel includes context usage and compaction, plans, tools, and a file browser. Graphite, Mist, Dusk, Sand, Sage, and High Contrast themes support light and dark modes.

## Security and privacy

Sessions, preferences, usage, and checkpoints are stored locally under `%USERPROFILE%\.pi\agent\`. The app shares `auth.json`, `models.json`, and `settings.json` with Pi CLI. X-agent sessions and checkpoints live in `x-agent/sessions/` and `x-agent/checkpoints/`.

Model requests send conversation content and relevant project context to your chosen provider. Provider profiles use OS-backed encryption for API keys when available; enabling a profile also writes its key to Pi's `auth.json` in plaintext.

Agent and Goal modes can write files and execute commands. Built-in file tools are confined to the project directory, but Bash may access other local paths. These restrictions are not an operating-system sandbox. The Godot bridge listens only on `127.0.0.1` and authenticates connections with a token.

See the [developer reference](docs/agent.md) and [context documentation](docs/agent-context.md) for details. For security reports, follow [SECURITY.md](SECURITY.md).

## Development

Development and CI currently target Windows. Install Node.js 24+ and Git for Windows. Dependencies and the lockfile live in `apps/desktop`. In PowerShell:

```powershell
git clone https://github.com/Fromlan/X-agent.git
cd X-agent/apps/desktop
npm ci
npm run dev
```

Run checks from `apps/desktop`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:e2e
```

For real Godot integration tests, set `$env:GODOT_BIN` to the absolute path of a Godot 4.6.2 console executable, then run `npm run test:godot`. For documentation changes, also run `npm run doc:drift` and `npm run test:doc-drift` from the repository root.

`apps/desktop` contains the Electron client, `packages/godot-editor-rpc` the Godot addon, and `packages/godot-pi` the native skill package. Read [CLAUDE.md](CLAUDE.md) for architecture and engineering conventions, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Feedback and contributions

Report bugs or suggest features in [Issues](https://github.com/Fromlan/X-agent/issues). Include the app version, Godot version, model, and reproduction steps. Settings → General → Diagnostics and feedback lets you preview or export local diagnostics and copy a feedback summary. Diagnostics exclude conversations, source code, paths, and credentials, and are not uploaded automatically.

PRs are welcome. Discuss larger changes in an issue first, and read the [contributing guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md). See the [changelog](CHANGELOG.md) for version history and the [roadmap](docs/roadmap.md) for future plans.

Contact: [fromlan@qq.com](mailto:fromlan@qq.com) · QQ group: `1074500101`

## Credits and license

X-agent is built on [Pi SDK](https://pi.dev), uses [thinking-orbs](https://github.com/JakubAntalik/thinking-orbs) for status animations, and draws its Godot knowledge base from the [official Godot documentation](https://docs.godotengine.org/).

Licensed under the [MIT License](LICENSE).
