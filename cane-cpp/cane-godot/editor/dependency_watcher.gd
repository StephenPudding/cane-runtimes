@tool
extends Node

const ImportService = preload("import_service.gd")
const CACHE_DIRECTORY = "res://.godot/cane/dependencies"
var records: Dictionary = {}
var filesystem: EditorFileSystem
var busy: bool = false
var force_hash: bool = true
var importer_version: int = 0

func start() -> void:
	filesystem = EditorInterface.get_resource_filesystem()
	DirAccess.make_dir_recursive_absolute(CACHE_DIRECTORY)
	for name in DirAccess.get_files_at(CACHE_DIRECTORY):
		if not name.ends_with(".cfg"):
			continue
		var config = ConfigFile.new()
		if config.load(CACHE_DIRECTORY.path_join(name)) == OK:
			var source = config.get_value("import", "source", "")
			var files = config.get_value("import", "files", {})
			if source is String and source.begins_with("res://") and files is Dictionary:
				records[source] = files
	filesystem.filesystem_changed.connect(request_check)
	filesystem.resources_reimporting.connect(func(_files): busy = true)
	filesystem.resources_reimported.connect(func(_files): busy = false; request_check())
	var timer = Timer.new()
	timer.wait_time = 2.0
	timer.timeout.connect(check_dependencies)
	add_child(timer)
	timer.start()

func request_check() -> void:
	force_hash = true

func record(source: String, fingerprints: Dictionary) -> void:
	var files: Dictionary = fingerprints.duplicate(true)
	records[source] = files
	var config = ConfigFile.new()
	config.set_value("import", "source", source)
	config.set_value("import", "files", files)
	config.save(CACHE_DIRECTORY.path_join(source.sha256_text() + ".cfg"))

func check_dependencies() -> void:
	if busy or filesystem.is_scanning():
		return
	var pending: PackedStringArray = []
	var complete_hash = force_hash
	force_hash = false
	for source: String in records.keys():
		if not FileAccess.file_exists(source):
			records.erase(source)
			continue
		var files: Dictionary = records[source]
		var changed: bool = false
		if complete_hash:
			var config = ConfigFile.new()
			if config.load(source + ".import") == OK:
				changed = config.get_value("remap", "importer_version", 0) < importer_version
		for path: String in files:
			var previous: Dictionary = files[path]
			var current = ImportService.fingerprint(path, false)
			if complete_hash or current.modified != previous.modified or current.size != previous.size:
				current = ImportService.fingerprint(path)
				changed = changed or current.hash != previous.hash
				files[path] = current
		if changed:
			pending.append(source)
	if not pending.is_empty():
		# Godot pumps the editor loop while importing. Prevent recursive reimports.
		busy = true
		filesystem.reimport_files(pending)
		busy = false
