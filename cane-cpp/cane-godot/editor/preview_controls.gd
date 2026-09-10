@tool
extends VBoxContainer

var target: WeakRef
var play_button = Button.new()
var reset_button = Button.new()
var time = HSlider.new()
var status = Label.new()
var elapsed: float = 0.0

func setup(node: CaneSkeleton) -> void:
	target = weakref(node)
	var row = HBoxContainer.new()
	add_child(row)
	play_button.text = "Play preview"
	reset_button.text = "Reset"
	row.add_child(play_button)
	row.add_child(reset_button)
	add_child(time)
	add_child(status)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	time.step = 0.001
	play_button.pressed.connect(toggle_preview)
	reset_button.pressed.connect(reset_preview)
	time.value_changed.connect(scrub)
	update_controls()

func skeleton() -> CaneSkeleton:
	return target.get_ref() if target != null else null

func toggle_preview() -> void:
	var node = skeleton()
	if node == null: return
	if not node.editor_preview and ended(node.get_track_state()):
		node.sample_at(0.0)
	node.editor_preview = not node.editor_preview
	update_controls()

func ended(track: Dictionary) -> bool:
	return not track.is_empty() and not track.get("looping", true) and track.get("animation_time", 0.0) >= track.get("animation_end", 0.0)

func reset_preview() -> void:
	var node = skeleton()
	if node == null: return
	node.editor_preview = false
	if node.initial_animation.is_empty(): node.reset()
	else: node.sample_at(0.0)
	update_controls()

func scrub(seconds: float) -> void:
	var node = skeleton()
	if node == null: return
	node.editor_preview = false
	node.sample_at(seconds)
	update_controls()

func update_controls() -> void:
	var node = skeleton()
	if node == null: return
	var track = node.get_track_state()
	var has_animation = not track.is_empty()
	if node.editor_preview and ended(track):
		node.editor_preview = false
	play_button.disabled = not has_animation
	time.editable = has_animation
	play_button.text = "Pause preview" if node.editor_preview else "Play preview"
	if has_animation:
		time.max_value = maxf(0.001, track.get("animation_end", 1.0))
		time.set_value_no_signal(track.get("animation_time", 0.0))
	var failure = node.get_last_error()
	status.text = str(failure) if not failure.is_empty() else ("%.3f s" % time.value if has_animation else "Choose an animation to preview.")

func _process(delta: float) -> void:
	elapsed += delta
	if elapsed >= 0.1:
		elapsed = 0.0
		update_controls()

func _exit_tree() -> void:
	var node = skeleton()
	if node != null: node.editor_preview = false
