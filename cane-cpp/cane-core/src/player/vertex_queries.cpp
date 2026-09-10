#include "state.hpp"
#include "geometry/deformation.hpp"

namespace cane {
namespace {
geometry::VertexSource source(const detail::RuntimePlayerImpl& player, std::string_view id, const char* op) {
    return {detail::RuntimeFrameAccess::pose(*player.state->frame), player.index(RuntimeCatalogKind::attachment, id, op, "attachmentId"), op};
}
VertexAttachmentKind kind(detail::AttachmentKind value) {
    switch (value) {
        case detail::AttachmentKind::mesh: return VertexAttachmentKind::mesh;
        case detail::AttachmentKind::path: return VertexAttachmentKind::path;
        case detail::AttachmentKind::bounding_box: return VertexAttachmentKind::bounding_box;
        case detail::AttachmentKind::clipping: return VertexAttachmentKind::clipping;
        default: throw Error(ErrorCode::invalid_state, "queryVertexAttachmentSourceGeometry", "Unexpected source geometry kind.");
    }
}
}
VertexAttachmentSourceGeometry RuntimePlayer::query_vertex_attachment_source_geometry(std::string_view id, VertexDeformSpace space) const {
    constexpr auto op = "queryVertexAttachmentSourceGeometry";
    return detail::operation(op, [&] {
        const auto& p = impl(); const auto s = source(p, id, op); s.validate_space(space, "deformSpace");
        const auto canonical_space = s.geometry().weighted() ? VertexDeformSpace::weighted_influence_offsets : VertexDeformSpace::vertex_positions;
        const auto canonical = s.current(canonical_space); s.validate_values(canonical_space, canonical, "values");
        VertexAttachmentSourceGeometry result; result.attachment_id = id;
        const auto& catalog = p.data().catalog(RuntimeCatalogKind::attachment);
        result.source_attachment_id = catalog[s.attachment().geometry_owner].id; result.deform_attachment_id = catalog[s.attachment().deform_owner].id;
        result.kind = kind(s.attachment().kind); result.fully_weighted = s.geometry().weighted(); result.deform_space = space;
        result.setup_vertices_xy = s.geometry().positions; result.setup_world_vertices_xy = s.world(nullptr);
        result.sampled_vertices_xy = result.fully_weighted ? s.positions(canonical) : canonical;
        result.world_vertices_xy = s.world(&canonical);
        result.deform_values = space == VertexDeformSpace::vertex_positions ? result.sampled_vertices_xy : canonical;
        return result;
    });
}
VertexDeform RuntimePlayer::vertex_attachment_deform_for_world_target(const VertexWorldTarget& request) const {
    constexpr auto op = "vertexAttachmentDeformForWorldTarget";
    return detail::operation(op, [&] {
        const auto& p = impl(); const auto s = source(p, request.attachment_id, op);
        s.validate_vertex(request.source_vertex_index); s.check(request.target_world, "targetWorld");
        VertexDeform result; result.attachment_id = request.attachment_id;
        result.deform_attachment_id = p.data().catalog(RuntimeCatalogKind::attachment)[s.attachment().deform_owner].id;
        if (const auto* current = std::get_if<PlayerCurrentDeform>(&request.current_deform)) {
            result.space = current->space; s.validate_space(result.space, "currentDeform.space"); result.values = s.current(result.space);
        } else {
            const auto& explicit_deform = std::get<ExplicitVertexDeform>(request.current_deform);
            result.space = explicit_deform.space; s.validate_space(result.space, "currentDeform.space");
            result.values = explicit_deform.values;
        }
        // Explicit and sampled buffers use exactly the same validation/conversion as overrides.
        const auto canonical = s.canonical(result.space, result.values, "currentDeform.values");
        if (result.space == VertexDeformSpace::vertex_positions) {
            const auto value = s.position_for_target(request.source_vertex_index, request.target_world, s.world(nullptr));
            result.values[2 * request.source_vertex_index] = value.x; result.values[2 * request.source_vertex_index + 1] = value.y;
        } else s.write_offsets_for_target(request.source_vertex_index, request.target_world, s.world(&canonical), result.values);
        return result;
    });
}
std::vector<Point> RuntimePlayer::vertex_attachment_weight_local_positions_for_world_target(std::string_view id, std::uint32_t vertex, Point target) const {
    constexpr auto op = "vertexAttachmentWeightLocalPositionsForWorldTarget";
    return detail::operation(op, [&] {
        const auto s = source(impl(), id, op); s.validate_vertex(vertex); s.check(target, "targetWorld"); return s.weight_local_for_target(vertex, target);
    });
}
std::vector<float> RuntimePlayer::vertex_attachment_weighted_deform_offsets_after_position_edit(std::string_view id,
        const std::vector<float>& current, const std::vector<float>& before, const std::vector<float>& after) const {
    constexpr auto op = "vertexAttachmentWeightedDeformOffsetsAfterPositionEdit";
    return detail::operation(op, [&] { return source(impl(), id, op).offsets_after_edit(current, before, after); });
}
std::vector<float> RuntimePlayer::translate_weighted_mesh_deform(std::string_view id, VertexDeformSpace space, Point delta) const {
    constexpr auto op = "translateWeightedMeshDeform";
    return detail::operation(op, [&] {
        const auto s = source(impl(), id, op);
        if (s.attachment().kind != detail::AttachmentKind::mesh || !s.geometry().weighted())
            throw Error(ErrorCode::invalid_argument, op, "Attachment must be a fully weighted Mesh.", "attachmentId", std::string(id));
        s.validate_space(space, "space"); s.check(delta, "worldDelta");
        const auto offsets = s.current(VertexDeformSpace::weighted_influence_offsets); s.validate_values(VertexDeformSpace::weighted_influence_offsets, offsets, "values");
        auto values = space == VertexDeformSpace::vertex_positions ? s.positions(offsets) : offsets;
        const auto current_world = s.world(&offsets);
        const auto setup_world = space == VertexDeformSpace::vertex_positions ? s.world(nullptr) : std::vector<float>{};
        for (std::size_t vertex = 0; vertex < current_world.size() / 2; ++vertex) {
            const Point target{current_world[2 * vertex] + delta.x, current_world[2 * vertex + 1] + delta.y}; s.check(target, "worldDelta");
            if (space == VertexDeformSpace::vertex_positions) {
                const auto value = s.position_for_target(vertex, target, setup_world); values[2 * vertex] = value.x; values[2 * vertex + 1] = value.y;
            } else s.write_offsets_for_target(vertex, target, current_world, values);
        }
        return values;
    });
}
void RuntimePlayer::set_vertex_deform_override(std::string_view id, VertexDeformSpace space, const std::vector<float>& values) {
    (void)apply_authoring({{SetVertexDeformOverride{std::string(id), space, values}}}, {}, "setVertexDeformOverride");
}
void RuntimePlayer::clear_vertex_deform_override(std::string_view id) {
    (void)apply_authoring({{ClearVertexDeformOverride{std::string(id)}}}, {}, "clearVertexDeformOverride");
}
}
