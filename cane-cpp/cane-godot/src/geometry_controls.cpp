#include "skeleton.hpp"
#include "geometry_editor.hpp"
#include "modifier_values.hpp"
#include "script_values.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
namespace {
double real(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::INT || value.get_type() == godot::Variant::FLOAT, "Expected a number.", field);
    const auto result = static_cast<double>(value); require(std::isfinite(result), "Expected a finite number.", field); return result;
}
std::vector<std::string> ids(const godot::Variant& value, const char* field) {
    if (value.get_type() == godot::Variant::PACKED_STRING_ARRAY) return strings(value);
    require(value.get_type() == godot::Variant::ARRAY, "Expected Array or PackedStringArray of IDs.", field);
    const godot::Array list = value; std::vector<std::string> result; result.reserve(static_cast<std::size_t>(list.size()));
    for (std::int64_t i = 0; i < list.size(); ++i) {
        const auto id = optional_string(list[i], field); require(id.has_value(), "Filter IDs cannot be null.", field); result.push_back(*id);
    }
    return result;
}
cane::GeometryModifiers modifiers(const godot::Array& operations, std::uint64_t owner) {
    if (operations.size() > 1000000) throw cane::Error(cane::ErrorCode::resource_limit, "godotAdapter", "Geometry batch exceeds Core's operation limit.", "operations");
    cane::GeometryModifiers result; result.operations.reserve(static_cast<std::size_t>(operations.size()));
    for (std::int64_t i = 0; i < operations.size(); ++i) {
        try {
            const auto item = dictionary(operations[i], "operation");
            require(item.has("kind"), "Geometry operation needs a kind.", "kind");
            const auto name = optional_string(item["kind"], "kind"); require(name.has_value(), "Geometry kind cannot be null.", "kind");
            cane::GeometryModifier operation;
            if (*name == "custom") {
                fields(item, {"kind", "callback", "attachment_ids", "slot_ids"});
                require(item.has("callback") && item["callback"].get_type() == godot::Variant::CALLABLE, "Custom modifier needs a Callable.", "callback");
                const godot::Callable callback = item["callback"]; require(callback.is_valid(), "Custom modifier callback is invalid.", "callback");
                operation.effect = cane::CustomGeometryModifier{ScriptGeometryCallback{callback, owner}};
            } else {
                fields(item, {"kind", "parameters", "attachment_ids", "slot_ids"});
                const auto values = item.has("parameters") ? dictionary(item["parameters"], "parameters") : godot::Dictionary();
                const auto get = [&](const char* key, double& out) { if (values.has(key)) out = real(values[key], key); };
                if (*name == "jitter") {
                    fields(values, {"seed", "amplitude_x", "amplitude_y", "frequency_hz"});
                    cane::DeterministicJitter jitter;
                    if (values.has("seed")) {
                        require(values["seed"].get_type() == godot::Variant::INT, "Seed must be an integer.", "seed");
                        const auto seed = static_cast<std::int64_t>(values["seed"]);
                        require(seed >= 0 && seed <= std::numeric_limits<std::uint32_t>::max(), "Seed is outside uint32.", "seed");
                        jitter.seed = static_cast<std::uint32_t>(seed);
                    }
                    get("amplitude_x", jitter.amplitude_x); get("amplitude_y", jitter.amplitude_y); get("frequency_hz", jitter.frequency_hz);
                    operation.effect = jitter;
                } else if (*name == "radial_wave") {
                    fields(values, {"center_x", "center_y", "radial_amplitude", "angular_amplitude_degrees", "wavelength", "phase_degrees", "speed_hz", "radius"});
                    cane::RadialWave wave;
                    get("center_x", wave.center_x); get("center_y", wave.center_y); get("radial_amplitude", wave.radial_amplitude);
                    get("angular_amplitude_degrees", wave.angular_amplitude_degrees); get("wavelength", wave.wavelength);
                    get("phase_degrees", wave.phase_degrees); get("speed_hz", wave.speed_hz); get("radius", wave.radius); operation.effect = wave;
                } else require(false, "Unknown geometry modifier kind.", "kind");
            }
            if (item.has("attachment_ids")) operation.filter.attachment_ids = ids(item["attachment_ids"], "attachment_ids");
            if (item.has("slot_ids")) operation.filter.slot_ids = ids(item["slot_ids"], "slot_ids");
            result.operations.push_back(std::move(operation));
        } catch (const cane::Error& failure) {
            auto field = "geometry_operations[" + std::to_string(i) + "]";
            if (failure.field) field += "." + *failure.field;
            throw cane::Error(failure.code, failure.operation, failure.what(), field, failure.entity_id, failure.detail);
        }
    }
    return result;
}
godot::PackedStringArray filter_value(const std::vector<std::string>& ids) {
    godot::PackedStringArray result; for (const auto& id : ids) result.push_back(text(id)); return result;
}
godot::Dictionary effect_value(const cane::DeterministicJitter& jitter) {
    godot::Dictionary result, p; result["kind"] = "jitter";
    p["seed"] = jitter.seed; p["amplitude_x"] = jitter.amplitude_x; p["amplitude_y"] = jitter.amplitude_y;
    p["frequency_hz"] = jitter.frequency_hz; result["parameters"] = p; return result;
}
godot::Dictionary effect_value(const cane::RadialWave& wave) {
    godot::Dictionary result, p; result["kind"] = "radial_wave";
    p["center_x"] = wave.center_x; p["center_y"] = wave.center_y; p["radial_amplitude"] = wave.radial_amplitude;
    p["angular_amplitude_degrees"] = wave.angular_amplitude_degrees; p["wavelength"] = wave.wavelength;
    p["phase_degrees"] = wave.phase_degrees; p["speed_hz"] = wave.speed_hz; p["radius"] = wave.radius;
    result["parameters"] = p; return result;
}
godot::Dictionary effect_value(const cane::CustomGeometryModifier& custom) {
    const auto* value = custom.apply.target<ScriptGeometryCallback>();
    require(value != nullptr, "Native C++ callback has no GDScript Callable representation.", "callback");
    godot::Dictionary result; result["kind"] = "custom"; result["callback"] = value->callback; return result;
}
}
void CaneSkeleton::bind_geometry_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_geometry_modifiers", "operations"), &CaneSkeleton::set_geometry_modifiers);
    ClassDB::bind_method(D_METHOD("clear_geometry_modifiers"), &CaneSkeleton::clear_geometry_modifiers);
    ClassDB::bind_method(D_METHOD("get_geometry_modifiers"), &CaneSkeleton::get_geometry_modifiers);
    ClassDB::bind_method(D_METHOD("get_geometry_modifier_stats"), &CaneSkeleton::get_geometry_modifier_stats);
    ClassDB::bind_method(D_METHOD("apply_with_geometry_modifiers", "operations", "sampling"), &CaneSkeleton::apply_with_geometry_modifiers, DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("advance_with_geometry_modifiers", "delta_seconds", "operations", "sampling"), &CaneSkeleton::advance_with_geometry_modifiers, DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("apply_with_frame_modifiers", "pose_operations", "geometry_operations", "sampling"), &CaneSkeleton::apply_with_frame_modifiers, DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("advance_with_frame_modifiers", "delta_seconds", "pose_operations", "geometry_operations", "sampling"), &CaneSkeleton::advance_with_frame_modifiers, DEFVAL(godot::Dictionary()));
}
bool CaneSkeleton::set_geometry_modifiers(const godot::Array& operations) {
    return perform([&](cane::RuntimePlayer& p) { p.set_geometry_modifiers(modifiers(operations, get_instance_id())); }, false);
}
bool CaneSkeleton::clear_geometry_modifiers() { return perform([](cane::RuntimePlayer& p) { p.clear_geometry_modifiers(); }, false); }
godot::Array CaneSkeleton::get_geometry_modifiers() {
    godot::Array result;
    query_player([&](const cane::RuntimePlayer& p) {
        godot::Array candidate;
        for (const auto& operation : p.query_geometry_modifiers().operations) {
            auto value = std::visit([](const auto& effect) { return effect_value(effect); }, operation.effect);
            value["attachment_ids"] = filter_value(operation.filter.attachment_ids); value["slot_ids"] = filter_value(operation.filter.slot_ids);
            candidate.push_back(value);
        }
        result = candidate;
    }); return result;
}
godot::Dictionary CaneSkeleton::get_geometry_modifier_stats() {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto stats = p.last_geometry_modifier_stats();
        result["persistent_operations"] = stats.persistent_operations; result["transient_operations"] = stats.transient_operations;
        result["attachment_visits"] = static_cast<std::int64_t>(stats.attachment_visits); result["vertex_writes"] = static_cast<std::int64_t>(stats.vertex_writes);
        result["uv_writes"] = static_cast<std::int64_t>(stats.uv_writes); result["tint_writes"] = static_cast<std::int64_t>(stats.tint_writes);
    }); return result;
}
bool CaneSkeleton::apply_with_geometry_modifiers(const godot::Array& operations, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.apply_with_geometry_modifiers(modifiers(operations, get_instance_id()), sampling_options(sampling)); }, false);
}
bool CaneSkeleton::advance_with_geometry_modifiers(double delta, const godot::Array& operations, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.advance_with_geometry_modifiers(scalar(delta, "delta_seconds"), modifiers(operations, get_instance_id()), sampling_options(sampling)); }, false);
}
bool CaneSkeleton::apply_with_frame_modifiers(const godot::Array& pose, const godot::Array& geometry, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.apply_with_frame_modifiers(pose_modifiers(pose), modifiers(geometry, get_instance_id()), sampling_options(sampling)); }, false);
}
bool CaneSkeleton::advance_with_frame_modifiers(double delta, const godot::Array& pose, const godot::Array& geometry, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.advance_with_frame_modifiers(scalar(delta, "delta_seconds"), pose_modifiers(pose), modifiers(geometry, get_instance_id()), sampling_options(sampling)); }, false);
}
}
