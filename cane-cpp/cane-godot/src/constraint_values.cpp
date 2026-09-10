#include "constraint_values.hpp"
#include "script_values.hpp"
#include <godot_cpp/variant/packed_float32_array.hpp>

namespace cane_godot {
namespace {
void read(const godot::Dictionary& values, const char* key, std::optional<float>& output) {
    if (values.has(key)) output = number(values[key], key);
}
godot::Variant optional(const std::optional<float>& value) { return value ? godot::Variant(*value) : godot::Variant(); }
godot::Vector2 point(const cane::Point& value) { return {value.x, value.y}; }
godot::Dictionary parameters(const cane::IkConstraintParameters& p) {
    godot::Dictionary r; r["target"] = point(p.target); r["mix"] = p.mix; r["softness"] = p.softness;
    r["bend_positive"] = p.bend_positive; r["compress"] = p.compress; r["stretch"] = p.stretch; return r;
}
godot::Dictionary parameters(const cane::TransformConstraintParameters& p) {
    godot::Dictionary r; r["rotation_degrees"] = p.rotation_degrees; r["x"] = p.x; r["y"] = p.y;
    r["scale_x"] = p.scale_x; r["scale_y"] = p.scale_y; r["shear_y_degrees"] = p.shear_y_degrees;
    r["mix_rotate"] = p.mix_rotate; r["mix_x"] = p.mix_x; r["mix_y"] = p.mix_y;
    r["mix_scale_x"] = p.mix_scale_x; r["mix_scale_y"] = p.mix_scale_y; r["mix_shear_y"] = p.mix_shear_y; return r;
}
godot::Dictionary parameters(const cane::PathConstraintParameters& p) {
    godot::Dictionary r; r["rotation_degrees"] = p.rotation_degrees; r["position"] = p.position; r["spacing"] = p.spacing;
    r["mix_rotate"] = p.mix_rotate; r["mix_x"] = p.mix_x; r["mix_y"] = p.mix_y; return r;
}
godot::Dictionary parameters(const cane::PhysicsConstraintParameters& p) {
    godot::Dictionary r; r["x"] = p.x; r["y"] = p.y; r["rotate"] = p.rotate; r["scale_x"] = p.scale_x;
    r["shear_x"] = p.shear_x; r["limit"] = p.limit; r["fps"] = p.fps; r["inertia"] = p.inertia;
    r["strength"] = p.strength; r["damping"] = p.damping; r["mass"] = p.mass;
    r["wind"] = p.wind; r["gravity"] = p.gravity; r["mix"] = p.mix; return r;
}
godot::Dictionary parameters(const cane::SliderConstraintParameters& p) {
    godot::Dictionary r; r["source_offset"] = p.source_offset; r["time_offset"] = p.time_offset; r["time_scale"] = p.time_scale;
    r["range_max"] = p.range_max; r["time"] = p.time; r["mix"] = p.mix; return r;
}
godot::Variant diagnostic(const std::monostate&) { return {}; }
godot::Variant diagnostic(const cane::IkConstraintDiagnostic& p) {
    godot::Dictionary r; r["residual"] = p.residual; r["threshold"] = p.threshold; r["mix"] = p.mix;
    r["iterations_used"] = p.iterations_used; r["iteration_limit"] = p.iteration_limit; r["saturated"] = p.saturated; return r;
}
godot::Variant diagnostic(const cane::TransformConstraintDiagnostic& p) {
    godot::Dictionary r; r["driven_bone_count"] = p.driven_bone_count;
    godot::PackedFloat32Array mixes; for (const auto value : p.mixes) mixes.push_back(value); r["mixes"] = mixes;
    r["translation_residual"] = optional(p.translation_residual); r["rotation_residual"] = optional(p.rotation_residual);
    r["scale_residual"] = optional(p.scale_residual); r["shear_residual"] = optional(p.shear_residual); return r;
}
godot::Variant diagnostic(const cane::PathConstraintDiagnostic& p) {
    godot::Dictionary r; r["driven_bone_count"] = p.driven_bone_count; r["mix_rotate"] = p.mix_rotate; r["mix_x"] = p.mix_x; r["mix_y"] = p.mix_y;
    r["translation_residual"] = optional(p.translation_residual); r["rotation_residual"] = optional(p.rotation_residual); r["scale_residual"] = optional(p.scale_residual); return r;
}
godot::Variant diagnostic(const cane::PhysicsConstraintDiagnostic& p) {
    godot::Dictionary r; r["fixed_steps"] = p.fixed_steps; r["translation_offset"] = p.translation_offset; r["translation_speed"] = p.translation_speed;
    r["rotation_offset_degrees"] = p.rotation_offset_degrees; r["angular_speed_degrees"] = p.angular_speed_degrees;
    r["scale_offset"] = p.scale_offset; r["scale_speed"] = p.scale_speed; r["configured_limit"] = p.configured_limit;
    r["required_limit"] = optional(p.required_limit); r["limit_saturated"] = p.limit_saturated; return r;
}
godot::Variant diagnostic(const cane::SliderConstraintDiagnostic& p) {
    godot::Dictionary r; r["source_value"] = optional(p.source_value); r["mapped_time"] = p.mapped_time; r["resolved_time"] = p.resolved_time;
    r["duration"] = p.duration; r["wrapped"] = p.wrapped; r["clamped"] = p.clamped; return r;
}
}
cane::Point core_point(const godot::Vector2& value, const char* field) { return {scalar(value.x, field), scalar(value.y, field)}; }
cane::ConstraintOverride constraint_override(const godot::String& kind, const godot::Dictionary& v) {
    const auto name = text(kind);
    if (name == "ik") {
        fields(v, {"target", "mix", "softness", "bend_positive", "compress", "stretch"}); cane::IkConstraintOverride r;
        if (v.has("target")) {
            require(v["target"].get_type() == godot::Variant::VECTOR2, "Expected a Core-space Vector2.", "target");
            r.target = core_point(v["target"], "target");
        }
        read(v, "mix", r.mix); read(v, "softness", r.softness);
        if (v.has("bend_positive")) r.bend_positive = boolean(v["bend_positive"], "bend_positive");
        if (v.has("compress")) r.compress = boolean(v["compress"], "compress");
        if (v.has("stretch")) r.stretch = boolean(v["stretch"], "stretch");
        return r;
    }
    if (name == "transform") {
        fields(v, {"rotation_degrees", "x", "y", "scale_x", "scale_y", "shear_y_degrees", "mix_rotate", "mix_x", "mix_y", "mix_scale_x", "mix_scale_y", "mix_shear_y"});
        cane::TransformConstraintOverride r; read(v, "rotation_degrees", r.rotation_degrees); read(v, "x", r.x); read(v, "y", r.y);
        read(v, "scale_x", r.scale_x); read(v, "scale_y", r.scale_y); read(v, "shear_y_degrees", r.shear_y_degrees);
        read(v, "mix_rotate", r.mix_rotate); read(v, "mix_x", r.mix_x); read(v, "mix_y", r.mix_y);
        read(v, "mix_scale_x", r.mix_scale_x); read(v, "mix_scale_y", r.mix_scale_y); read(v, "mix_shear_y", r.mix_shear_y); return r;
    }
    if (name == "path") {
        fields(v, {"rotation_degrees", "position", "spacing", "mix_rotate", "mix_x", "mix_y"}); cane::PathConstraintOverride r;
        read(v, "rotation_degrees", r.rotation_degrees); read(v, "position", r.position); read(v, "spacing", r.spacing);
        read(v, "mix_rotate", r.mix_rotate); read(v, "mix_x", r.mix_x); read(v, "mix_y", r.mix_y); return r;
    }
    if (name == "physics") {
        fields(v, {"x", "y", "rotate", "scale_x", "shear_x", "limit", "fps", "inertia", "strength", "damping", "mass", "wind", "gravity", "mix"});
        cane::PhysicsConstraintOverride r; read(v, "x", r.x); read(v, "y", r.y); read(v, "rotate", r.rotate);
        read(v, "scale_x", r.scale_x); read(v, "shear_x", r.shear_x); read(v, "limit", r.limit);
        if (v.has("fps")) {
            require(v["fps"].get_type() == godot::Variant::INT, "Host Physics fps must be an integer.", "fps");
            const auto fps = static_cast<std::int64_t>(v["fps"]);
            require(fps > 0 && static_cast<std::uint64_t>(fps) <= std::numeric_limits<std::uint32_t>::max(), "Host Physics fps must fit a positive u32.", "fps");
            r.fps = static_cast<std::uint32_t>(fps);
        }
        read(v, "inertia", r.inertia); read(v, "strength", r.strength); read(v, "damping", r.damping); read(v, "mass", r.mass);
        read(v, "wind", r.wind); read(v, "gravity", r.gravity); read(v, "mix", r.mix); return r;
    }
    if (name == "slider") {
        fields(v, {"source_offset", "time_offset", "time_scale", "range_max", "time", "mix"}); cane::SliderConstraintOverride r;
        read(v, "source_offset", r.source_offset); read(v, "time_offset", r.time_offset); read(v, "time_scale", r.time_scale);
        read(v, "range_max", r.range_max); read(v, "time", r.time); read(v, "mix", r.mix); return r;
    }
    require(false, "Unknown constraint kind.", "kind"); return cane::IkConstraintOverride{};
}
godot::Dictionary constraint_value(const cane::ConstraintState& state) {
    constexpr const char* kinds[]{"ik", "transform", "path", "physics", "slider"};
    godot::Dictionary r; r["constraint_id"] = text(state.constraint_id); r["kind"] = kinds[static_cast<std::size_t>(state.kind)];
    r["sampled_parameters"] = std::visit([](const auto& value) { return parameters(value); }, state.sampled_parameters);
    r["sampled_slider_time_seconds"] = optional(state.sampled_slider_time_seconds);
    r["diagnostic"] = std::visit([](const auto& value) { return diagnostic(value); }, state.diagnostic); return r;
}
}
