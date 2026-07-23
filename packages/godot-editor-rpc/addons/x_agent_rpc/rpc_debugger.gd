@tool
extends EditorDebuggerPlugin

## Captures play-session errors/breaks for X-agent RPC.
## Debugger "Errors" tab entries arrive via ScriptEditorDebugger.debug_data("error", …).

var _append: Callable = Callable()
var _hooked_debuggers: Dictionary = {} # ObjectID -> true

func configure(append_cb: Callable) -> void:
	_append = append_cb

func _setup_session(session_id: int) -> void:
	var session := get_session(session_id)
	if session == null:
		return
	if not session.started.is_connected(_on_session_started):
		session.started.connect(_on_session_started.bind(session_id))
	if not session.stopped.is_connected(_on_session_stopped):
		session.stopped.connect(_on_session_stopped.bind(session_id))
	if not session.breaked.is_connected(_on_session_breaked):
		session.breaked.connect(_on_session_breaked.bind(session_id))
	_try_hook_script_debuggers()

func _on_session_started(_session_id: int) -> void:
	_try_hook_script_debuggers()

func _on_session_stopped(_session_id: int) -> void:
	pass

func _on_session_breaked(can_debug: bool, _session_id: int) -> void:
	if not _append.is_valid():
		return
	if can_debug:
		_append.call("warning", "Debugger break (can_debug=true)")
	else:
		_append.call("error", "Debugger break (non-debuggable, often parse/script error)")

func _try_hook_script_debuggers() -> void:
	var base := EditorInterface.get_base_control()
	if base == null:
		return
	var nodes: Array = base.find_children("*", "ScriptEditorDebugger", true, false)
	for n in nodes:
		var node: Node = n as Node
		if node == null or not is_instance_valid(node):
			continue
		var oid: int = node.get_instance_id()
		if _hooked_debuggers.has(oid):
			continue
		_hooked_debuggers[oid] = true
		# Output dock (console)
		if node.has_signal("output") and not node.output.is_connected(_on_debugger_output):
			node.output.connect(_on_debugger_output)
		# Debugger Errors tab + all other remote messages
		if node.has_signal("debug_data") and not node.debug_data.is_connected(_on_debug_data):
			node.debug_data.connect(_on_debug_data)
		# Break / stack reason
		if node.has_signal("breaked") and not node.breaked.is_connected(_on_debugger_breaked):
			node.breaked.connect(_on_debugger_breaked)

func _on_debugger_output(message: String, message_type: int) -> void:
	if not _append.is_valid():
		return
	# EditorLog.MessageType: STD=0, ERROR=1, STD_RICH=2, WARNING=3
	var severity := "info"
	if message_type == 1:
		severity = "error"
	elif message_type == 3:
		severity = "warning"
	else:
		var lower := message.to_lower()
		if "error" in lower or "failed" in lower:
			severity = "error"
		elif "warning" in lower or "warn" in lower:
			severity = "warning"
		else:
			return
	_append.call(severity, message)

func _on_debug_data(msg: String, data: Array) -> void:
	if not _append.is_valid():
		return
	if msg != "error":
		return
	# DebuggerMarshalls::OutputError layout (11+ header):
	# 0-3 time, 4 source_file, 5 source_func, 6 source_line,
	# 7 error, 8 error_descr, 9 warning, 10 stack_size*3, then file/func/line…
	if data.size() < 11:
		_append.call("error", "Debugger error (unparsed): %s" % str(data))
		return

	var source_file := str(data[4])
	var source_func := str(data[5])
	var source_line: int = int(data[6])
	var error_cond := str(data[7])
	var error_descr := str(data[8])
	var is_warning: bool = bool(data[9])

	var title := error_descr if error_descr != "" else error_cond
	var prefix := ""
	if source_func != "" and source_file.begins_with("res://"):
		prefix = "%s: " % source_func
	elif data.size() > 13:
		# First stack frame: file, func, line at indices 11..13
		var stack_file := str(data[11])
		var stack_func := str(data[12])
		var stack_line: int = int(data[13])
		if stack_file != "" or stack_func != "":
			prefix = "%s:%d @ %s(): " % [stack_file.get_file(), stack_line, stack_func]
	elif source_func != "":
		prefix = "%s: " % source_func

	var loc := ""
	if source_file != "":
		loc = " (%s:%d)" % [source_file, source_line]

	var severity := "warning" if is_warning else "error"
	_append.call(severity, "%s%s%s" % [prefix, title, loc])

func _on_debugger_breaked(really_did: bool, can_debug: bool, reason: String, _has_stackdump: bool) -> void:
	if not _append.is_valid() or not really_did:
		return
	var msg := reason.strip_edges()
	if msg == "":
		msg = "Debugger break (can_debug=%s)" % str(can_debug)
	var severity := "error" if not can_debug else "warning"
	_append.call(severity, msg)
