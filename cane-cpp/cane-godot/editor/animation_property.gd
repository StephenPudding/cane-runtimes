@tool
extends EditorProperty

var choices = OptionButton.new()
var ids: PackedStringArray = []
var current_ids: PackedStringArray = []
var current_value: String = "\u0001"

func _init() -> void:
	add_child(choices)
	add_focusable(choices)
	choices.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	choices.item_selected.connect(func(index): emit_changed(get_edited_property(), ids[index]))

func _update_property() -> void:
	var node = get_edited_object() as CaneSkeleton
	if not is_instance_valid(node):
		return
	var catalog: PackedStringArray = []
	if node.skeleton_data != null:
		catalog = node.skeleton_data.get_animation_ids()
	var value: String = node.get(get_edited_property())
	if catalog == current_ids and value == current_value:
		return
	current_ids = catalog
	current_value = value
	choices.clear()
	ids = PackedStringArray([""])
	choices.add_item("Setup pose")
	for id in catalog:
		ids.append(id)
		choices.add_item(id)
	if value not in ids:
		ids.append(value)
		choices.add_item("Missing: " + value)
	choices.select(ids.find(value))

func _set_read_only(value: bool) -> void:
	choices.disabled = value
