@tool
extends RefCounted

const DESCRIPTOR_FORMAT = "cane-godot-import"

static func source_path(path: String) -> String:
	if path.get_extension().to_lower() == "caneb":
		return path.simplify_path()
	var document = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not document is Dictionary or document.get("format") != DESCRIPTOR_FORMAT or document.get("version") != 1:
		return ""
	var relative = document.get("source")
	if not relative is String or relative.is_absolute_path():
		return ""
	return path.get_base_dir().path_join(relative).simplify_path()

static func create_descriptor(source: String) -> Dictionary:
	if not source.begins_with("res://") or not FileAccess.file_exists(source):
		return {"error": ERR_FILE_NOT_FOUND, "message": "Copy the Cane export and its images into this Godot project first."}
	if source.get_extension().to_lower() == "caneb":
		return {"error": OK, "path": source}
	var document = JSON.parse_string(FileAccess.get_file_as_string(source))
	if not document is Dictionary or document.get("format") != "cane-runtime":
		return {"error": ERR_INVALID_DATA, "message": "Select a Cane Runtime JSON or CANEB export, not an atlas or editor project."}
	var destination = source.get_basename() + ".cane"
	if FileAccess.file_exists(destination):
		if source_path(destination) == source:
			return {"error": OK, "path": destination}
		return {"error": ERR_ALREADY_EXISTS, "message": "A different file already exists at " + destination}
	var output = FileAccess.open(destination, FileAccess.WRITE)
	if output == null:
		return {"error": FileAccess.get_open_error(), "message": "Cannot create " + destination}
	output.store_string(JSON.stringify({"format": DESCRIPTOR_FORMAT, "version": 1, "source": source.get_file()}, "  ") + "\n")
	output.close()
	return {"error": OK, "path": destination}

static func fingerprint(path: String, with_hash: bool = true) -> Dictionary:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"modified": 0, "size": -1, "hash": ""}
	var result = {"modified": FileAccess.get_modified_time(path), "size": file.get_length()}
	file.close()
	if with_hash:
		result["hash"] = FileAccess.get_md5(path)
	return result
