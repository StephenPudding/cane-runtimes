#pragma once
#include "math.hpp"
#include <cstdint>
#include <string>
#include <variant>
#include <vector>

namespace cane {
enum class VertexDeformSpace { vertex_positions, weighted_influence_offsets };
enum class VertexAttachmentKind { mesh, path, bounding_box, clipping };

// Every buffer uses immutable source-vertex order, before clipping or Atlas projection.
struct VertexAttachmentSourceGeometry {
    std::string attachment_id, source_attachment_id, deform_attachment_id;
    VertexAttachmentKind kind = VertexAttachmentKind::mesh;
    std::vector<float> setup_vertices_xy, setup_world_vertices_xy, sampled_vertices_xy, world_vertices_xy;
    VertexDeformSpace deform_space = VertexDeformSpace::vertex_positions;
    std::vector<float> deform_values;
    bool fully_weighted = false;
};
struct VertexDeform {
    std::string attachment_id, deform_attachment_id;
    VertexDeformSpace space = VertexDeformSpace::vertex_positions;
    std::vector<float> values;
};
struct PlayerCurrentDeform { VertexDeformSpace space = VertexDeformSpace::vertex_positions; };
struct ExplicitVertexDeform {
    VertexDeformSpace space = VertexDeformSpace::vertex_positions;
    std::vector<float> values;
};
struct VertexWorldTarget {
    std::string attachment_id;
    std::uint32_t source_vertex_index = 0;
    Point target_world;
    std::variant<PlayerCurrentDeform, ExplicitVertexDeform> current_deform;
};
}
