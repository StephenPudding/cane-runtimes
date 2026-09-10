#pragma once
#include <cane/runtime_player.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>

namespace cane_godot {
cane::PoseModifiers pose_modifiers(const godot::Array& operations);
cane::SamplingOptions sampling_options(const godot::Dictionary& options);
}
