# @x-agent/godot-pi

Godot-focused [Pi package](https://pi.dev/docs/latest/packages) for X-agent (skills / prompts / light helpers).

For **live editor control** (reload/run scene, play error capture), use the desktop Godot RPC stack — see [`packages/godot-editor-rpc`](../godot-editor-rpc).

## Install (local)

```bash
pi install D:/UGit/X-agent/packages/godot-pi
```

Or symlink / copy into a Godot project's `.pi/` discovery path.

## Contents

- **Skills**: `godot-project-audit`, `godot-scene-edit`
- **Prompt**: `/godot-next`
- **Extension**: `godot_detect_project` tool + `/godot-rpc-status`

## Pairing

1. Install this Pi package (domain knowledge for the Agent).
2. Install & enable [`godot-editor-rpc`](../godot-editor-rpc) in the Godot project.
3. In X-agent: start the Godot RPC bridge, enable Godot tools under **设置 → 工具**.
