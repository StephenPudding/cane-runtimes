@tool
extends EditorPlugin

const ImportService = preload("import_service.gd")
const SceneImporter = preload("scene_importer.gd")
const DependencyWatcher = preload("dependency_watcher.gd")
const Inspector = preload("inspector.gd")
const ExportPlugin = preload("export_plugin.gd")
var importer: EditorImportPlugin
var inspector: EditorInspectorPlugin
var exporter: EditorExportPlugin
var watcher: Node
var file_dialog: EditorFileDialog
var message: AcceptDialog

func _enter_tree() -> void:
	importer = SceneImporter.new()
	inspector = Inspector.new()
	exporter = ExportPlugin.new()
	watcher = DependencyWatcher.new()
	watcher.importer_version = importer._get_format_version()
	add_child(watcher)
	watcher.start()
	importer.imported.connect(watcher.record)
	add_import_plugin(importer)
	add_inspector_plugin(inspector)
	add_export_plugin(exporter)
	file_dialog = EditorFileDialog.new()
	file_dialog.title = "Import Cane animation"
	file_dialog.access = EditorFileDialog.ACCESS_RESOURCES
	file_dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_FILE
	file_dialog.filters = PackedStringArray(["*.json, *.caneb ; Cane Runtime export"])
	file_dialog.file_selected.connect(import_animation)
	get_editor_interface().get_base_control().add_child(file_dialog)
	message = AcceptDialog.new()
	get_editor_interface().get_base_control().add_child(message)
	add_tool_menu_item("Import Cane animation...", func(): file_dialog.popup_centered_ratio(0.65))
	# Runtime compositing needs HDR 2D, including the editor's separate 2D viewport.
	if not ProjectSettings.get_setting("rendering/viewport/hdr_2d", false):
		ProjectSettings.set_setting("rendering/viewport/hdr_2d", true)
		ProjectSettings.save()
	get_editor_interface().get_editor_viewport_2d().use_hdr_2d = true

func import_animation(path: String) -> void:
	var result = ImportService.create_descriptor(path)
	if result.error != OK:
		message.dialog_text = result.message
		message.popup_centered(Vector2i(480, 140))
		return
	get_editor_interface().get_resource_filesystem().scan()
	message.dialog_text = "Importing " + result.path.get_file() + ". Drag this animation from the FileSystem dock into your 2D scene, then choose Animation and Skins in the Inspector."
	message.popup_centered(Vector2i(480, 140))

func _exit_tree() -> void:
	remove_tool_menu_item("Import Cane animation...")
	remove_inspector_plugin(inspector)
	remove_import_plugin(importer)
	remove_export_plugin(exporter)
	# The editor may be shutting down; deferred deletion would miss its final frame.
	if is_instance_valid(file_dialog): file_dialog.free()
	if is_instance_valid(message): message.free()
	if is_instance_valid(watcher): watcher.free()
	inspector = null
	importer = null
	exporter = null
