@tool
extends EditorPlugin

## X-agent Godot Editor RPC client.
## Connects to the desktop TCP JSON-lines bridge
## (endpoint: ~/.pi/agent/x-agent-godot-rpc.json, fallback 127.0.0.1:8765).

const ADDON_VERSION := "0.5.0"
const DEFAULT_HOST := "127.0.0.1"
const DEFAULT_PORT := 8765
const CONNECT_TIMEOUT_SEC := 1.2
const FALLBACK_PORT_START := 8765
const FALLBACK_PORT_END_INCLUSIVE := 8774
const DEFAULT_RUN_WAIT_MS := 3000
const MAX_RUN_WAIT_MS := 15000
const MAX_PLAY_ERRORS := 50
## 1.2：lint 失败文件走 --check-only 子进程取行号的超时（含 Godot 冷启动）。
const LINT_CHECK_ONLY_TIMEOUT_MS := 30_000
## 1.2：export_project 子进程总超时（大项目出包可能数分钟）。
const EXPORT_TIMEOUT_MS := 300_000
## 1.2：find_unused_resources 视为文本并扫描引用的扩展名（其余按二进制跳过）。
const SCAN_TEXT_EXTENSIONS := ["tscn", "tres", "res", "gd", "gdshader", "cfg", "json", "txt", "md", "godot", "svg", "css", "glsl"]


## 1.3：list_project_files / wait_for_import_done 上限与默认值。
const LIST_FILES_DEFAULT_LIMIT := 500
const LIST_FILES_MAX_LIMIT := 5000
const WAIT_DEFAULT_TIMEOUT_MS := 30_000
const WAIT_MAX_TIMEOUT_MS := 60_000



## 1.2：未使用资源扫描的候选扩展名（场景 / 脚本 / 资源）。
const RESOURCE_EXTENSIONS := ["tscn", "tres", "res", "gd", "gdshader"]
## 每秒检查一次 endpoint 文件 mtime；变更或消失时立即重解析并重连。
## Godot 4 无 inotify 绑定，1s 轮询是跨平台最稳的方案。
const ENDPOINT_POLL_SEC := 1.0
## 断开后再次尝试连入的间隔。
const RECONNECT_DELAY_SEC := 0.5
## 对同一端口连续重试达到该次数后，推进到下一个候选端口。
## 避免「桥接关闭期间端口被拒（立即 RST）」时永远只试主端口、
## 永远遍历不到 fallback 端口（8765–8774）导致桥接重启后无法重连。
const RECONNECTS_BEFORE_ADVANCE := 4

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
## 对当前端口的连续失败重试计数，达到 RECONNECTS_BEFORE_ADVANCE 后推进端口。
var _connect_attempts: int = 0

# --- Endpoint mtime polling ---
var _endpoint_mtime: int = 0
var _endpoint_check_in: float = 0.0

# --- Play error capture ---
var _debugger: EditorDebuggerPlugin
var _play_errors: Array = [] # [{ severity, message, time_ms }, ...]
var _pending_run: Dictionary = {} # { id, wait_ms, start_ms, was_playing }

# --- 1.2: export / breakpoints ---
## 进行中的导出子进程（{ id, pid, log_path, out_path, start_ms, timeout_ms }）。
var _pending_export: Dictionary = {}
## 已设置的编辑器断点（path → { line, condition }）；会话启动时自动重放。
var _breakpoints: Dictionary = {}

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
	_tick_pending_export()
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
			_connect_attempts = 0
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
			_reconnect_tick()
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
		_debugger.configure(Callable(self, "append_play_error"), Callable(self, "get_pending_breakpoints"))
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
			_connect_attempts = 0
			_resolve_endpoint()
			_build_ports_to_try()
			_port_try_index = 0
			_try_connect()
		return
	if mtime != _endpoint_mtime:
		# endpoint 文件被更新 → X-agent 重启或 token 换新。
		_endpoint_mtime = mtime
		_connect_attempts = 0
		_resolve_endpoint()
		_build_ports_to_try()
		_port_try_index = 0
		_try_connect()

## 断线重连调度（由 STATUS_ERROR / STATUS_NONE 分支驱动）：
## - 每次重连前重读 endpoint，感知 X-agent 重启后的 token / 端口变化，变了立即回到主端口；
## - 对同一端口连续重试 RECONNECTS_BEFORE_ADVANCE 次后推进到下一个候选端口，
##   候选耗尽后自动重读 endpoint 并回到主端口——保证「桥接关闭 → 重启」后
##   插件无需重启编辑器即可在 0.5–2s 内恢复连接。
func _reconnect_tick() -> void:
	var prev_primary := _primary_port
	var prev_token := _auth_token
	_resolve_endpoint()
	if _primary_port != prev_primary or _auth_token != prev_token:
		# endpoint 已更新（如桥接换端口 / token 换新）：重建候选表并回到主端口立即重试。
		_build_ports_to_try()
		_port_try_index = 0
		_connect_attempts = 0
		_try_connect()
		return
	if _connect_attempts >= RECONNECTS_BEFORE_ADVANCE:
		_connect_attempts = 0
		_advance_port()
		return
	_connect_attempts += 1
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
	var parsed_port := int(data.get("port", DEFAULT_PORT))
	# 防御损坏 / 被篡改的 endpoint：非法端口回退默认值，避免连到无效端口。
	if parsed_port < 1 or parsed_port > 65535:
		parsed_port = DEFAULT_PORT
	_primary_port = parsed_port
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
	var script: Script = node.get_script()
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

# =============================================================================
# 1.2 扩展：项目配置读写 / GDScript lint / 资源治理 / 导出 / 调试器
# =============================================================================

func _read_text_file(path: String) -> String:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return ""
	return file.get_as_text()

func _get_project_setting(key: String) -> Dictionary:
	if not ProjectSettings.has_setting(key):
		return {"exists": false, "key": key}
	return {"exists": true, "key": key, "value": ProjectSettings.get_setting(key)}

func _set_project_setting(key: String, value) -> Dictionary:
	ProjectSettings.set_setting(key, value)
	var err := ProjectSettings.save()
	if err != OK:
		return {"saved": false, "key": key, "error": "ProjectSettings.save failed: %s" % error_string(err)}
	return {"saved": true, "key": key}

## Godot 4 无公开的 parse error 细节 API（Script.reload 只给错误码），
## 失败文件用 --check-only 子进程补全行号；子进程不可用则退回错误码文案。
func _lint_scripts(paths: Array) -> Dictionary:
	var files: Array = []
	for raw in paths:
		var path := str(raw).strip_edges()
		if path == "" or not path.ends_with(".gd"):
			continue
		if not FileAccess.file_exists(path):
			files.append({"path": path, "ok": false, "issues": [{"line": 0, "column": 0, "message": "file not found", "severity": "error"}]})
			continue
		files.append(_lint_script(path))
	return {"files": files}

func _lint_script(path: String) -> Dictionary:
	var script: GDScript = GDScript.new()
	script.source_code = _read_text_file(path)
	var err := script.reload()
	# 编辑器上下文里无 resource_path 的新脚本 can_instantiate() 恒为 false，
	# 因此只以 reload() 的错误码判定；细节交给 _check_only_details 补全。
	if err == OK:
		return {"path": path, "ok": true, "issues": []}
	var issues: Array = []
	# reload() 的错误码在 4.4+ 之间有重排，不可依赖具体数值 → 一律用子进程补细节
	var detail := _check_only_details(path)
	if detail.is_empty():
		issues.append({"line": 0, "column": 0, "message": error_string(int(err)), "severity": "error"})
	else:
		issues = detail
	return {"path": path, "ok": false, "issues": issues}

func _check_only_details(path: String) -> Array:
	var exe := OS.get_executable_path()
	if exe == "":
		return []
	var output := []
	var exit_code := OS.execute(exe, ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--check-only", "-s", path], output, true, LINT_CHECK_ONLY_TIMEOUT_MS)
	if exit_code == 0 and output.is_empty():
		return []
	var issues: Array = []
	# 输出形如 "SCRIPT ERROR: Parse Error: <msg>\n   at: ... (res://foo.gd:4)"；
	# Windows 上 stdout/stderr 会合并成单个大块，需要逐行拆分。
	var kind_re := RegEx.new()
	kind_re.compile("^SCRIPT ERROR: (Parse Error|Compile Error|Warning)")
	var line_re := RegEx.new()
	# res:// 路径本身含冒号，前缀字符类不能排除 ':'
	line_re.compile("\\(([^()]*):(\\d+)\\)")
	var lines: Array = []
	for raw in output:
		lines.append_array(str(raw).split("\n"))
	for i in lines.size():
		var s := str(lines[i]).strip_edges()
		var kind_match := kind_re.search(s)
		if kind_match == null:
			continue
		var message := s.substr("SCRIPT ERROR: ".length(), 300)
		var line := 0
		# 位置信息在下一行 "   at: GDScript::reload (res://foo.gd:N)"
		if i + 1 < lines.size():
			var m := line_re.search(str(lines[i + 1]))
			if m != null and m.get_group_count() >= 2:
				line = int(m.get_string(2))
		var severity := "warning" if kind_match.get_string(1) == "Warning" else "error"
		issues.append({"line": line, "column": 0, "message": message, "severity": severity})
	return issues

func _collect_files(root: String) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(root)
	if dir == null:
		return out
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if name == "." or name == "..":
			name = dir.get_next()
			continue
		# 编辑器缓存目录不计入资源治理
		if name == ".godot":
			name = dir.get_next()
			continue
		var full := root.path_join(name)
		if dir.current_is_dir():
			out.append_array(_collect_files(full))
		else:
			out.append(full)
		name = dir.get_next()
	dir.list_dir_end()
	return out

func _find_unused_resources(root: String) -> Dictionary:
	var scan_root := root if root != "" else "res://"
	var files := _collect_files(scan_root)
	var referenced := {}
	var candidates: Array[String] = []
	var res_re := RegEx.new()
	res_re.compile("res://[\\w.\\-/]+")
	var uid_re := RegEx.new()
	uid_re.compile("uid://[\\w]+")
	var class_name_re := RegEx.new()
	class_name_re.compile("^\\s*class_name\\s+[A-Za-z_][A-Za-z0-9_]*")
	for path in files:
		var ext := path.get_extension().to_lower()
		var is_candidate := ext in RESOURCE_EXTENSIONS
		if not is_candidate and not (ext in SCAN_TEXT_EXTENSIONS):
			continue
		var text := _read_text_file(path)
		if text == "":
			continue
		# 二进制资源（.res 可能以二进制形式保存）跳过
		if text.contains(String.chr(0)):
			continue
		if is_candidate:
			# addons/ 下的插件文件互为引用（如 plugin.cfg → plugin.gd 无 res:// 前缀），
			# 不计入候选，避免误报「未使用」；仍参与引用扫描。
			if not ("/addons/" in path):
				candidates.append(path)
			if ext == "gd" and class_name_re.search(text) != null:
				# class_name 脚本可通过全局类名被间接引用，无法静态追踪 → 视为已引用
				referenced[path] = true
		for m in res_re.search_all(text):
			var ref := m.get_string()
			if ref != "res://":
				referenced[ref] = true
		for m in uid_re.search_all(text):
			var uid_path: String = ResourceUID.uid_to_path(m.get_string())
			if uid_path != "":
				referenced[uid_path] = true
	var unused: Array = []
	for c in candidates:
		if not referenced.has(c):
			var kind := "script"
			if c.ends_with(".tscn"):
				kind = "scene"
			elif c.ends_with(".tres") or c.ends_with(".res"):
				kind = "resource"
			unused.append({"path": c, "kind": kind})
	return {"root": scan_root, "scannedFiles": files.size(), "candidates": candidates.size(), "unused": unused}

func _list_export_presets() -> Array[String]:
	var presets: Array[String] = []
	var path := ProjectSettings.globalize_path("res://export_presets.cfg")
	if not FileAccess.file_exists(path):
		return presets
	for line in _read_text_file(path).split("\n"):
		var s := line.strip_edges()
		if s.begins_with("name="):
			presets.append(s.substr(5).strip_edges().trim_prefix("\"").trim_suffix("\""))
	return presets

## 启动导出子进程（异步，响应由 _tick_pending_export 发送）。
## 返回 true 表示已接管（含直接同步发错误响应的情况）。
func _start_export(id: String, preset: String, output_dir: String, debug: bool) -> bool:
	var presets := _list_export_presets()
	if not presets.has(preset):
		_send({"id": id, "ok": false, "error": "unknown export preset: %s (available: %s)" % [preset, ", ".join(presets)]})
		return true
	var exe := OS.get_executable_path()
	if exe == "":
		_send({"id": id, "ok": false, "error": "cannot locate the running Godot executable"})
		return true
	var project_dir := ProjectSettings.globalize_path("res://")
	var out_path := output_dir
	if out_path.begins_with("res://"):
		out_path = ProjectSettings.globalize_path(out_path)
	elif not out_path.is_absolute_path():
		out_path = project_dir.path_join(out_path)
	if out_path.ends_with("/") or out_path == "":
		out_path = out_path.trim_suffix("/")
		var exe_name := str(ProjectSettings.get_setting("application/config/name", "game")).replace(" ", "_")
		out_path = out_path.path_join("%s.exe" % exe_name)
	DirAccess.make_dir_recursive_absolute(out_path.get_base_dir())
	var log_path := OS.get_cache_dir().path_join("x-agent-export-%s.log" % id)
	var flag := "--export-debug" if debug else "--export-release"
	var args := PackedStringArray(["--headless", "--path", project_dir, flag, preset, out_path, "--log-file", log_path])
	var pid := OS.create_process(exe, args)
	if pid <= 0:
		return false
	_pending_export = {"id": id, "pid": pid, "log_path": log_path, "out_path": out_path, "start_ms": Time.get_ticks_msec(), "timeout_ms": EXPORT_TIMEOUT_MS}
	return true

func _tick_pending_export() -> void:
	if _pending_export.is_empty():
		return
	var pid: int = int(_pending_export.get("pid", 0))
	var id := str(_pending_export.get("id", ""))
	var start_ms: int = int(_pending_export.get("start_ms", Time.get_ticks_msec()))
	var timeout_ms: int = int(_pending_export.get("timeout_ms", EXPORT_TIMEOUT_MS))
	var elapsed := Time.get_ticks_msec() - start_ms
	var running := OS.is_process_running(pid)
	var done := false
	var timed_out := false
	if not running:
		done = true
	elif elapsed >= timeout_ms:
		timed_out = true
		OS.kill(pid)
		done = true
	if not done:
		return
	var log := _read_text_file(str(_pending_export.get("log_path", "")))
	var out_path := str(_pending_export.get("out_path", ""))
	_pending_export = {}
	var errors: Array[String] = []
	for line in log.split("\n"):
		var s := line.strip_edges()
		if s.begins_with("ERROR") or s.begins_with("SCRIPT ERROR"):
			errors.append(s)
	var success := (not timed_out) and errors.is_empty() and FileAccess.file_exists(out_path)
	_send({
		"id": id,
		"ok": true,
		"result": {
			"ok": success,
			"timedOut": timed_out,
			"outputPath": out_path,
			"errors": errors.slice(0, 20),
			"logTail": log.substr(max(0, log.length() - 2000)),
		},
	})

func _debugger_state() -> Dictionary:
	var sessions: Array = []
	var break_count := 0
	if _debugger != null and _debugger.has_method("snapshot"):
		var snap: Dictionary = _debugger.snapshot()
		sessions = snap.get("sessions", [])
		break_count = int(snap.get("breakCount", 0))
	return {
		"playing": EditorInterface.is_playing_scene(),
		"playingScene": EditorInterface.get_playing_scene(),
		"sessions": sessions,
		"breakCount": break_count,
		"pendingBreakpoints": _breakpoints.size(),
		"errors": get_play_errors_snapshot(),
	}

func _set_breakpoint(file: String, line: int, condition: String, enabled: bool) -> Dictionary:
	if not file.begins_with("res://"):
		if FileAccess.file_exists(file):
			file = ProjectSettings.localize_path(file)
	if not FileAccess.file_exists(file):
		return {"ok": false, "error": "file not found: %s" % file}
	if enabled:
		_breakpoints[file] = {"line": line, "condition": condition}
	else:
		_breakpoints.erase(file)
	var applied := 0
	if _debugger != null and _debugger.has_method("apply_breakpoint"):
		applied = _debugger.apply_breakpoint(file, line, enabled)
	return {
		"ok": true,
		"file": file,
		"line": line,
		"enabled": enabled,
		"appliedSessions": applied,
		# Godot 4 断点 API 不支持条件表达式，仅在提示语中说明
		"conditionIgnored": enabled and condition != "",
	}

## 供 rpc_debugger.gd 在会话启动时重放未应用的断点。
func get_pending_breakpoints() -> Array:
	var out: Array = []
	for file in _breakpoints:
		out.append({"file": file, "line": int(_breakpoints[file]["line"])})
	return out

# =============================================================================
# 1.3：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检 helpers
# =============================================================================

## 把 res://xxx 规范化（缺省 → res://，末尾不带 /）。
func _normalize_res_path(p: String, fallback: String) -> String:
	var s := p.strip_edges()
	if s == "":
		return fallback
	if not s.begins_with("res://"):
		s = "res://" + s
	if s.length() > 6 and s.ends_with("/"):
		s = s.substr(0, s.length() - 1)
	return s

## 把 Godot 内部 type 字符串映射为我们对外的 kind。
func _classify_file_kind(type_name: String, path: String) -> String:
	var ext := path.get_extension().to_lower()
	match type_name:
		"PackedScene":
			return "scene"
		"GDScript", "CSharpScript":
			return "script"
		"Shader", "ShaderInclude":
			return "shader"
		"Texture2D", "Texture3D", "TextureLayered", "CompressedTexture2D", "ImageTexture":
			return "texture"
		"AudioStream", "AudioStreamMP3", "AudioStreamOGGVorbis", "AudioStreamWAV", "AudioStreamRandomizer":
			return "audio"
		_:
			if ext in ["tscn", "scn"]:
				return "scene"
			if ext in ["gd", "cs"]:
				return "script"
			if ext in ["gdshader", "shader", "gdshaderinc"]:
				return "shader"
			if ext in ["tres", "res"]:
				return "resource"
			if ext in ["png", "jpg", "jpeg", "webp", "svg", "bmp", "tga", "ktx"]:
				return "texture"
			if ext in ["wav", "ogg", "mp3", "flac", "opus"]:
				return "audio"
			return "other"

## 把 BFS 走到的文件按 type/pattern 过滤并截断到 limit。cursor 为空 → 从 root 起跳。
func _list_project_files(root: String, type_filter: String, pattern: String, limit: int, cursor: String) -> Dictionary:
	var fs := EditorInterface.get_resource_filesystem()
	if fs == null:
		return {"root": root, "total": 0, "files": [], "nextCursor": null, "truncated": false}
	var start_path := cursor if cursor != "" else root
	var start_dir := fs.get_filesystem_path(start_path)
	if start_dir == null:
		start_dir = fs.get_filesystem_path(root)
		if start_dir == null:
			return {"root": root, "total": 0, "files": [], "nextCursor": null, "truncated": false}
	var total := 0
	var files: Array = []
	var pattern_lower := pattern.to_lower()
	var type_lower := type_filter.to_lower()
	var queue: Array = [start_dir]
	var truncated := false
	var next_cursor := ""
	while not queue.is_empty():
		var dir: EditorFileSystemDirectory = queue.pop_front()
		var subdir_count := dir.get_subdir_count()
		for i in range(subdir_count):
			queue.append(dir.get_subdir(i))
		var file_count := dir.get_file_count()
		for i in range(file_count):
			total += 1
			var file_path := dir.get_file_path(i)
			var file_type := dir.get_file_type(i)
			var kind := _classify_file_kind(file_type, file_path)
			if type_lower != "" and type_lower != kind:
				continue
			if pattern_lower != "" and not file_path.to_lower().contains(pattern_lower):
				continue
			if files.size() >= limit:
				truncated = true
				next_cursor = dir.get_path()
				break
			var uid_str := ""
			if dir.has_method("get_file_uid"):
				var u := dir.get_file_uid(i)
				if u != 0 and ResourceUID.has_id(u):
					uid_str = ResourceUID.id_to_text(u)
			files.append({"path": file_path, "type": kind, "uid": uid_str})
		if truncated:
			break
	return {
		"root": root,
		"total": total,
		"files": files,
		"nextCursor": next_cursor if next_cursor != "" else null,
		"truncated": truncated,
	}

## 把方法/属性/信号 / 常量列表归一成 {name,type} 数组。
func _gd_member_array(arr: Array) -> Array:
	var out: Array = []
	for m in arr:
		if typeof(m) != TYPE_DICTIONARY:
			continue
		var t := int(m.get("type", TYPE_NIL))
		var type_name := ""
		if t == TYPE_OBJECT:
			var hint_string := str(m.get("hint_string", ""))
			var class_name_h := str(m.get("class_name", ""))
			type_name = hint_string if hint_string != "" else (class_name_h if class_name_h != "" else "Object")
		else:
			type_name = type_string(t)
		out.append({"name": str(m.get("name", "")), "type": type_name})
	return out

## 解析 GDScript 资源 → {signals,methods,properties,constants,base?,extends?}。
func _inspect_script(path: String) -> Dictionary:
	if not ResourceLoader.exists(path):
		return {"path": path, "error": "script not loadable: " + path}
	var res = ResourceLoader.load(path)
	if res == null or not (res is GDScript):
		return {"path": path, "error": "not a GDScript"}
	var script: GDScript = res
	var inspect := {
		"path": path,
		"signals": _gd_member_array(script.get_signal_list()),
		"methods": _gd_member_array(script.get_script_method_list()),
		"properties": _gd_member_array(script.get_script_property_list()),
		"constants": [],
	}
	var base = script.get_base_script()
	if base != null and base is Resource:
		inspect["base"] = base.resource_path
	var consts = script.get_constants()
	if typeof(consts) == TYPE_DICTIONARY and not consts.is_empty():
		var arr: Array = []
		for k in consts.keys():
			arr.append({"name": str(k), "type": type_string(typeof(consts[k]))})
		inspect["constants"] = arr
	if script.get_instance_base_type() != "":
		inspect["extends"] = script.get_instance_base_type()
	return inspect

## 在已打开的 .gd 文件里挑 `class_name X` 顶级声明。
func _scan_class_name_in_gd(path: String, declared: Dictionary) -> void:
	if not FileAccess.file_exists(ProjectSettings.globalize_path(path)):
		return
	var f := FileAccess.open(ProjectSettings.globalize_path(path), FileAccess.READ)
	if f == null:
		return
	var content := f.get_as_text()
	f.close()
	var rx := RegEx.new()
	rx.compile("(?m)^class_name\\s+([A-Za-z_][A-Za-z0-9_]*)")
	for m in rx.search_all(content):
		var name := m.get_string(1)
		if name == "":
			continue
		if not declared.has(name):
			declared[name] = []
		if not declared[name].has(path):
			declared[name].append(path)

## 评估 export_presets.cfg：返回 [{index, name, platform}, ...]。文件不存在时返回 missing=true。
func _enumerate_export_presets() -> Dictionary:
	var cfg_path := "res://export_presets.cfg"
	if not FileAccess.file_exists(cfg_path):
		return {"presets": [], "count": 0, "missing": true}
	var f := FileAccess.open(cfg_path, FileAccess.READ)
	if f == null:
		return {"presets": [], "count": 0, "error": "failed to read export_presets.cfg"}
	var content := f.get_as_text()
	f.close()
	var presets: Array = []
	var current: Dictionary = {}
	var in_preset := false
	for raw in content.split("\n"):
		var line := raw.strip_edges()
		if line.begins_with("[preset.") and line.ends_with("]"):
			if in_preset and current.has("index") and current.has("name"):
				presets.append(current)
			current = {}
			var idx_str := line.substr("[preset.".length(), line.length() - "[preset.".length() - 1)
			current["index"] = int(idx_str)
			in_preset = true
			continue
		if in_preset and line.begins_with("name="):
			current["name"] = line.substr(5).strip_edges().trim_prefix("\"").trim_suffix("\"")
		elif in_preset and line.begins_with("platform="):
			current["platform"] = line.substr(9).strip_edges().trim_prefix("\"").trim_suffix("\"")
		elif in_preset and line.begins_with("[") and line.ends_with("]"):
			if current.has("index") and current.has("name"):
				presets.append(current)
			in_preset = false
	if in_preset and current.has("index") and current.has("name"):
		presets.append(current)
	presets.sort_custom(func(a, b): return a["index"] < b["index"])
	return {"presets": presets, "count": presets.size()}

## 检查当前编辑器版本对应的 export templates 是否安装。
func _check_export_templates() -> Dictionary:
	var version_str := ""
	var v = Engine.get_version_info()
	if typeof(v) == TYPE_DICTIONARY:
		version_str = str(v.get("string", ""))
	var config_dir := OS.get_config_dir()
	var tpl_dir := config_dir.path_join("exported/templates").path_join(version_str)
	var installed := false
	var found: Array = []
	if DirAccess.dir_exists_absolute(tpl_dir):
		var d := DirAccess.open(tpl_dir)
		if d != null:
			d.list_dir_begin()
			var name := d.get_next()
			while name != "":
				if name.ends_with(".tpz"):
					installed = true
					found.append(name.get_basename())
				name = d.get_next()
			d.list_dir_end()
	return {
		"installed": installed,
		"version": version_str,
		"templateDir": tpl_dir,
		"templateFiles": found,
		"missingPlatforms": [],
	}

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

		"get_project_setting":
			var cfg_key := str(data.get("key", ""))
			if cfg_key == "":
				response = {"id": id, "ok": false, "error": "key required"}
			else:
				response["result"] = _get_project_setting(cfg_key)

		"set_project_setting":
			var set_key := str(data.get("key", ""))
			if set_key == "":
				response = {"id": id, "ok": false, "error": "key required"}
			else:
				response["result"] = _set_project_setting(set_key, data.get("value"))

		"lint_scripts":
			var lint_paths = data.get("paths", [])
			if typeof(lint_paths) != TYPE_ARRAY or lint_paths.is_empty():
				response = {"id": id, "ok": false, "error": "paths (non-empty array) required"}
			else:
				response["result"] = _lint_scripts(lint_paths)

		"find_unused_resources":
			response["result"] = _find_unused_resources(str(data.get("root", "res://")))

		"export_project":
			var preset := str(data.get("preset", ""))
			var out_dir := str(data.get("output_dir", ""))
			if preset == "" or out_dir == "":
				response = {"id": id, "ok": false, "error": "preset and output_dir required"}
			elif not _pending_export.is_empty():
				response = {"id": id, "ok": false, "error": "export already in progress"}
			elif not _start_export(id, preset, out_dir, bool(data.get("debug", false))):
				response = {"id": id, "ok": false, "error": "failed to start export process"}
			return # async — response sent from _tick_pending_export

		"get_debugger_state":
			response["result"] = _debugger_state()

		"set_breakpoint":
			var bp_file := str(data.get("file", ""))
			var bp_line := int(data.get("line", 0))
			if bp_file == "" or bp_line < 1:
				response = {"id": id, "ok": false, "error": "file and line (>=1) required"}
			else:
				response["result"] = _set_breakpoint(bp_file, bp_line, str(data.get("condition", "")), not bool(data.get("remove", false)))

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

		# === 1.3: 只读文件内省 / UID / 类名 / 脚本反射 / 导出预检 ===

		"list_project_files":
			var lpf_root := _normalize_res_path(str(data.get("root", "res://")), "res://")
			var lpf_type := str(data.get("type", ""))
			var lpf_pattern := str(data.get("pattern", ""))
			var lpf_limit := int(data.get("limit", LIST_FILES_DEFAULT_LIMIT))
			lpf_limit = clamp(lpf_limit, 1, LIST_FILES_MAX_LIMIT)
			var lpf_cursor := str(data.get("cursor", ""))
			response["result"] = _list_project_files(lpf_root, lpf_type, lpf_pattern, lpf_limit, lpf_cursor)

		"resolve_uid":
			var r_uid := str(data.get("uid", ""))
			var r_path := str(data.get("path", ""))
			if (r_uid == "" and r_path == "") or (r_uid != "" and r_path != ""):
				response = {"id": id, "ok": false, "error": "provide exactly one of 'uid' or 'path'"}
			elif r_uid != "":
				var numeric_id := ResourceUID.text_to_id(r_uid)
				var resolved_path := ""
				var exists := false
				if numeric_id != -1 and ResourceUID.has_id(numeric_id):
					exists = true
					resolved_path = ResourceUID.get_id_path(numeric_id)
				response["result"] = {"uid": r_uid, "path": resolved_path, "exists": exists}
			else:
				var numeric_id2 := -1
				if ResourceLoader.has_method("get_resource_uid"):
					numeric_id2 = ResourceLoader.get_resource_uid(r_path)
				var resolved_uid := ""
				if numeric_id2 != -1:
					resolved_uid = ResourceUID.id_to_text(numeric_id2)
				var r_exists := numeric_id2 != -1 and (ResourceLoader.exists(r_path) or FileAccess.file_exists(ProjectSettings.globalize_path(r_path)))
				response["result"] = {"uid": resolved_uid, "path": r_path, "exists": r_exists}

		"wait_for_import_done":
			var w_paths = data.get("paths", [])
			if typeof(w_paths) != TYPE_ARRAY or w_paths.is_empty():
				response = {"id": id, "ok": false, "error": "paths (non-empty array) required"}
			else:
				var w_timeout := int(data.get("timeout_ms", WAIT_DEFAULT_TIMEOUT_MS))
				w_timeout = clamp(w_timeout, 0, WAIT_MAX_TIMEOUT_MS)
				var fs := EditorInterface.get_resource_filesystem()
				if fs == null:
					response = {"id": id, "ok": false, "error": "EditorFileSystem not available"}
				else:
					var start_ms := Time.get_ticks_msec()
					var done := false
					while not done and (Time.get_ticks_msec() - start_ms) < w_timeout:
						done = not fs.is_scanning()
						if not done:
							OS.delay_msec(100)
					var elapsed := Time.get_ticks_msec() - start_ms
					var remaining: Array = []
					for p in w_paths:
						var pp := str(p)
						var ext := pp.get_extension().to_lower()
						if ext in ["png", "jpg", "jpeg", "webp", "svg", "bmp", "tga", "wav", "ogg", "mp3", "flac", "ttf"]:
							var sidecar := ProjectSettings.globalize_path(pp) + ".import"
							if not FileAccess.file_exists(sidecar):
								remaining.append(pp)
					response["result"] = {
						"ok": remaining.is_empty(),
						"remaining": remaining,
						"elapsedMs": elapsed,
					}

		"list_global_classes":
			var classes := ProjectSettings.get_global_class_list()
			var out: Array = []
			for c in classes:
				if typeof(c) != TYPE_DICTIONARY:
					continue
				out.append({
					"class": str(c.get("class", "")),
					"language": str(c.get("language", "")),
					"path": str(c.get("path", "")),
					"icon": str(c.get("icon", "")),
				})
			response["result"] = {"classes": out, "count": out.size()}

		"find_class_name_conflicts":
			var include_addons := bool(data.get("include_addons", false))
			var declared: Dictionary = {}
			var reg := ProjectSettings.get_global_class_list()
			for c in reg:
				if typeof(c) != TYPE_DICTIONARY:
					continue
				var cn := str(c.get("class", ""))
				var pp := str(c.get("path", ""))
				if cn == "" or pp == "":
					continue
				if not declared.has(cn):
					declared[cn] = []
				if not declared[cn].has(pp):
					declared[cn].append(pp)
			var fs2 := EditorInterface.get_resource_filesystem()
			if fs2 != null:
				var queue: Array = []
				var root_dir := fs2.get_filesystem_path("res://")
				if root_dir != null:
					queue.append(root_dir)
				while not queue.is_empty():
					var d = queue.pop_front()
					if d == null:
						continue
					for i in range(d.get_subdir_count()):
						var sub = d.get_subdir(i)
						if sub == null:
							continue
						var sp := sub.get_path()
						if not include_addons and (sp.begins_with("res://addons/") or sp == "res://addons"):
							continue
						queue.append(sub)
					var d_path := d.get_path()
					var skip_dir := (not include_addons) and (d_path.begins_with("res://addons/") or d_path == "res://addons")
					if skip_dir:
						continue
					for i in range(d.get_file_count()):
						var fp := d.get_file_path(i)
						if not fp.ends_with(".gd"):
							continue
						if not include_addons and fp.begins_with("res://addons/"):
							continue
						_scan_class_name_in_gd(fp, declared)
			var conflicts: Array = []
			for cn in declared.keys():
				var paths: Array = declared[cn]
				if paths.size() > 1:
					conflicts.append({"name": str(cn), "paths": paths})
			conflicts.sort_custom(func(a, b): return a["name"] < b["name"])
			response["result"] = {"conflicts": conflicts, "count": conflicts.size()}

		"inspect_script":
			var i_path := str(data.get("path", ""))
			if i_path == "":
				response = {"id": id, "ok": false, "error": "path required"}
			else:
				response["result"] = _inspect_script(i_path)

		"list_export_presets":
			response["result"] = _enumerate_export_presets()

		"check_export_templates":
			response["result"] = _check_export_templates()

		_:
			response = {"id": id, "ok": false, "error": "unknown method: %s" % method}

	_send(response)
