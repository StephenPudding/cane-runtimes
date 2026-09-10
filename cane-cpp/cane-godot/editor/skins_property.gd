@tool
extends EditorProperty

var panel = VBoxContainer.new()
var active = ItemList.new()
var catalog = OptionButton.new()
var add_button = Button.new()
var up_button = Button.new()
var down_button = Button.new()
var remove_button = Button.new()
var ids: PackedStringArray = []
var value: PackedStringArray = []
var available: PackedStringArray = []
var editor_locked: bool = false

func _init() -> void:
	add_child(panel)
	set_bottom_editor(panel)
	active.custom_minimum_size.y = 88
	panel.add_child(active)
	var order = HBoxContainer.new()
	panel.add_child(order)
	up_button.text = "Up"
	down_button.text = "Down"
	remove_button.text = "Remove"
	for button in [up_button, down_button, remove_button]:
		order.add_child(button)
		add_focusable(button)
	var add_row = HBoxContainer.new()
	panel.add_child(add_row)
	catalog.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_row.add_child(catalog)
	add_button.text = "Add skin"
	add_row.add_child(add_button)
	add_focusable(catalog)
	add_focusable(add_button)
	add_button.pressed.connect(add_skin)
	up_button.pressed.connect(move_skin.bind(-1))
	down_button.pressed.connect(move_skin.bind(1))
	remove_button.pressed.connect(remove_skin)
	active.item_selected.connect(func(_index): update_buttons())
	tooltip_text = "Skins combine in this order. Later skins override earlier attachments."
	update_buttons()

func publish(next: PackedStringArray) -> void:
	emit_changed(get_edited_property(), next)

func add_skin() -> void:
	if catalog.selected < 0 or catalog.selected >= available.size(): return
	var next = value.duplicate()
	next.append(available[catalog.selected])
	publish(next)

func move_skin(direction: int) -> void:
	var selection = active.get_selected_items()
	if selection.is_empty(): return
	var index = selection[0]
	if index + direction < 0 or index + direction >= value.size(): return
	var next = value.duplicate()
	var previous = next[index]
	next[index] = next[index + direction]
	next[index + direction] = previous
	publish(next)

func remove_skin() -> void:
	var selection = active.get_selected_items()
	if selection.is_empty(): return
	var next = value.duplicate()
	next.remove_at(selection[0])
	publish(next)

func update_buttons() -> void:
	var selection = active.get_selected_items()
	var index: int = -1 if selection.is_empty() else selection[0]
	up_button.disabled = editor_locked or index <= 0
	down_button.disabled = editor_locked or index < 0 or index + 1 >= value.size()
	remove_button.disabled = editor_locked or index < 0
	add_button.disabled = editor_locked or available.is_empty()
	catalog.disabled = editor_locked or available.is_empty()

func _update_property() -> void:
	var node = get_edited_object() as CaneSkeleton
	if not is_instance_valid(node): return
	var next_ids: PackedStringArray = []
	if node.skeleton_data != null: next_ids = node.skeleton_data.get_skin_ids()
	var next_value: PackedStringArray = node.get(get_edited_property())
	if ids == next_ids and value == next_value: return
	ids = next_ids
	value = next_value
	active.clear()
	for id in value: active.add_item(id if id in ids else "Missing: " + id)
	available = PackedStringArray()
	catalog.clear()
	for id in ids:
		if id not in value:
			available.append(id)
			catalog.add_item(id)
	update_buttons()

func _set_read_only(enabled: bool) -> void:
	editor_locked = enabled
	update_buttons()
