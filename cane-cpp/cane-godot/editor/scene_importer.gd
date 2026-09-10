@tool
extends EditorImportPlugin

signal imported(source: String, fingerprints: Dictionary)
const ImportService = preload("import_service.gd")

func _get_importer_name() -> String: return "cane.native.scene"
func _get_visible_name() -> String: return "Cane animation"
func _get_recognized_extensions() -> PackedStringArray: return PackedStringArray(["caneb", "cane"])
func _get_save_extension() -> String: return "scn"
func _get_resource_type() -> String: return "PackedScene"
func _get_import_order() -> int: return 100
func _get_format_version() -> int: return 4
func _get_preset_count() -> int: return 1
func _get_preset_name(_index: int) -> String: return "2D animation"
func _get_import_options(_path: String, _preset: int) -> Array[Dictionary]:
	return [{"name": "animation", "default_value": ""}, {"name": "loop", "default_value": true}, {"name": "playback_speed", "default_value": 1.0}]

func _import(source: String, save_path: String, options: Dictionary, _variants: Array[String], generated: Array[String]) -> Error:
	var runtime = ImportService.source_path(source)
	if not runtime.begins_with("res://") or not FileAccess.file_exists(runtime):
		var missing_dependencies = PackedStringArray([source])
		if runtime.begins_with("res://"):
			missing_dependencies.append(runtime)
		imported.emit(source, fingerprints(missing_dependencies))
		push_error("Cane: the import source is missing or outside the project: " + runtime)
		return ERR_FILE_NOT_FOUND
	var data = CaneSkeletonData.new()
	var runtime_fingerprint = ImportService.fingerprint(runtime)
	var status = data.import_file(runtime)
	if status != OK:
		# Remember missing dependencies too, so restoring a file can recover the import.
		imported.emit(source, fingerprints(data.get_last_import_source_files()))
		push_error("Cane: cannot import " + source + ": " + str(data.get_last_error()))
		return status
	var dependencies = data.get_source_files()
	for path in dependencies:
		if not FileAccess.file_exists(path):
			# An editor texture may still be cached after its source was deleted.
			imported.emit(source, fingerprints(dependencies))
			push_error("Cane: missing export dependency: " + path)
			return ERR_FILE_NOT_FOUND
		if not path.simplify_path().begins_with("res://"):
			push_error("Cane: keep the complete export inside this Godot project: " + path)
			return ERR_FILE_BAD_PATH
	# Resource reloads below can pump the editor loop. Keep the dependency version
	# read by this import so a second save during reimport is detected next time.
	var dependency_fingerprints = fingerprints(dependencies)
	dependency_fingerprints[runtime] = runtime_fingerprint
	var node = CaneSkeleton.new()
	node.name = source.get_file().get_basename().validate_node_name()
	node.skeleton_data = data
	var animation: String = options.get("animation", "")
	var animations = data.get_animation_ids()
	if animation.is_empty() and not animations.is_empty():
		animation = "idle" if "idle" in animations else ("run" if "run" in animations else animations[0])
	node.initial_animation = animation
	if not node.get_last_error().is_empty():
		push_error("Cane: unknown initial animation: " + animation)
		node.free()
		return ERR_INVALID_DATA
	node.initial_loop = options.get("loop", true)
	node.playback_speed = options.get("playback_speed", 1.0)
	var failure = node.get_last_error()
	if not failure.is_empty() or (not animation.is_empty() and node.initial_animation != animation):
		push_error("Cane: invalid import playback settings: " + str(failure))
		node.free()
		return ERR_INVALID_DATA
	var skins = data.get_skin_ids()
	if "default" in skins:
		node.initial_skins = PackedStringArray(["default"])
	# Keep a separate generated resource: Godot can reload its cached object in
	# place while scene instances retain the source PackedScene reference and UID.
	var data_path = save_path + ".data.res"
	# Make the native library an ordinary dependency. Selected-scene exports then
	# include its descriptor, DLL and Godot's complete extension list automatically.
	var extension_path: String = get_script().resource_path.get_base_dir().get_base_dir().path_join("cane.gdextension")
	data.set_meta("_cane_runtime_extension", load(extension_path))
	status = ResourceSaver.save(data, data_path, ResourceSaver.FLAG_COMPRESS)
	if status != OK:
		node.free()
		return status
	var shared_data = ResourceLoader.load(data_path, "CaneSkeletonData", ResourceLoader.CACHE_MODE_REPLACE)
	if not shared_data is CaneSkeletonData or not shared_data.is_loaded():
		node.free()
		return ERR_INVALID_DATA
	node.skeleton_data = shared_data
	generated.append(data_path)
	# Godot's selected-scene dependency walk does not recurse into generated files
	# outside its FileSystem tree. Expose their resources on the imported scene too.
	var scene_dependencies: Array = shared_data.get_imported_bundle().textures.values()
	scene_dependencies.append(data.get_meta("_cane_runtime_extension"))
	node.set_meta("_cane_import_dependencies", scene_dependencies)
	var scene = PackedScene.new()
	status = scene.pack(node)
	node.free()
	if status == OK:
		status = ResourceSaver.save(scene, save_path + ".scn", ResourceSaver.FLAG_COMPRESS)
	if status == OK:
		imported.emit(source, dependency_fingerprints)
	return status

func fingerprints(dependencies: PackedStringArray) -> Dictionary:
	var result: Dictionary = {}
	for path in dependencies:
		result[path.simplify_path()] = ImportService.fingerprint(path)
	return result
