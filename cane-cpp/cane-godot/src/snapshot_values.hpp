#pragma once
#include <cane/authoring_snapshot.hpp>
#include <godot_cpp/variant/dictionary.hpp>

namespace cane_godot {
godot::Dictionary slot_snapshot_value(const cane::SlotState& state);
godot::Dictionary authoring_snapshot_value(const cane::AuthoringSnapshot& snapshot);
}
