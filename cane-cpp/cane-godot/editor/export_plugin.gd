@tool
extends EditorExportPlugin

var generated_files: Dictionary = {}

func _get_name() -> String:
	return "Cane native runtime export"

func _export_begin(_features: PackedStringArray, _debug: bool, _path: String, _flags: int) -> void:
	generated_files.clear()

func _export_end() -> void:
	generated_files.clear()

func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	# The game uses native resources and the extension. Editor-only classes are not
	# present in ordinary export templates and need no place in the runtime package.
	var directory = get_script().resource_path.get_base_dir()
	if path.begins_with(directory + "/") or path == directory.get_base_dir().path_join("plugin.cfg"):
		skip()
		return
	if path.get_extension().to_lower() not in ["caneb", "cane"]:
		return
	var imported = ConfigFile.new()
	if imported.load(path + ".import") != OK or imported.get_value("remap", "importer", "") != "cane.native.scene":
		return
	# Export-all walks the editor file tree, which excludes .godot/imported. The
	# generated data resource must also ship when no selected-scene walk adds it.
	for entry in imported.get_value("deps", "files", []):
		var generated_path: String = str(entry).simplify_path()
		if not generated_path.begins_with("res://.godot/imported/") or generated_files.has(generated_path):
			continue
		var bytes = FileAccess.get_file_as_bytes(generated_path)
		if bytes.is_empty():
			get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Cane", "Missing generated animation data: " + generated_path)
			continue
		add_file(generated_path, bytes, false)
		generated_files[generated_path] = true
