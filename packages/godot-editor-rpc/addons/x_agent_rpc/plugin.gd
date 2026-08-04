@tool
extends EditorPlugin

## X-agent Godot Editor RPC client.
## Connects to the desktop TCP JSON-lines bridge
## (endpoint: ~/.pi/agent/x-agent-godot-rpc.json, fallback 127.0.0.1:8765).

const ADDON_VERSION := "0.3.0"
const DEFAULT_HOST := "127.0.0.1"
const DEFAULT_PORT := 8765
const CONNECT_TIMEOUT_SEC := 1.2
const FALLBACK_PORT_START := 8765
const FALLBACK_PORT_END_INCLUSIVE := 8774
const DEFAULT_RUN_WAIT_MS := 3000
const MAX_RUN_WAIT_MS := 15000
const MAX_PLAY_ERRORS := 50
## 每秒检查一次 endpoint 文件 mtime；变更或消失时立即重解析并重连。
## Godot 4 无 inotify 绑定，1s 轮询是跨平台最稳的方案。
const ENDPOINT_POLL_SEC := 1.0
## 断开后再次尝试连入的间隔。
const RECONNECT_DELAY_SEC := 1.0

# --- TCP connection ---
var _peer: StreamPeerTCP = StreamPeerTCP.new()
var _connected: bool = false
var _buffer: String = ""
var _reconnect_in: float = 0.0
var _host: String = DEFAULT_HOST
var _primary_port: int = DEFAULT_PORT
var _auth_token: String = ""
var _ports_to_try: Array[int] = []
var _port_try_index: int = 0
var _connect_started_ms: int = 0

# --- Endpoint mtime polling ---
var _endpoint_mtime: int = 0
var _endpoint_check_in: float = 0.0

# --- Play error capture ---
var _debugger: EditorDebuggerPlugin
var _play_errors: Array = [] # [{ severity, message, time_ms }, ...]
var _pending_run: Dictionary = {} # { id, wait_ms, start_ms, was_playing }

# =============================================================================
# Lifecycle
# =============================================================================

func _enter_tree() -> void:
	set_process(true)
	scene_changed.connect(_on_scene_changed)
	_setup_debugger()
	_resolve_endpoint()
	_build_ports_to_try()
	_endpoint_mtime = _read_endpoint_mtime()
	_try_connect()

func _exit_tree() -> void:
	set_process(false)
	if scene_changed.is_connected(_on_scene_changed):
		scene_changed.disconnect(_on_scene_changed)
	_teardown_debugger()
	if _peer.get_status() != StreamPeerTCP.STATUS_NONE:
		_peer.disconnect_from_host()

func _process(_delta: float) -> void:
	_tick_pending_run()
	_maybe_poll_endpoint(_delta)
	# Do not poll STATUS_NONE — Godot errors with "_sock.is_null() || !_sock->is_open()".
	var status := _peer.get_status()
	if status == StreamPeerTCP.STATUS_CONNECTING or status == StreamPeerTCP.STATUS_CONNECTED:
		_peer.poll()
		status = _peer.get_status()

	if status == StreamPeerTCP.STATUS_CONNECTED:
		if not _connected:
			_connected = true
			print("X-agent RPC: connected to %s:%s" % [_host, _current_port()])
			_send({
				"type": "editor_ready",
				"godotVersion": str(Engine.get_version_info().get("string", "unknown")),
				"projectPath": ProjectSettings.globalize_path("res://"),
				"token": _auth_token,
				"addonVersion": ADDON_VERSION,
			})
		_poll_messages()
		return

	if status == StreamPeerTCP.STATUS_CONNECTING:
		var elapsed_sec := (Time.get_ticks_msec() - _connect_started_ms) / 1000.0
		if elapsed_sec >= CONNECT_TIMEOUT_SEC:
			_connected = false
			_buffer = ""
			_advance_port()
		return

	if status == StreamPeerTCP.STATUS_ERROR or status == StreamPeerTCP.STATUS_NONE:
		if _connected:
			_connected = false
			_buffer = ""
			print("X-agent RPC: disconnected")
		_reconnect_in -= _delta
		if _reconnect_in <= 0.0:
			_reconnect_in = RECONNECT_DELAY_SEC
			_resolve_endpoint()
			_build_ports_to_try()
			_port_try_index = 0
			_try_connect()
		return

# =============================================================================
# Debugger / play errors
# =============================================================================

func _setup_debugger() -> void:
	var script: GDScript = load(get_script().resource_path.get_base_dir().path_join("rpc_debugger.gd")) as GDScript
	if script == null or not script.can_instantiate():
		push_warning("X-agent RPC: failed to load rpc_debugger.gd")
		return
	_debugger = script.new() as EditorDebuggerPlugin
	if _debugger == null:
		push_warning("X-agent RPC: failed to instantiate rpc_debugger.gd")
		return
	if _debugger.has_method("configure"):
		_debugger.configure(Callable(self, "append_play_error"))
	add_debugger_plugin(_debugger)

func _teardown_debugger() -> void:
	if _debugger != null:
		remove_debugger_plugin(_debugger)
		_debugger = null

func append_play_error(severity: String, message: String) -> void:
	var msg := str(message).strip_edges()
	if msg == "":
		return
	var entry := {
		"severity": severity if severity in ["error", "warning"] else "error",
		"message": msg,
		"time_ms": Time.get_ticks_msec(),
	}
	if _play_errors.size() > 0:
		var last: Dictionary = _play_errors[_play_errors.size() - 1]
		if str(last.get("message", "")) == msg and str(last.get("severity", "")) == entry.severity:
			return
	_play_errors.append(entry)
	while _play_errors.size() > MAX_PLAY_ERRORS:
		_play_errors.pop_front()
	_send({
		"type": "play_error",
		"severity": entry.severity,
		"message": entry.message,
	})

func clear_play_errors() -> void:
	_play_errors.clear()

func get_play_errors_snapshot() -> Array:
	return _play_errors.duplicate(true)

func _clamp_wait_ms(raw) -> int:
	var n := DEFAULT_RUN_WAIT_MS
	if typeof(raw) == TYPE_FLOAT or typeof(raw) == TYPE_INT:
		n = int(raw)
	return clampi(n, 0, MAX_RUN_WAIT_MS)

func _start_run_collect(id: String, wait_ms: int, play_method: String = "play_current_scene") -> void:
	clear_play_errors()
	var method := play_method if play_method in ["play_current_scene", "play_main_scene"] else "play_current_scene"
	EditorInterface.call_deferred(method)
	_pending_run = {
		"id": id,
		"wait_ms": wait_ms,
		"start_ms": Time.get_ticks_msec() + 50, # allow deferred play to start
		"was_playing": false,
		"play_method": method,
	}

func _tick_pending_run() -> void:
	if _pending_run.is_empty():
		return
	var wait_ms: int = int(_pending_run.get("wait_ms", DEFAULT_RUN_WAIT_MS))
	var start_ms: int = int(_pending_run.get("start_ms", Time.get_ticks_msec()))
	var elapsed: int = Time.get_ticks_msec() - start_ms
	var playing := EditorInterface.is_playing_scene()
	if playing:
		_pending_run["was_playing"] = true

	var errors: Array = get_play_errors_snapshot()
	var has_error := false
	for e in errors:
		if typeof(e) == TYPE_DICTIONARY and str(e.get("severity", "")) == "error":
			has_error = true
			break

	var was_playing: bool = bool(_pending_run.get("was_playing", false))
	var done := false
	if elapsed >= wait_ms:
		done = true
	elif (not playing) and elapsed > 200 and has_error:
		done = true
	elif (not playing) and was_playing and elapsed > 400:
		done = true

	if not done:
		return

	var play_method := str(_pending_run.get("play_method", "play_current_scene"))
	var id := str(_pending_run.get("id", ""))
	_pending_run = {}
	_send({
		"id": id,
		"ok": true,
		"result": {
			"started": true,
			"playing": playing,
			"waitMs": wait_ms,
			"playMethod": play_method,
			"errors": errors,
		},
	})

# =============================================================================
# Endpoint / TCP
# =============================================================================

func _endpoint_config_path() -> String:
	var home := OS.get_environment("USERPROFILE")
	if home == "":
		home = OS.get_environment("HOME")
	if home == "":
		return ""
	return home.path_join(".pi").path_join("agent").path_join("x-agent-godot-rpc.json")

## FileAccess.get_modified_time 在文件不存在/不可读时返回 0。
func _read_endpoint_mtime() -> int:
	var path := _endpoint_config_path()
	if path == "" or not FileAccess.file_exists(path):
		return 0
	return int(FileAccess.get_modified_time(path))

## 每秒检查一次 endpoint 文件 mtime；变更或消失时立即重解析并重连。
func _maybe_poll_endpoint(delta: float) -> void:
	_endpoint_check_in -= delta
	if _endpoint_check_in > 0.0:
		return
	_endpoint_check_in = ENDPOINT_POLL_SEC
	var path := _endpoint_config_path()
	if path == "":
		return
	var mtime := int(FileAccess.get_modified_time(path))
	if mtime == 0:
		# endpoint 文件被删除或不可读 → 立即重读并回退默认端口。
		if _endpoint_mtime != 0:
			_endpoint_mtime = 0
			_resolve_endpoint()
			_build_ports_to_try()
			_port_try_index = 0
			_try_connect()
		return
	if mtime != _endpoint_mtime:
		# endpoint 文件被更新 → X-agent 重启或 token 换新。
		_endpoint_mtime = mtime
		_resolve_endpoint()
		_build_ports_to_try()
		_port_try_index = 0
		_try_connect()

func _resolve_endpoint() -> void:
	_host = DEFAULT_HOST
	_primary_port = DEFAULT_PORT
	_auth_token = ""
	var path := _endpoint_config_path()
	if path == "" or not FileAccess.file_exists(path):
		return
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var data = JSON.parse_string(file.get_as_text())
	if typeof(data) != TYPE_DICTIONARY:
		return
	_host = str(data.get("host", DEFAULT_HOST))
	_primary_port = int(data.get("port", DEFAULT_PORT))
	_auth_token = str(data.get("token", ""))

func _build_ports_to_try() -> void:
	_ports_to_try.clear()
	_ports_to_try.append(_primary_port)
	for p in range(FALLBACK_PORT_START, FALLBACK_PORT_END_INCLUSIVE + 1):
		if p != _primary_port:
			_ports_to_try.append(p)
	_port_try_index = 0

func _current_port() -> int:
	if _ports_to_try.size() == 0:
		return _primary_port
	return _ports_to_try[min(_port_try_index, _ports_to_try.size() - 1)]

func _advance_port() -> void:
	if _peer.get_status() != StreamPeerTCP.STATUS_NONE:
		_peer.disconnect_from_host()
	_peer = StreamPeerTCP.new()
	_port_try_index += 1
	if _port_try_index >= _ports_to_try.size():
		_port_try_index = 0
		_resolve_endpoint()
		_build_ports_to_try()
	_try_connect()

func _try_connect() -> void:
	var cur := _peer.get_status()
	if cur == StreamPeerTCP.STATUS_CONNECTED or cur == StreamPeerTCP.STATUS_CONNECTING:
		return

	var port := _current_port()
	if _peer.get_status() != StreamPeerTCP.STATUS_NONE:
		_peer.disconnect_from_host()

	_peer = StreamPeerTCP.new()
	var err := _peer.connect_to_host(_host, port)
	if err != OK:
		push_warning("X-agent RPC: connect failed to %s:%s (%s)" % [_host, str(port), str(err)])
	else:
		_peer.set_no_delay(true)
		_connect_started_ms = Time.get_ticks_msec()
		print("X-agent RPC: connecting to %s:%s …" % [_host, str(port)])

func _poll_messages() -> void:
	var available := _peer.get_available_bytes()
	if available <= 0:
		return
	var chunk := _peer.get_utf8_string(available)
	_buffer += chunk

	while true:
		var nl := _buffer.find("\n")
		if nl < 0:
			break
		var line := _buffer.substr(0, nl).strip_edges()
		_buffer = _buffer.substr(nl + 1)
		if line != "":
			_handle_line(line)

func _send(payload: Dictionary) -> void:
	if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	_peer.put_data((JSON.stringify(payload) + "\n").to_utf8_buffer())

# =============================================================================
# Scene helpers + RPC methods
# =============================================================================

func _on_scene_changed(_scene_root: Node) -> void:
	var path := ""
	var root := EditorInterface.get_edited_scene_root()
	if root != null:
		path = root.scene_file_path
	_send({"type": "scene_changed", "path": path})

func _edited_scene_path() -> String:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return ""
	return root.scene_file_path

func _import_resources(raw_paths) -> Dictionary:
	var fs := EditorInterface.get_resource_filesystem()
	if fs == null:
		return {"ok": false, "error": "EditorFileSystem unavailable"}
	var paths: Array[String] = []
	if typeof(raw_paths) == TYPE_ARRAY:
		for p in raw_paths:
			var s := str(p).strip_edges()
			if s != "":
				paths.append(s)
	if paths.is_empty():
		fs.scan()
		return {"ok": true, "mode": "scan", "paths": []}
	var packed := PackedStringArray()
	for p in paths:
		packed.append(p)
		fs.update_file(p)
	fs.reimport_files(packed)
	return {"ok": true, "mode": "reimport", "paths": paths}

func _capture_scene_tree(scene_path: String, max_depth: int) -> Dictionary:
	# 确保场景已打开（仅当需要时打开，避免覆盖当前编辑场景）
	var open := Array(EditorInterface.get_open_scenes())
	if scene_path not in open:
		EditorInterface.open_scene_from_path(scene_path)
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return {"error": "scene not open or empty"}
	return {
		"path": scene_path,
		"max_depth": max_depth,
		"tree": _serialize_node(root, max_depth, 0),
	}

func _serialize_node(node: Node, max_depth: int, depth: int) -> Dictionary:
	var out := {
		"name": str(node.name),
		"type": node.get_class(),
		"script": _script_path_of(node),
	}
	if depth >= max_depth:
		out["children_truncated"] = node.get_child_count()
		return out
	var children: Array = []
	for c in node.get_children():
		children.append(_serialize_node(c, max_depth, depth + 1))
	out["children"] = children
	return out

func _script_path_of(node: Node) -> String:
	var script := node.get_script()
	if script == null:
		return ""
	return str(script.resource_path)

func _capture_node_properties(scene_path: String, node_path: String) -> Dictionary:
	var open := Array(EditorInterface.get_open_scenes())
	if scene_path not in open:
		EditorInterface.open_scene_from_path(scene_path)
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return {"error": "scene not open or empty"}
	var target := root.get_node_or_null(NodePath(node_path))
	if target == null:
		return {"error": "node not found: %s" % node_path}
	var props: Array = []
	var plist := target.get_property_list()
	for p in plist:
		var usage: int = int(p.get("usage", 0))
		# 仅导出脚本变量与持久化属性
		if (usage & PROPERTY_USAGE_SCRIPT_VARIABLE) != 0 or (usage & PROPERTY_USAGE_STORAGE) != 0:
			props.append({
				"name": str(p.name),
				"type": type_string(int(p.type)),
				"hint": str(p.get("hint", "")),
			})
	return {"path": scene_path, "node_path": node_path, "properties": props}

func _handle_line(raw: String) -> void:
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		return
	if data.has("type"):
		return

	var id := str(data.get("id", ""))
	var method := str(data.get("method", ""))
	var response := {"id": id, "ok": true, "result": {}}

	match method:
		"ping":
			response["result"] = {"pong": true}

		"get_editor_info":
			response["result"] = {
				"godotVersion": Engine.get_version_info(),
				"projectPath": ProjectSettings.globalize_path("res://"),
				"editedScene": _edited_scene_path(),
				"playing": EditorInterface.is_playing_scene(),
			}

		"get_open_scenes":
			response["result"] = {
				"scenes": Array(EditorInterface.get_open_scenes()),
			}

		"get_edited_scene":
			response["result"] = {
				"path": _edited_scene_path(),
				"playing": EditorInterface.is_playing_scene(),
				"playingScene": EditorInterface.get_playing_scene(),
			}

		"open_scene":
			var open_path := str(data.get("path", ""))
			if open_path == "":
				response = {"id": id, "ok": false, "error": "path required"}
			else:
				EditorInterface.open_scene_from_path(open_path)
				response["result"] = {"opened": open_path}

		"reload_scene":
			var reload_path := str(data.get("path", ""))
			if reload_path == "":
				response = {"id": id, "ok": false, "error": "path required"}
			else:
				var open := Array(EditorInterface.get_open_scenes())
				if reload_path not in open:
					EditorInterface.open_scene_from_path(reload_path)
				EditorInterface.reload_scene_from_path(reload_path)
				response["result"] = {"reloaded": reload_path}

		"get_scene_tree":
			var scene_path := str(data.get("path", ""))
			var max_depth := int(data.get("max_depth", 8))
			if scene_path == "":
				response = {"id": id, "ok": false, "error": "path required"}
			else:
				response["result"] = _capture_scene_tree(scene_path, max_depth)

		"get_node_properties":
			var scene_path := str(data.get("path", ""))
			var node_path := str(data.get("node_path", ""))
			if scene_path == "" or node_path == "":
				response = {"id": id, "ok": false, "error": "path and node_path required"}
			else:
				response["result"] = _capture_node_properties(scene_path, node_path)

		"run_current_scene":
			if _edited_scene_path() == "" and EditorInterface.get_edited_scene_root() == null:
				response = {"id": id, "ok": false, "error": "no edited scene"}
			elif not _pending_run.is_empty():
				response = {"id": id, "ok": false, "error": "run already in progress"}
			else:
				var wait_ms := _clamp_wait_ms(data.get("wait_ms", DEFAULT_RUN_WAIT_MS))
				_start_run_collect(id, wait_ms, "play_current_scene")
				return # async — response sent from _tick_pending_run

		"play_main_scene":
			if not _pending_run.is_empty():
				response = {"id": id, "ok": false, "error": "run already in progress"}
			else:
				var main_wait := _clamp_wait_ms(data.get("wait_ms", DEFAULT_RUN_WAIT_MS))
				_start_run_collect(id, main_wait, "play_main_scene")
				return # async — response sent from _tick_pending_run

		"import_resources":
			response["result"] = _import_resources(data.get("paths", []))

		"get_play_errors":
			var clear_after := bool(data.get("clear", false))
			response["result"] = {
				"playing": EditorInterface.is_playing_scene(),
				"errors": get_play_errors_snapshot(),
			}
			if clear_after:
				clear_play_errors()

		"stop_scene":
			EditorInterface.stop_playing_scene()
			response["result"] = {"stopped": true}

		_:
			response = {"id": id, "ok": false, "error": "unknown method: %s" % method}

	_send(response)
