#include "skeleton.hpp"
#include "modifier_values.hpp"
#include "constraint_values.hpp"
#include "script_values.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
namespace {
std::string required_string(const godot::Dictionary& item, const char* key) {
    require(item.has(key), "Modifier field is missing.", key);
    const auto value = optional_string(item[key], key);
    require(value.has_value(), "Modifier field cannot be null.", key);
    return *value;
}
godot::Dictionary required_dictionary(const godot::Dictionary& item, const char* key) {
    require(item.has(key), "Modifier field is missing.", key);
    return dictionary(item[key], key);
}
template<class Local> Local local_channels(const godot::Dictionary& values) {
    fields(values, {"x", "y", "rotation_degrees", "scale_x", "scale_y", "shear_x_degrees", "shear_y_degrees"});
    Local result;
    const auto get = [&](const char* key, auto& out) { if (values.has(key)) out = number(values[key], key); };
    get("x", result.x); get("y", result.y); get("rotation_degrees", result.rotation_degrees);
    get("scale_x", result.scale_x); get("scale_y", result.scale_y);
    get("shear_x_degrees", result.shear_x_degrees); get("shear_y_degrees", result.shear_y_degrees);
    return result;
}
cane::BoneLocalAdditive additive_channels(const godot::Dictionary& values) {
    fields(values, {"x_delta", "y_delta", "rotation_degrees_delta", "scale_x_delta", "scale_y_delta", "shear_x_degrees_delta", "shear_y_degrees_delta"});
    cane::BoneLocalAdditive result;
    const auto get = [&](const char* key, auto& out) { if (values.has(key)) out = number(values[key], key); };
    get("x_delta", result.x_delta); get("y_delta", result.y_delta); get("rotation_degrees_delta", result.rotation_degrees_delta);
    get("scale_x_delta", result.scale_x_delta); get("scale_y_delta", result.scale_y_delta);
    get("shear_x_degrees_delta", result.shear_x_degrees_delta); get("shear_y_degrees_delta", result.shear_y_degrees_delta);
    return result;
}
}
cane::PoseModifiers pose_modifiers(const godot::Array& operations) {
    if (operations.size() > 1000000) throw cane::Error(cane::ErrorCode::resource_limit, "godotAdapter", "Modifier batch exceeds Core's operation limit.", "operations");
    cane::PoseModifiers result; result.operations.reserve(static_cast<std::size_t>(operations.size()));
    for (std::int64_t i = 0; i < operations.size(); ++i) {
        try {
            const auto item = dictionary(operations[i], "operation");
            const auto op = required_string(item, "op");
            if (op == "replace_bone") {
                fields(item, {"op", "bone_id", "local"});
                result.operations.push_back(cane::ReplaceBoneLocal{required_string(item, "bone_id"),
                    local_channels<cane::BoneLocal>(required_dictionary(item, "local"))});
            } else if (op == "patch_bone") {
                fields(item, {"op", "bone_id", "patch"});
                result.operations.push_back(cane::PatchBoneLocal{required_string(item, "bone_id"),
                    local_channels<cane::BoneLocalPatch>(required_dictionary(item, "patch"))});
            } else if (op == "add_bone") {
                fields(item, {"op", "bone_id", "delta"});
                result.operations.push_back(cane::AddBoneLocal{required_string(item, "bone_id"),
                    additive_channels(required_dictionary(item, "delta"))});
            } else if (op == "patch_constraint") {
                fields(item, {"op", "constraint_id", "kind", "parameters"});
                result.operations.push_back(cane::PatchConstraint{required_string(item, "constraint_id"),
                    constraint_override(text(required_string(item, "kind")), required_dictionary(item, "parameters"))});
            } else require(false, "Unknown transient pose operation.", "op");
        } catch (const cane::Error& failure) {
            auto field = "operations[" + std::to_string(i) + "]";
            if (failure.field) field += "." + *failure.field;
            throw cane::Error(failure.code, failure.operation, failure.what(), field, failure.entity_id, failure.detail);
        }
    }
    return result;
}
cane::SamplingOptions sampling_options(const godot::Dictionary& options) {
    fields(options, {"frame_step_seconds", "stepped"});
    cane::SamplingOptions result;
    if (options.has("frame_step_seconds") && options["frame_step_seconds"].get_type() != godot::Variant::NIL)
        result.frame_step_seconds = number(options["frame_step_seconds"], "frame_step_seconds");
    if (options.has("stepped")) result.stepped = boolean(options["stepped"], "stepped");
    return result;
}
void CaneSkeleton::bind_modifier_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("apply_with_modifiers", "operations", "sampling"), &CaneSkeleton::apply_with_modifiers, DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("advance_with_modifiers", "delta_seconds", "operations", "sampling"), &CaneSkeleton::advance_with_modifiers, DEFVAL(godot::Dictionary()));
}
bool CaneSkeleton::apply_with_modifiers(const godot::Array& operations, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& player) {
        const auto modifiers = pose_modifiers(operations); const auto options = sampling_options(sampling);
        (void)player.apply_with_modifiers(modifiers, options);
    }, false);
}
bool CaneSkeleton::advance_with_modifiers(double delta, const godot::Array& operations, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& player) {
        const auto modifiers = pose_modifiers(operations); const auto options = sampling_options(sampling);
        (void)player.advance_with_modifiers(scalar(delta, "delta_seconds"), modifiers, options);
    }, false);
}
}
