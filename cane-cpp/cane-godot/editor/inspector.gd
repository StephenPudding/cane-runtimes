@tool
extends EditorInspectorPlugin

const AnimationProperty = preload("animation_property.gd")
const SkinsProperty = preload("skins_property.gd")
const PreviewControls = preload("preview_controls.gd")

func _can_handle(object: Object) -> bool:
	return object is CaneSkeleton

func _parse_begin(object: Object) -> void:
	var controls = PreviewControls.new()
	controls.setup(object)
	add_custom_control(controls)

func _parse_property(_object: Object, _type: Variant.Type, name: String, _hint: PropertyHint, _hint_string: String, _usage: int, _wide: bool) -> bool:
	if name == "initial_animation":
		add_property_editor(name, AnimationProperty.new(), false, "Animation")
		return true
	if name == "initial_skins":
		add_property_editor(name, SkinsProperty.new(), false, "Skins (in order)")
		return true
	return name == "editor_preview"
