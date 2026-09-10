#include "snapshot_values.hpp"
#include "color_values.hpp"
#include "constraint_values.hpp"
#include "vertex_values.hpp"
#include "bridge.hpp"
#include <godot_cpp/variant/packed_int32_array.hpp>

namespace cane_godot {
namespace {
godot::PackedStringArray ids(const std::vector<std::string>& values) {
    godot::PackedStringArray result; for (const auto& value : values) result.push_back(text(value)); return result;
}
godot::PackedFloat32Array affine(const cane::Affine& m) { return vertex_buffer_value({m.a, m.b, m.c, m.d, m.tx, m.ty}); }
godot::Dictionary local(const cane::BoneLocal& p) {
    godot::Dictionary result; result["x"] = p.x; result["y"] = p.y; result["rotation_degrees"] = p.rotation_degrees;
    result["scale_x"] = p.scale_x; result["scale_y"] = p.scale_y; result["shear_x_degrees"] = p.shear_x_degrees; result["shear_y_degrees"] = p.shear_y_degrees; return result;
}
const char* mode(cane::TransformMode value) {
    const char* modes[] = {"normal", "only_translation", "no_rotation_or_reflection", "no_scale", "no_scale_or_reflection"}; return modes[static_cast<std::size_t>(value)];
}
template<class T> godot::Dictionary texture_base(const T& value) {
    godot::Dictionary result; result["image_id"] = text(value.image_id); result["width"] = value.width; result["height"] = value.height;
    result["color_space"] = value.color_space == cane::ColorSpace::srgb ? "srgb" : "linear";
    result["alpha_mode"] = value.alpha_mode == cane::AlphaMode::straight ? "straight" : "premultiplied"; return result;
}
godot::Dictionary texture(const cane::TextureDescriptor& value) {
    if (const auto* direct = std::get_if<cane::DirectTexture>(&value)) {
        auto result = texture_base(*direct); result["kind"] = "direct"; result["path"] = text(direct->path); return result;
    }
    const auto& atlas = std::get<cane::AtlasTexture>(value); auto result = texture_base(atlas);
    result["kind"] = "atlasPage"; result["atlas_id"] = text(atlas.atlas_id); result["region_id"] = text(atlas.region_id);
    result["page_id"] = text(atlas.page_id); result["page_path"] = text(atlas.page_path);
    result["min_filter"] = atlas.min_filter == cane::TextureFilter::nearest ? "nearest" : "linear";
    result["mag_filter"] = atlas.mag_filter == cane::TextureFilter::nearest ? "nearest" : "linear";
    const char* wraps[] = {"clamp", "repeat", "mirror"}; result["wrap_u"] = wraps[static_cast<std::size_t>(atlas.wrap_u)]; result["wrap_v"] = wraps[static_cast<std::size_t>(atlas.wrap_v)]; return result;
}
godot::Dictionary frame_value(const cane::RuntimeFrame& frame) {
    godot::Dictionary result, packet; godot::Array bones, draws;
    result["sequence"] = static_cast<std::int64_t>(frame.sequence()); result["sequence_u64"] = text(std::to_string(frame.sequence())); result["time_seconds"] = frame.time_seconds();
    result["configured_skin_ids"] = ids(frame.configured_skin_ids()); result["sampled_skin_ids"] = ids(frame.sampled_skin_ids());
    for (const auto& value : frame.bones()) {
        godot::Dictionary row; row["bone_id"] = text(value.bone_id); row["core_matrix"] = affine(value.matrix); row["core_local"] = local(value.local);
        row["transform_mode"] = mode(value.transform_mode); row["active"] = value.active; bones.push_back(row);
    }
    for (const auto& value : frame.render_packet().attachments()) {
        godot::Dictionary row; row["draw_index"] = value.draw_index; row["source_z_index"] = value.source_z_index;
        row["slot_id"] = text(value.slot_id); row["attachment_id"] = text(value.attachment_id); row["image_id"] = text(value.image_id);
        row["geometry_kind"] = value.geometry_kind == cane::GeometryKind::region_quad ? "regionQuad" : "meshTriangles";
        const char* blends[] = {"normal", "add", "multiply", "screen"}; row["blend"] = blends[static_cast<std::size_t>(value.blend)];
        row["texture"] = texture(value.texture); row["tint"] = tint_value(value.tint); row["source_affine"] = affine(value.source_affine);
        row["world_vertices_xy"] = vertex_buffer_value(value.world_vertices_xy); row["uvs"] = vertex_buffer_value(value.uvs);
        godot::PackedInt32Array indices; for (const auto index : value.indices) indices.push_back(static_cast<std::int32_t>(index)); row["indices"] = indices;
        godot::PackedStringArray facing; const char* faces[] = {"towardViewer", "awayFromViewer", "edgeOn"};
        for (const auto face : value.authored_triangle_facing) facing.push_back(faces[static_cast<std::size_t>(face)]);
        row["authored_triangle_facing"] = facing; row["front_face"] = "ccw"; draws.push_back(row);
    }
    result["bones"] = bones; packet["attachments"] = draws; packet["coordinate_system"] = "xRightYUp";
    packet["uv_origin"] = "topLeft"; packet["tint_color_space"] = "srgb"; packet["tint_alpha_mode"] = "straight"; result["render_packet"] = packet; return result;
}
}
godot::Dictionary slot_snapshot_value(const cane::SlotState& value) {
    godot::Dictionary row; row["slot_id"] = text(value.slot_id); row["draw_index"] = value.draw_index;
    row["attachment_key"] = value.attachment_key ? godot::Variant(text(*value.attachment_key)) : godot::Variant();
    row["attachment_id"] = value.attachment_id ? godot::Variant(text(*value.attachment_id)) : godot::Variant(); row["tint"] = tint_value(value.tint); return row;
}
godot::Dictionary authoring_snapshot_value(const cane::AuthoringSnapshot& value) {
    godot::Dictionary result; result["frame"] = frame_value(value.frame);
    godot::Array bones, slots, constraints, points, geometries, sources, paths;
    for (const auto& b : value.bone_local_states) {
        godot::Dictionary row; row["bone_id"] = text(b.bone_id); row["core_local"] = local(b.local); row["transform_mode"] = mode(b.transform_mode); bones.push_back(row);
    }
    for (const auto& slot : value.slot_states) slots.push_back(slot_snapshot_value(slot));
    for (const auto& state : value.constraint_states) constraints.push_back(constraint_value(state));
    for (const auto& p : value.point_attachment_poses) {
        godot::Dictionary row; row["attachment_id"] = text(p.attachment_id); row["slot_id"] = text(p.slot_id); row["core_matrix"] = affine(p.matrix);
        row["core_position"] = godot::Vector2(p.x, p.y); row["rotation_degrees"] = p.rotation_degrees; row["active"] = p.active; row["selected"] = p.selected; points.push_back(row);
    }
    for (const auto& g : value.attachment_geometries) {
        godot::Dictionary row; const char* kinds[] = {"path", "bounding_box", "clipping"}; row["attachment_id"] = text(g.attachment_id); row["kind"] = kinds[static_cast<std::size_t>(g.kind)];
        row["world_vertices_xy"] = vertex_buffer_value(g.world_vertices_xy); row["closed"] = g.closed ? godot::Variant(*g.closed) : godot::Variant(); geometries.push_back(row);
    }
    for (const auto& g : value.vertex_attachment_source_geometries) {
        godot::Dictionary row; const char* kinds[] = {"mesh", "path", "bounding_box", "clipping"}; row["attachment_id"] = text(g.attachment_id); row["kind"] = kinds[static_cast<std::size_t>(g.kind)];
        row["source_attachment_id"] = text(g.source_attachment_id); row["deform_attachment_id"] = text(g.deform_attachment_id);
        row["deform_space"] = vertex_space_name(g.deform_space); row["fully_weighted"] = g.fully_weighted;
        row["setup_vertices_xy"] = vertex_buffer_value(g.setup_vertices_xy); row["setup_world_vertices_xy"] = vertex_buffer_value(g.setup_world_vertices_xy);
        row["sampled_vertices_xy"] = vertex_buffer_value(g.sampled_vertices_xy); row["world_vertices_xy"] = vertex_buffer_value(g.world_vertices_xy);
        row["deform_values"] = vertex_buffer_value(g.deform_values); sources.push_back(row);
    }
    for (const auto& p : value.path_constraint_positions) {
        godot::Dictionary row; row["constraint_id"] = text(p.constraint_id); row["point"] = godot::Vector2(p.point.x, p.point.y); row["tangent_degrees"] = p.tangent_degrees;
        row["distance"] = p.distance; row["path_length"] = p.path_length; row["path_start"] = godot::Vector2(p.path_start.x, p.path_start.y);
        row["path_end"] = godot::Vector2(p.path_end.x, p.path_end.y); row["closed"] = p.closed; paths.push_back(row);
    }
    result["bone_local_states"] = bones; result["slot_states"] = slots; result["constraint_states"] = constraints; result["point_attachment_poses"] = points;
    result["attachment_geometries"] = geometries; result["vertex_attachment_source_geometries"] = sources; result["path_constraint_positions"] = paths; return result;
}
}
