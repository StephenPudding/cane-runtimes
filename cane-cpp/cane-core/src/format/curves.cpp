#include "curves.hpp"
#include "cane/error.hpp"
#include <algorithm>
#include <array>
#include <cmath>

namespace cane::format {
namespace {
[[noreturn]] void fail(const std::string& path, const char* message) {
    throw Error(ErrorCode::validation_failed, "loadJson", message, path);
}
const Json& member(const Json& source, std::string_view key) {
    static const Json absent;
    const auto found = source.find(std::string(key));
    return found == source.end() ? absent : *found;
}
float scalar(const Json& value, const std::string& path) {
    if (!value.is_number()) fail(path, "Expected a finite number.");
    const auto number = value.get<float>();
    if (!std::isfinite(number)) fail(path, "Value is outside finite binary32 range.");
    return number;
}
void closed(const Json& value, const std::string& path, std::initializer_list<std::string_view> allowed) {
    if (!value.is_object()) fail(path, "Curve must be an object or a supported literal.");
    for (const auto& item : value.items())
        if (std::find(allowed.begin(), allowed.end(), item.key()) == allowed.end()) fail(path + '.' + item.key(), "Unknown curve member.");
}
animation::Curve simple(const Json& value, const std::string& path) {
    using animation::Curve; using animation::CurveKind;
    if (value.is_null() || value == "linear") return {};
    if (value == "stepped") return Curve(CurveKind::stepped);
    const auto& type = member(value, "type");
    const bool percent = type == "bezier";
    if (!percent && type != "bezier-value") fail(path, "Unknown or nested curve type.");
    const auto* y1 = percent ? "cy1" : "dy1"; const auto* y2 = percent ? "cy2" : "dy2";
    closed(value, path, {"type", "cx1", y1, "cx2", y2});
    return Curve(percent ? CurveKind::bezier : CurveKind::bezier_value,
        scalar(member(value, "cx1"), path + ".cx1"), scalar(member(value, y1), path + '.' + y1),
        scalar(member(value, "cx2"), path + ".cx2"), scalar(member(value, y2), path + '.' + y2));
}
}
animation::PropertyCurves parse_curve(const Json& source, const std::string& path) {
    animation::PropertyCurves result;
    if (!source.is_object() || member(source, "type") != "properties") { result.default_curve = simple(source, path); return result; }
    closed(source, path, {"type", "default", "properties"});
    result.default_curve = simple(member(source, "default"), path + ".default");
    const auto& properties = member(source, "properties");
    if (!properties.is_object() || properties.empty()) fail(path + ".properties", "Property bundle needs at least one canonical property.");
    static constexpr std::string_view vocabulary[]{
        "x", "y", "rotation", "scale_x", "scale_y", "color_r", "color_g", "color_b", "dark_r", "dark_g", "dark_b", "alpha",
        "target_x", "target_y", "mix", "softness", "mix_rotate", "mix_x", "mix_y", "mix_scale_x", "mix_scale_y", "mix_shear_y",
        "position", "spacing", "inertia", "strength", "damping", "mass", "wind", "gravity", "slider_time"
    };
    for (const auto& item : properties.items()) {
        if (std::find(std::begin(vocabulary), std::end(vocabulary), item.key()) == std::end(vocabulary)) fail(path + ".properties." + item.key(), "Unknown curve property spelling.");
        result.properties.emplace(item.key(), simple(item.value(), path + ".properties." + item.key()));
    }
    return result;
}
animation::ScalarChannel scalar_channel(const Json& source, std::string_view field, std::string_view property, bool sparse) {
    if (source.is_null()) return animation::ScalarChannel();
    if (!source.is_array()) fail("keys", "Channel keys must be an array or null.");
    std::vector<animation::ScalarKey> keys; keys.reserve(source.size());
    float previous = -1;
    for (const auto& key : source) {
        if (!key.is_object()) fail("keys", "Key must be an object.");
        const auto time = scalar(member(key, "time"), "keys.time");
        if (time < 0 || time < previous) fail("keys.time", "Key times must be ordered and non-negative.");
        previous = time;
        const auto curves = parse_curve(member(key, "curve"), "keys.curve");
        // Sparse keys never invent a setup/zero contribution. A supplied null is not a number.
        if (sparse && !key.contains(std::string(field))) continue;
        keys.push_back({time, scalar(member(key, field), "keys." + std::string(field)), curves.select(property)});
    }
    return animation::ScalarChannel(std::move(keys));
}
}
