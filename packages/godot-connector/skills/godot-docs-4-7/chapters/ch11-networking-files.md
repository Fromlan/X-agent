# Chapter 11: Networking, Multiplayer & Files (Resource Imports)

> Source: `Networking` / `Multiplayer` / `Import` / `Files` spines

## Core Idea
Godot's networking layer is split into a **low-level `ENetMultiplayerPeer`
socket** (UDP reliable + unreliable) and a **high-level API** built on
top (`MultiplayerSpawner`, `MultiplayerSynchronizer`, `@rpc` annotations)
that hides envelope serialization for scenes and properties. The same
`FileAccess` API handles both project `res://` files and user `user://`
saves.

## Frameworks Introduced
- **`@rpc(...)`** annotation: declare a function as remotely callable;
  modes include `"any_peer"` (anyone), `"authority"` (server-only),
  `"call_local"` (replicate on caller too), transport `"reliable"` /
  `"unreliable"`.
- **`MultiplayerSpawner`**: server-authoritative spawner that
  replicates scenes (`spawn` function) and despawns (`despawn`).
- **`MultiplayerSynchronizer`**: define a SceneReplicationConfig with
  property paths + replication mode (always / on_change / initial).
- **`ENetMultiplayerPeer` + `WebSocketMultiplayerPeer`**: the two
  transport layers (ENet for desktop, WebSocket for browser multiplayer).
- **`FileAccess.open(path, WRITE)`** writes any local resource path;
  pair with `JSON.stringify` / `JSON.parse_string` for portable saves.

## Key Concepts
- **`MultiplayerSpawner.spawn_function`** — lets you customize the
  instantiation order or pass extra arguments before replication.
- **`SceneReplicationConfig`** is a `.tres` resource that lists each
  replicated property and its mode; assign to a `MultiplayerSynchronizer`.
- **`MultiplayerAPI.get_peers()`** — server-side lookup of connected
  client ids.
- **Import panel** for textures / meshes / audio: configure compression
  presets (lossy / lossless) per asset type. Settings persist in `.import`
  sidecars.
- **`ResourceUID` / `uid://`** — robust path-like handles that survive
  file moves.

## Code Examples
```gdscript
# server: peer start
ENetMultiplayerPeer.new().create_server(7777, 4)
multiplayer.multiplayer_peer = ...
```
```gdscript
# typed @rpc
@rpc("any_peer", "call_local", "reliable")
func chat(msg: String) -> void:
    $UI/Chat.add_line(msg)

func ui_send_pressed() -> void:
    chat.rpc(input.text)  # any peer can call this
```
```gdscript
# save / load user file
const PATH := "user://save.json"

func save(d: Dictionary) -> void:
    var f := FileAccess.open(PATH, FileAccess.WRITE)
    f.store_string(JSON.stringify(d, "\t"))

func load_data() -> Dictionary:
    if not FileAccess.file_exists(PATH):
        return {}
    var raw := FileAccess.get_file_as_string(PATH)
    return JSON.parse_string(raw) as Dictionary
```
```gdscript
# resource UID lookup
var scene: PackedScene = load("uid://b1234...")
# equivalent to load by path, but robust to renames
```
- **What it demonstrates**: server creation, `any_peer` RPC with `call_local`
  (host also sees the chat), typed JSON save/load, `uid://` resolution.

## Reference Tables
| Multiplayer API | Use |
|---|---|
| `@rpc("any_peer", "reliable")` | cross-peer call |
| `@rpc("authority", "unreliable_ordered")` | server→client state push |
| `MultiplayerSpawner` | scene replication |
| `MultiplayerSynchronizer` | property replication |
| `MultiplayerPeer.refuse_new_connections = true` | server capacity gate |
| `WebSocketMultiplayerPeer` | browser multiplayer |
| `MultiplayerAPI.is_server()` | gating logic |

| File / IO API | Use |
|---|---|
| `FileAccess.open("user://...")` | reads + writes |
| `JSON.stringify(d, indent)` | portable text format |
| `FileAccess.get_file_as_string()` | one-shot read |
| `DirAccess.open("user://")` | enumerate |
| `ResourceLoader.load(path, type_hint)` | typed load |
| `ResourceSaver.save(res, path)` | save Resource subclasses |
| `uid://b12345...` | robust handle |

## Anti-patterns
- **Running a server and client in the same scene tree without
  `call_local`** — easy to miss; without it the host doesn't echo its
  own RPCs.
- **Custom binary save format without versioning** — JSON with a
  `"version"` field is cheap insurance.
- **Synchronizing per-pixel textures via RPC** — synchronize the
  *manifest* (index of textures) and load identical assets on each peer.

## Key Takeaways
1. **High-level multiplayer (`Spawner`, `Synchronizer`, `@rpc`) handles
   95% of small multiplayer games.**
2. **Use `user://` for everything per-user** — never write to `res://`.
3. **`uid://` references survive renames**; prefer them for project
   code when available.

## Connects To
- **Ch 12 — Release pipeline**: server builds need headless export
  presets.
- **Ch 3 — GDScript**: `@rpc` annotations only work in scripts.
