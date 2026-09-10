#pragma once
#include <cane/render_packet.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>

namespace cane_godot {
std::array<std::uint8_t, 3> rgb_value(const godot::Variant& value);
godot::PackedByteArray rgb_bytes(const std::array<std::uint8_t, 3>& rgb);
godot::Dictionary tint_value(const cane::FinalTint& tint);
cane::FinalTint tint_input(const godot::Dictionary& values);
}
