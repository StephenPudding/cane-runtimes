#pragma once
#include "script_values.hpp"
#include <cane/vertex_geometry.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_float64_array.hpp>

namespace cane_godot {
inline cane::VertexDeformSpace vertex_space(const godot::String& value) {
    const auto name = text(value);
    if (name == "vertex_positions") return cane::VertexDeformSpace::vertex_positions;
    if (name == "weighted_influence_offsets") return cane::VertexDeformSpace::weighted_influence_offsets;
    require(false, "Unknown vertex deform space.", "deform_space"); return {};
}
inline const char* vertex_space_name(cane::VertexDeformSpace value) {
    return value == cane::VertexDeformSpace::vertex_positions ? "vertex_positions" : "weighted_influence_offsets";
}
inline std::uint32_t source_vertex_index(const godot::Variant& value) {
    require(value.get_type() == godot::Variant::INT, "Source vertex index must be an integer.", "source_vertex_index");
    const auto index = static_cast<std::int64_t>(value);
    require(index >= 0 && index <= std::numeric_limits<std::uint32_t>::max(), "Source vertex index is outside Core's range.", "source_vertex_index");
    return static_cast<std::uint32_t>(index);
}
inline std::vector<float> vertex_buffer(const godot::Variant& value, const char* field) {
    std::vector<float> result;
    if (value.get_type() == godot::Variant::ARRAY) {
        const godot::Array values = value; result.reserve(static_cast<std::size_t>(values.size()));
        for (std::int64_t i = 0; i < values.size(); ++i) result.push_back(number(values[i], field));
    } else if (value.get_type() == godot::Variant::PACKED_FLOAT32_ARRAY) {
        const godot::PackedFloat32Array values = value; result.reserve(static_cast<std::size_t>(values.size()));
        for (std::int64_t i = 0; i < values.size(); ++i) result.push_back(scalar(values[i], field));
    } else if (value.get_type() == godot::Variant::PACKED_FLOAT64_ARRAY) {
        const godot::PackedFloat64Array values = value; result.reserve(static_cast<std::size_t>(values.size()));
        for (std::int64_t i = 0; i < values.size(); ++i) result.push_back(scalar(values[i], field));
    } else require(false, "Expected an Array of numbers, PackedFloat32Array or PackedFloat64Array.", field);
    return result;
}
inline godot::PackedFloat32Array vertex_buffer_value(const std::vector<float>& values) {
    godot::PackedFloat32Array result; result.resize(static_cast<std::int64_t>(values.size()));
    std::copy(values.begin(), values.end(), result.ptrw()); return result;
}
}
