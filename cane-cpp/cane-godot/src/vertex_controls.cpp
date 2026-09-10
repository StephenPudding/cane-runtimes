#include "skeleton.hpp"
#include "vertex_values.hpp"
#include "constraint_values.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>

namespace cane_godot {
void CaneSkeleton::bind_vertex_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("get_attachment_geometry", "attachment_id"), &CaneSkeleton::get_attachment_geometry);
    ClassDB::bind_method(D_METHOD("get_vertex_source_geometry", "attachment_id", "deform_space"), &CaneSkeleton::get_vertex_source_geometry, DEFVAL("vertex_positions"));
    ClassDB::bind_method(D_METHOD("get_vertex_deform_for_world_target", "attachment_id", "source_vertex_index", "core_target_world", "deform_space", "current_values"),
        &CaneSkeleton::get_vertex_deform_for_world_target, DEFVAL("vertex_positions"), DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("get_vertex_weight_local_positions_for_world_target", "attachment_id", "source_vertex_index", "core_target_world"),
        &CaneSkeleton::get_vertex_weight_local_positions_for_world_target);
    ClassDB::bind_method(D_METHOD("get_vertex_weighted_offsets_after_position_edit", "attachment_id", "current_offsets", "before_positions", "after_positions"),
        &CaneSkeleton::get_vertex_weighted_offsets_after_position_edit);
    ClassDB::bind_method(D_METHOD("get_translated_weighted_mesh_deform", "attachment_id", "deform_space", "core_world_delta"), &CaneSkeleton::get_translated_weighted_mesh_deform);
    ClassDB::bind_method(D_METHOD("set_vertex_deform_override", "attachment_id", "deform_space", "values"), &CaneSkeleton::set_vertex_deform_override);
    ClassDB::bind_method(D_METHOD("clear_vertex_deform_override", "attachment_id"), &CaneSkeleton::clear_vertex_deform_override);
}
godot::Dictionary CaneSkeleton::get_attachment_geometry(const godot::String& id) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto value = p.query_attachment_geometry(text(id));
        const char* kinds[] = {"path", "bounding_box", "clipping"};
        result["attachment_id"] = text(value.attachment_id); result["kind"] = kinds[static_cast<std::size_t>(value.kind)];
        result["world_vertices_xy"] = vertex_buffer_value(value.world_vertices_xy);
        result["closed"] = value.closed ? godot::Variant(*value.closed) : godot::Variant();
    }); return result;
}
godot::Dictionary CaneSkeleton::get_vertex_source_geometry(const godot::String& id, const godot::String& space) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto value = p.query_vertex_attachment_source_geometry(text(id), vertex_space(space));
        const char* kinds[] = {"mesh", "path", "bounding_box", "clipping"};
        result["attachment_id"] = text(value.attachment_id); result["source_attachment_id"] = text(value.source_attachment_id);
        result["deform_attachment_id"] = text(value.deform_attachment_id); result["kind"] = kinds[static_cast<std::size_t>(value.kind)];
        result["deform_space"] = vertex_space_name(value.deform_space); result["fully_weighted"] = value.fully_weighted;
        result["setup_vertices_xy"] = vertex_buffer_value(value.setup_vertices_xy);
        result["setup_world_vertices_xy"] = vertex_buffer_value(value.setup_world_vertices_xy);
        result["sampled_vertices_xy"] = vertex_buffer_value(value.sampled_vertices_xy);
        result["world_vertices_xy"] = vertex_buffer_value(value.world_vertices_xy);
        result["deform_values"] = vertex_buffer_value(value.deform_values);
    }); return result;
}
godot::Dictionary CaneSkeleton::get_vertex_deform_for_world_target(const godot::String& id, const godot::Variant& index,
    const godot::Vector2& target, const godot::String& space, const godot::Variant& current) {
    godot::Dictionary result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto deform_space = vertex_space(space);
        cane::VertexWorldTarget request{text(id), source_vertex_index(index), core_point(target, "core_target_world"), cane::PlayerCurrentDeform{deform_space}};
        if (current.get_type() != godot::Variant::NIL) request.current_deform = cane::ExplicitVertexDeform{deform_space, vertex_buffer(current, "current_values")};
        const auto value = p.vertex_attachment_deform_for_world_target(request);
        result["attachment_id"] = text(value.attachment_id); result["deform_attachment_id"] = text(value.deform_attachment_id);
        result["deform_space"] = vertex_space_name(value.space); result["values"] = vertex_buffer_value(value.values);
    }); return result;
}
godot::Variant CaneSkeleton::get_vertex_weight_local_positions_for_world_target(const godot::String& id, const godot::Variant& index, const godot::Vector2& target) {
    godot::Variant result;
    query_player([&](const cane::RuntimePlayer& p) {
        const auto values = p.vertex_attachment_weight_local_positions_for_world_target(text(id), source_vertex_index(index), core_point(target, "core_target_world"));
        godot::PackedVector2Array points; points.resize(static_cast<std::int64_t>(values.size())); auto* output = points.ptrw();
        for (std::size_t i = 0; i < values.size(); ++i) output[i] = {values[i].x, values[i].y};
        result = points;
    }); return result;
}
godot::Variant CaneSkeleton::get_vertex_weighted_offsets_after_position_edit(const godot::String& id, const godot::Variant& offsets,
    const godot::Variant& before, const godot::Variant& after) {
    godot::Variant result;
    query_player([&](const cane::RuntimePlayer& p) {
        result = vertex_buffer_value(p.vertex_attachment_weighted_deform_offsets_after_position_edit(text(id), vertex_buffer(offsets, "current_offsets"),
            vertex_buffer(before, "before_positions"), vertex_buffer(after, "after_positions")));
    }); return result;
}
godot::Variant CaneSkeleton::get_translated_weighted_mesh_deform(const godot::String& id, const godot::String& space, const godot::Vector2& delta) {
    godot::Variant result;
    query_player([&](const cane::RuntimePlayer& p) {
        result = vertex_buffer_value(p.translate_weighted_mesh_deform(text(id), vertex_space(space), core_point(delta, "core_world_delta")));
    }); return result;
}
bool CaneSkeleton::set_vertex_deform_override(const godot::String& id, const godot::String& space, const godot::Variant& values) {
    return perform([&](cane::RuntimePlayer& p) { p.set_vertex_deform_override(text(id), vertex_space(space), vertex_buffer(values, "values")); }, false);
}
bool CaneSkeleton::clear_vertex_deform_override(const godot::String& id) {
    return perform([&](cane::RuntimePlayer& p) { p.clear_vertex_deform_override(text(id)); }, false);
}
}
