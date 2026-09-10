#pragma once
#include <cane/error.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <limits>
#include <string>
#include <vector>

namespace cane_godot {
inline std::string text(const godot::String& value) {
    const auto utf8 = value.utf8(); return {utf8.get_data(), static_cast<std::size_t>(utf8.length())};
}
inline godot::String text(const std::string& value) { return godot::String::utf8(value.data(), static_cast<std::int64_t>(value.size())); }
inline void require(bool condition, const char* message, const char* field = nullptr) {
    if (!condition) throw cane::Error(cane::ErrorCode::invalid_argument, "godotAdapter", message,
        field ? std::optional<std::string>(field) : std::nullopt);
}
inline godot::Dictionary error(const std::exception& failure) {
    godot::Dictionary result; result["message"] = godot::String::utf8(failure.what());
    if (const auto* core = dynamic_cast<const cane::Error*>(&failure)) {
        result["code"] = static_cast<std::int64_t>(core->code); result["operation"] = text(core->operation);
        result["field"] = core->field ? godot::Variant(text(*core->field)) : godot::Variant();
        result["entity_id"] = core->entity_id ? godot::Variant(text(*core->entity_id)) : godot::Variant();
    } else { result["code"] = 255; result["operation"] = "godotAdapter"; }
    return result;
}
inline void assign_dictionary(godot::Dictionary& destination, const godot::Dictionary& value) {
    // The pinned godot-cpp 4.5 Dictionary move assignment does not release its old
    // contents. Use its reference-counted copy assignment when replacing a value.
    if (&destination != &value) destination = value;
}
inline void set_error(godot::Dictionary& destination, const std::exception& failure) {
    assign_dictionary(destination, error(failure));
}
inline std::vector<std::string> strings(const godot::PackedStringArray& values) {
    std::vector<std::string> output; output.reserve(static_cast<std::size_t>(values.size()));
    for (std::int64_t i = 0; i < values.size(); ++i) output.push_back(text(values[i]));
    return output;
}
inline std::uint32_t track_index(std::int64_t value) {
    require(value >= 0 && value <= std::numeric_limits<std::uint32_t>::max(), "Track index is out of range.", "track_index");
    return static_cast<std::uint32_t>(value);
}
}
