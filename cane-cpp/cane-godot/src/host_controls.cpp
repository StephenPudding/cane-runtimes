#include "skeleton.hpp"
#include "script_values.hpp"
#include "constraint_values.hpp"
#include "vertex_values.hpp"
#include "color_values.hpp"
#include "modifier_values.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <iterator>

namespace cane_godot {
namespace {
const char* modes[] = {"normal", "only_translation", "no_rotation_or_reflection", "no_scale", "no_scale_or_reflection"};
std::optional<cane::TransformMode> transform_mode(const godot::Variant& value) {
    const auto name = optional_string(value, "transform_mode"); if (!name) return {};
    for (std::size_t i = 0; i < std::size(modes); ++i) if (*name == modes[i]) return static_cast<cane::TransformMode>(i);
    require(false, "Unknown bone transform mode.", "transform_mode"); return {};
}
cane::BoneLocal local_pose(const godot::Dictionary& values, bool bone) {
    if (bone) fields(values, {"x", "y", "rotation_degrees", "scale_x", "scale_y", "shear_x_degrees", "shear_y_degrees"});
    else fields(values, {"x", "y", "rotation_degrees", "scale_x", "scale_y"});
    cane::BoneLocal result;
    const auto get = [&](const char* key, float& target) { if (values.has(key)) target = number(values[key], key); };
    get("x", result.x); get("y", result.y); get("rotation_degrees", result.rotation_degrees);
    get("scale_x", result.scale_x); get("scale_y", result.scale_y);
    if (bone) { get("shear_x_degrees", result.shear_x_degrees); get("shear_y_degrees", result.shear_y_degrees); }
    return result;
}
cane::RegionLocal region_pose(const godot::Dictionary& values) {
    const auto p = local_pose(values, false); return {p.x, p.y, p.rotation_degrees, p.scale_x, p.scale_y};
}
godot::Dictionary local_value(const cane::BoneLocal& local, bool bone) {
    godot::Dictionary result;
    result["x"] = local.x; result["y"] = local.y; result["rotation_degrees"] = local.rotation_degrees;
    result["scale_x"] = local.scale_x; result["scale_y"] = local.scale_y;
    if (bone) { result["shear_x_degrees"] = local.shear_x_degrees; result["shear_y_degrees"] = local.shear_y_degrees; }
    return result;
}
godot::Dictionary region_value(const cane::RegionLocal& local) {
    return local_value({local.x, local.y, local.rotation_degrees, local.scale_x, local.scale_y, 0, 0}, false);
}
cane::PhysicsHostMotion physics_motion(const godot::String& value) {
    const auto name = text(value);
    if (name == "move") return cane::PhysicsHostMotion::move;
    if (name == "teleport") return cane::PhysicsHostMotion::teleport;
    if (name == "preserve_inertia") return cane::PhysicsHostMotion::preserve_inertia;
    if (name == "clear_inertia") return cane::PhysicsHostMotion::clear_inertia;
    require(false, "Unknown Physics host motion.", "physics_motion"); return {};
}
cane::AuthoringOverrides pose_operations(const godot::Array& operations) {
    if (operations.size() > 1000000) throw cane::Error(cane::ErrorCode::resource_limit, "godotAdapter", "Pose batch exceeds Core's operation limit.", "operations");
    cane::AuthoringOverrides result; result.operations.reserve(static_cast<std::size_t>(operations.size()));
    for (std::int64_t i = 0; i < operations.size(); ++i) {
        const auto item = dictionary(operations[i], "operations");
        require(item.has("op"), "Pose operation needs an op.", "op");
        const auto op = option_key(item["op"]);
        if (op == "set_bone" || op == "clear_bone") {
            if (op == "set_bone") fields(item, {"op", "bone_id", "local", "transform_mode"});
            else fields(item, {"op", "bone_id"});
            require(item.has("bone_id"), "Pose operation needs a bone_id.", "bone_id");
            const auto id = optional_string(item["bone_id"], "bone_id"); require(id.has_value(), "bone_id cannot be null.", "bone_id");
            if (op == "clear_bone") result.operations.push_back(cane::ClearBoneLocalOverride{*id});
            else {
                require(item.has("local"), "Pose operation needs a local pose.", "local");
                result.operations.push_back(cane::SetBoneLocalOverride{*id, {local_pose(dictionary(item["local"], "local"), true),
                    transform_mode(item.get("transform_mode", godot::Variant()))}});
            }
        } else if (op == "set_region" || op == "clear_region") {
            if (op == "set_region") fields(item, {"op", "attachment_id", "local"});
            else fields(item, {"op", "attachment_id"});
            require(item.has("attachment_id"), "Pose operation needs an attachment_id.", "attachment_id");
            const auto id = optional_string(item["attachment_id"], "attachment_id"); require(id.has_value(), "attachment_id cannot be null.", "attachment_id");
            if (op == "clear_region") result.operations.push_back(cane::ClearRegionPoseOverride{*id});
            else {
                require(item.has("local"), "Pose operation needs a local pose.", "local");
                result.operations.push_back(cane::SetRegionPoseOverride{*id, region_pose(dictionary(item["local"], "local"))});
            }
        } else if (op == "set_vertex" || op == "clear_vertex") {
            if (op == "set_vertex") fields(item, {"op", "attachment_id", "deform_space", "values"});
            else fields(item, {"op", "attachment_id"});
            require(item.has("attachment_id"), "Vertex operation needs an attachment_id.", "attachment_id");
            const auto id = optional_string(item["attachment_id"], "attachment_id"); require(id.has_value(), "attachment_id cannot be null.", "attachment_id");
            if (op == "clear_vertex") result.operations.push_back(cane::ClearVertexDeformOverride{*id});
            else {
                require(item.has("deform_space") && item.has("values"), "Vertex operation needs deform_space and values.", "values");
                const auto space = optional_string(item["deform_space"], "deform_space"); require(space.has_value(), "deform_space cannot be null.", "deform_space");
                result.operations.push_back(cane::SetVertexDeformOverride{*id, vertex_space(text(*space)), vertex_buffer(item["values"], "values")});
            }
        } else if (op == "set_constraint" || op == "clear_constraint") {
            if (op == "set_constraint") fields(item, {"op", "constraint_id", "kind", "parameters"});
            else fields(item, {"op", "constraint_id"});
            require(item.has("constraint_id"), "Pose operation needs a constraint_id.", "constraint_id");
            const auto id = optional_string(item["constraint_id"], "constraint_id"); require(id.has_value(), "constraint_id cannot be null.", "constraint_id");
            if (op == "clear_constraint") result.operations.push_back(cane::ClearConstraintOverride{*id});
            else {
                require(item.has("kind") && item.has("parameters"), "Constraint operation needs kind and parameters.", "parameters");
                const auto kind = optional_string(item["kind"], "kind"); require(kind.has_value(), "kind cannot be null.", "kind");
                result.operations.push_back(cane::SetConstraintOverride{*id, constraint_override(text(*kind), dictionary(item["parameters"], "parameters"))});
            }
        } else if (op == "set_draw_order" || op == "clear_draw_order") {
            fields(item, op == "set_draw_order" ? std::initializer_list<const char*>{"op", "slot_ids"} : std::initializer_list<const char*>{"op"});
            if (op == "clear_draw_order") result.operations.push_back(cane::ClearDrawOrderOverride{});
            else {
                require(item.has("slot_ids") && item["slot_ids"].get_type() == godot::Variant::PACKED_STRING_ARRAY, "Draw order needs PackedStringArray slot_ids.", "slot_ids");
                result.operations.push_back(cane::SetDrawOrderOverride{strings(item["slot_ids"])});
            }
        } else if (op == "set_attachment" || op == "clear_attachment" || op == "set_tint" || op == "clear_tint") {
            if (op == "set_attachment") fields(item, {"op", "slot_id", "attachment_id"});
            else if (op == "set_tint") fields(item, {"op", "slot_id", "tint"});
            else fields(item, {"op", "slot_id"});
            require(item.has("slot_id"), "Slot operation needs a slot_id.", "slot_id");
            const auto id = optional_string(item["slot_id"], "slot_id"); require(id.has_value(), "slot_id cannot be null.", "slot_id");
            if (op == "clear_attachment") result.operations.push_back(cane::ClearSlotAttachmentOverride{*id});
            else if (op == "clear_tint") result.operations.push_back(cane::ClearSlotTintOverride{*id});
            else if (op == "set_attachment") {
                require(item.has("attachment_id"), "Attachment operation needs an attachment_id (or null).", "attachment_id");
                result.operations.push_back(cane::SetSlotAttachmentOverride{*id, optional_string(item["attachment_id"], "attachment_id")});
            } else {
                require(item.has("tint"), "Tint operation needs tint.", "tint");
                result.operations.push_back(cane::SetSlotTintOverride{*id, tint_input(dictionary(item["tint"], "tint"))});
            }
        } else require(false, "Unknown pose operation.", "op");
    }
    return result;
}
}
void CaneSkeleton::bind_host_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_bone_local_override", "bone_id", "local", "transform_mode"), &CaneSkeleton::set_bone_local_override, DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("clear_bone_local_override", "bone_id"), &CaneSkeleton::clear_bone_local_override);
    ClassDB::bind_method(D_METHOD("set_region_pose_override", "attachment_id", "local"), &CaneSkeleton::set_region_pose_override);
    ClassDB::bind_method(D_METHOD("clear_region_pose_override", "attachment_id"), &CaneSkeleton::clear_region_pose_override);
    ClassDB::bind_method(D_METHOD("set_pose_overrides", "operations"), &CaneSkeleton::set_pose_overrides);
    ClassDB::bind_method(D_METHOD("set_root_pose", "local", "physics_motion", "constraint_id"), &CaneSkeleton::set_root_pose, DEFVAL("move"), DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("set_physics_environment", "environment"), &CaneSkeleton::set_physics_environment);
    ClassDB::bind_method(D_METHOD("reset_physics", "constraint_id"), &CaneSkeleton::reset_physics, DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("advance_physics", "delta_seconds"), &CaneSkeleton::advance_physics);
    ClassDB::bind_method(D_METHOD("get_root_pose"), &CaneSkeleton::get_root_pose);
    ClassDB::bind_method(D_METHOD("get_bone_pose", "bone_id"), &CaneSkeleton::get_bone_pose);
    ClassDB::bind_method(D_METHOD("get_region_pose", "attachment_id"), &CaneSkeleton::get_region_pose);
}
bool CaneSkeleton::set_bone_local_override(const godot::String& id, const godot::Dictionary& local, const godot::Variant& mode) {
    return perform([&](cane::RuntimePlayer& p) { p.set_bone_local_override(text(id), {local_pose(local, true), transform_mode(mode)}); }, false);
}
bool CaneSkeleton::clear_bone_local_override(const godot::String& id) {
    return perform([&](cane::RuntimePlayer& p) { p.clear_bone_local_override(text(id)); }, false);
}
bool CaneSkeleton::set_region_pose_override(const godot::String& id, const godot::Dictionary& local) {
    return perform([&](cane::RuntimePlayer& p) { p.set_region_pose_override(text(id), region_pose(local)); }, false);
}
bool CaneSkeleton::clear_region_pose_override(const godot::String& id) {
    return perform([&](cane::RuntimePlayer& p) { p.clear_region_pose_override(text(id)); }, false);
}
bool CaneSkeleton::set_pose_overrides(const godot::Array& operations) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.set_authoring_overrides(pose_operations(operations)); }, false);
}
bool CaneSkeleton::set_authoring_overrides(const godot::Array& operations, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.set_authoring_overrides_with_sampling(pose_operations(operations), sampling_options(sampling)); }, false);
}
bool CaneSkeleton::set_root_pose(const godot::Dictionary& local, const godot::String& motion, const godot::Variant& id) {
    return perform([&](cane::RuntimePlayer& p) {
        const auto target = optional_string(id, "constraint_id");
        p.set_root_transform(region_pose(local), physics_motion(motion), target ? std::optional<std::string_view>(*target) : std::nullopt);
    }, false);
}
bool CaneSkeleton::set_physics_environment(const godot::Dictionary& values) {
    return perform([&](cane::RuntimePlayer& p) {
        fields(values, {"wind_x", "wind_y", "gravity_x", "gravity_y"}); cane::PhysicsEnvironment result;
        const auto get = [&](const char* key, float& out) { if (values.has(key)) out = number(values[key], key); };
        get("wind_x", result.wind_x); get("wind_y", result.wind_y); get("gravity_x", result.gravity_x); get("gravity_y", result.gravity_y);
        p.set_physics_environment(result);
    }, false);
}
bool CaneSkeleton::reset_physics(const godot::Variant& id) {
    return perform([&](cane::RuntimePlayer& p) {
        const auto target = optional_string(id, "constraint_id");
        if (target) (void)p.reset_physics_constraint(*target); else p.reset_physics();
    }, false);
}
bool CaneSkeleton::advance_physics(double delta) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.advance_physics(scalar(delta, "delta_seconds")); }, false);
}
godot::Dictionary CaneSkeleton::get_root_pose() {
    godot::Dictionary result; query_player([&](const cane::RuntimePlayer& p) { assign_dictionary(result, region_value(p.root_transform())); }); return result;
}
godot::Dictionary CaneSkeleton::get_bone_pose(const godot::String& id) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto pose = p.query_bone_pose(text(id)); const auto& m = pose.matrix;
        result["bone_id"] = text(pose.bone_id); result["core_local"] = local_value(pose.local, true);
        result["transform_mode"] = modes[static_cast<std::size_t>(pose.transform_mode)]; result["active"] = pose.active;
        result["transform"] = godot::Transform2D({m.a, -m.b}, {-m.c, m.d}, {m.tx, -m.ty});
    }); return result;
}
godot::Dictionary CaneSkeleton::get_region_pose(const godot::String& id) {
    godot::Dictionary result; query_player([&](const cane::RuntimePlayer& p) { assign_dictionary(result, region_value(p.query_region_attachment_pose(text(id)))); }); return result;
}
}
