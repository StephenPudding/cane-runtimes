#include "bounds.hpp"
#include "skeleton.hpp"
#include "constraint_values.hpp"
#include "vertex_values.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
namespace {
godot::Dictionary aabb_value(const cane::BoundsAabb& value) {
    godot::Dictionary result; result["empty"] = value.empty;
    result["min_x"] = value.min_x; result["min_y"] = value.min_y;
    result["max_x"] = value.max_x; result["max_y"] = value.max_y;
    result["width"] = value.width; result["height"] = value.height; return result;
}
godot::Dictionary hit_value(const cane::BoundsHit& value) {
    godot::Dictionary result; result["slot_id"] = text(value.slot_id);
    result["attachment_id"] = text(value.attachment_id); result["draw_index"] = value.draw_index; return result;
}
godot::Dictionary polygon_value(const cane::BoundsPolygon& value) {
    auto result = hit_value(value); result["world_vertices_xy"] = vertex_buffer_value(value.world_vertices_xy); return result;
}
godot::Array polygon_values(const cane::RuntimeBounds& bounds) {
    godot::Array result;
    for (const auto& polygon : bounds.polygons()) result.push_back(polygon_value(polygon));
    return result;
}
godot::Array hit_values(const cane::BoundsHitBuffer& hits) {
    godot::Array result;
    for (const auto& hit : hits.hits()) result.push_back(hit_value(hit));
    return result;
}
}
void CaneBounds::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("get_snapshot"), &CaneBounds::get_snapshot);
    ClassDB::bind_method(D_METHOD("get_aabb"), &CaneBounds::get_aabb);
    ClassDB::bind_method(D_METHOD("get_polygons"), &CaneBounds::get_polygons);
    ClassDB::bind_method(D_METHOD("get_polygon", "attachment_id"), &CaneBounds::get_polygon);
    ClassDB::bind_method(D_METHOD("get_frame_sequence"), &CaneBounds::get_frame_sequence);
    ClassDB::bind_method(D_METHOD("contains_point", "core_point"), &CaneBounds::contains_point);
    ClassDB::bind_method(D_METHOD("intersects_segment", "core_start", "core_end"), &CaneBounds::intersects_segment);
    ClassDB::bind_method(D_METHOD("get_point_hits", "core_point"), &CaneBounds::get_point_hits);
    ClassDB::bind_method(D_METHOD("get_segment_hits", "core_start", "core_end"), &CaneBounds::get_segment_hits);
    ClassDB::bind_method(D_METHOD("aabb_contains_point", "core_point"), &CaneBounds::aabb_contains_point);
    ClassDB::bind_method(D_METHOD("aabb_intersects_segment", "core_start", "core_end"), &CaneBounds::aabb_intersects_segment);
    ClassDB::bind_method(D_METHOD("aabb_intersects_bounds", "other"), &CaneBounds::aabb_intersects_bounds);
    ClassDB::bind_method(D_METHOD("intersects_bounds", "other"), &CaneBounds::intersects_bounds);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneBounds::get_last_error);
}
bool CaneBounds::query(const std::function<void()>& action) {
    try { action(); last_error_.clear(); return true; }
    catch (const std::exception& failure) { set_error(last_error_, failure); return false; }
}
void CaneBounds::write(const cane::RuntimePlayer& player, const cane::BoundsOptions& options) {
    try { player.write_bounds(bounds_, options); last_error_.clear(); }
    catch (const std::exception& failure) { set_error(last_error_, failure); throw; }
}
godot::Dictionary CaneBounds::get_snapshot() {
    godot::Dictionary result;
    query([&] { result["frame_sequence"] = get_frame_sequence(); result["aabb"] = aabb_value(bounds_.aabb()); result["polygons"] = polygon_values(bounds_); });
    return result;
}
godot::Dictionary CaneBounds::get_aabb() {
    godot::Dictionary result; query([&] { assign_dictionary(result, aabb_value(bounds_.aabb())); }); return result;
}
godot::Array CaneBounds::get_polygons() {
    godot::Array result; query([&] { result = polygon_values(bounds_); }); return result;
}
godot::Dictionary CaneBounds::get_polygon(const godot::String& id) {
    godot::Dictionary result; query([&] { if (const auto* value = bounds_.polygon_for_attachment(text(id))) assign_dictionary(result, polygon_value(*value)); }); return result;
}
godot::Dictionary CaneBounds::contains_point(const godot::Vector2& point) {
    godot::Dictionary result; query([&] { if (const auto* value = bounds_.contains_point(core_point(point, "core_point"))) assign_dictionary(result, hit_value(*value)); }); return result;
}
godot::Dictionary CaneBounds::intersects_segment(const godot::Vector2& start, const godot::Vector2& end) {
    godot::Dictionary result; query([&] { if (const auto* value = bounds_.intersects_segment(core_point(start, "core_start"), core_point(end, "core_end"))) assign_dictionary(result, hit_value(*value)); }); return result;
}
godot::Variant CaneBounds::get_point_hits(const godot::Vector2& point) {
    godot::Variant result; query([&] { bounds_.write_point_hits(core_point(point, "core_point"), hits_); result = hit_values(hits_); }); return result;
}
godot::Variant CaneBounds::get_segment_hits(const godot::Vector2& start, const godot::Vector2& end) {
    godot::Variant result; query([&] { bounds_.write_segment_hits(core_point(start, "core_start"), core_point(end, "core_end"), hits_); result = hit_values(hits_); }); return result;
}
godot::Variant CaneBounds::aabb_contains_point(const godot::Vector2& point) {
    godot::Variant result; query([&] { result = bounds_.aabb_contains_point(core_point(point, "core_point")); }); return result;
}
godot::Variant CaneBounds::aabb_intersects_segment(const godot::Vector2& start, const godot::Vector2& end) {
    godot::Variant result; query([&] { result = bounds_.aabb_intersects_segment(core_point(start, "core_start"), core_point(end, "core_end")); }); return result;
}
godot::Variant CaneBounds::aabb_intersects_bounds(const godot::Ref<CaneBounds>& other) {
    godot::Variant result; query([&] { require(other.is_valid(), "Other bounds is null.", "other"); result = bounds_.aabb_intersects_bounds(other->bounds_); }); return result;
}
godot::Variant CaneBounds::intersects_bounds(const godot::Ref<CaneBounds>& other) {
    godot::Variant result; query([&] { require(other.is_valid(), "Other bounds is null.", "other"); result = bounds_.intersects_bounds(other->bounds_); }); return result;
}
void CaneSkeleton::bind_bounds_methods() {
    godot::ClassDB::bind_method(godot::D_METHOD("write_bounds", "bounds", "options"), &CaneSkeleton::write_bounds, DEFVAL(godot::Dictionary()));
}
bool CaneSkeleton::write_bounds(const godot::Ref<CaneBounds>& output, const godot::Dictionary& options) {
    return query_player([&](const cane::RuntimePlayer& player) {
        require(output.is_valid(), "Bounds output is null.", "bounds");
        fields(options, {"include_render_geometry", "include_bounding_boxes", "include_transparent"});
        cane::BoundsOptions parsed;
        if (options.has("include_render_geometry")) parsed.include_render_geometry = boolean(options["include_render_geometry"], "include_render_geometry");
        if (options.has("include_bounding_boxes")) parsed.include_bounding_boxes = boolean(options["include_bounding_boxes"], "include_bounding_boxes");
        if (options.has("include_transparent")) parsed.include_transparent = boolean(options["include_transparent"], "include_transparent");
        output->write(player, parsed);
    });
}
}
