#include "skeleton.hpp"
#include "constraint_values.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
void CaneSkeleton::bind_constraint_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_constraint_override", "constraint_id", "kind", "parameters"), &CaneSkeleton::set_constraint_override);
    ClassDB::bind_method(D_METHOD("clear_constraint_override", "constraint_id"), &CaneSkeleton::clear_constraint_override);
    ClassDB::bind_method(D_METHOD("get_constraint_ids"), &CaneSkeleton::get_constraint_ids);
    ClassDB::bind_method(D_METHOD("get_constraint_state", "constraint_id"), &CaneSkeleton::get_constraint_state);
    ClassDB::bind_method(D_METHOD("get_matched_transform_constraint_offsets", "constraint_id"), &CaneSkeleton::get_matched_transform_constraint_offsets);
    ClassDB::bind_method(D_METHOD("get_path_constraint_position", "constraint_id"), &CaneSkeleton::get_path_constraint_position);
    ClassDB::bind_method(D_METHOD("get_path_constraint_position_for_world_target", "constraint_id", "core_target_world"), &CaneSkeleton::get_path_constraint_position_for_world_target);
}
bool CaneSkeleton::set_constraint_override(const godot::String& id, const godot::String& kind, const godot::Dictionary& parameters) {
    return perform([&](cane::RuntimePlayer& p) { p.set_constraint_override(text(id), constraint_override(kind, parameters)); }, false);
}
bool CaneSkeleton::clear_constraint_override(const godot::String& id) {
    return perform([&](cane::RuntimePlayer& p) { p.clear_constraint_override(text(id)); }, false);
}
godot::PackedStringArray CaneSkeleton::get_constraint_ids() {
    godot::PackedStringArray result;
    query_player([&](const cane::RuntimePlayer& p) { for (const auto& row : p.data().catalog(cane::RuntimeCatalogKind::constraint)) result.push_back(text(row.id)); }); return result;
}
godot::Dictionary CaneSkeleton::get_constraint_state(const godot::String& id) {
    godot::Dictionary result; query_player([&](const cane::RuntimePlayer& p) { assign_dictionary(result, constraint_value(p.query_constraint_state(text(id)))); }); return result;
}
godot::Dictionary CaneSkeleton::get_matched_transform_constraint_offsets(const godot::String& id) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto value = p.query_matched_transform_constraint_offsets(text(id));
        result["rotation_degrees"] = value.rotation_degrees; result["x"] = value.x; result["y"] = value.y;
        result["scale_x"] = value.scale_x; result["scale_y"] = value.scale_y; result["shear_y_degrees"] = value.shear_y_degrees;
    }); return result;
}
godot::Dictionary CaneSkeleton::get_path_constraint_position(const godot::String& id) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto value = p.query_path_constraint_position(text(id)); result["constraint_id"] = text(value.constraint_id);
        result["point"] = godot::Vector2(value.point.x, value.point.y); result["tangent_degrees"] = value.tangent_degrees;
        result["distance"] = value.distance; result["path_length"] = value.path_length;
        result["path_start"] = godot::Vector2(value.path_start.x, value.path_start.y); result["path_end"] = godot::Vector2(value.path_end.x, value.path_end.y);
        result["closed"] = value.closed;
    }); return result;
}
godot::Variant CaneSkeleton::get_path_constraint_position_for_world_target(const godot::String& id, const godot::Vector2& target) {
    godot::Variant result;
    query_player([&](const cane::RuntimePlayer& p) { result = p.query_path_constraint_position_for_world_target(text(id), core_point(target, "core_target_world")); }); return result;
}
}
