#pragma once
#include "bridge.hpp"
#include <algorithm>
#include <cmath>
#include <initializer_list>

namespace cane_godot {
inline float scalar(double value, const char* field) {
    require(std::isfinite(value) && std::abs(value) <= std::numeric_limits<float>::max(),
        "Expected a finite number representable by Core.", field);
    return static_cast<float>(value);
}
inline float number(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::INT || value.get_type() == godot::Variant::FLOAT,
        "Expected a number.", field);
    return scalar(static_cast<double>(value), field);
}
inline bool boolean(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::BOOL, "Expected a bool.", field);
    return static_cast<bool>(value);
}
inline std::string option_key(const godot::Variant& key) {
    require(key.get_type() == godot::Variant::STRING || key.get_type() == godot::Variant::STRING_NAME,
        "Expected a String or StringName.", "options");
    return text(static_cast<godot::String>(key));
}
inline void fields(const godot::Dictionary& values, std::initializer_list<const char*> allowed) {
    const auto keys = values.keys();
    for (std::int64_t i = 0; i < keys.size(); ++i) {
        const auto key = option_key(keys[i]);
        require(std::any_of(allowed.begin(), allowed.end(), [&](const char* name) { return key == name; }),
            "Unknown field.", key.c_str());
    }
}
inline godot::Dictionary dictionary(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::DICTIONARY, "Expected a Dictionary.", field);
    return value;
}
inline std::optional<std::string> optional_string(const godot::Variant& value, const char* field) {
    if (value.get_type() == godot::Variant::NIL) return {};
    require(value.get_type() == godot::Variant::STRING || value.get_type() == godot::Variant::STRING_NAME,
        "Expected a String, StringName or null.", field);
    return text(static_cast<godot::String>(value));
}
}
