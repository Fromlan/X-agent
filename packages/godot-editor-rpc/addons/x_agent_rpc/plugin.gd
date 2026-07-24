@tool
extends EditorPlugin

## X-agent Godot Editor RPC client.
## Connects to the desktop TCP JSON-lines bridge
## (endpoint: ~/.pi/agent/x-agent-godot-rpc.json, fallback 127.0.0.1:8765).

const DEFAULT_HOST := "127.0.0.1"
const DEFAULT_PORT := 8765
const CONNECT_TIMEOUT_SEC := 3.0
const FALLBACK_PORT_START := 8765
const FALLBACK_PORT_END_INCLUSIVE := 8774
const DEFAULT_RUN_WAIT_MS := 3000
const MAX_RUN_WAIT_MS := 15000
const MAX_PLAY_ERRORS := 50

# --- TCP connection ---
var _peer: StreamPeerTCP = StreamPeerTCP.new()
var _connected: bool = false
var _buffer: String = ""
var _reconnect_in: float = 0.0
var _host: String = DEFAULT_HOST
var _primary_port: int = DEFAULT_PORT
var _ports_to_try: Array[int] = []
var _port_try_index: int = 0
var _connect_started_ms: int = 0

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
			_reconnect_in = 2.0
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

func _resolve_endpoint() -> void:
	_host = DEFAULT_HOST
	_primary_port = DEFAULT_PORT
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
