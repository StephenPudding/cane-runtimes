#pragma once
#include <cane/constraint_state.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/vector2.hpp>

namespace cane_godot {
cane::ConstraintOverride constraint_override(const godot::String& kind, const godot::Dictionary& parameters);
cane::Point core_point(const godot::Vector2& value, const char* field);
godot::Dictionary constraint_value(const cane::ConstraintState& state);
}
