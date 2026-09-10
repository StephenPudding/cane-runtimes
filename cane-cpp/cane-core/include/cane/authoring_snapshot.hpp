#pragma once
#include "constraint_state.hpp"
#include "pose_queries.hpp"
#include "vertex_geometry.hpp"
#include <utility>

namespace cane {
struct AuthoringSnapshot {
    RuntimeFrame frame;
    std::vector<BoneLocalState> bone_local_states;
    std::vector<SlotState> slot_states;
    std::vector<ConstraintState> constraint_states;
    std::vector<PointAttachmentPose> point_attachment_poses;
    std::vector<AttachmentGeometry> attachment_geometries;
    std::vector<VertexAttachmentSourceGeometry> vertex_attachment_source_geometries;
    std::vector<PathConstraintPosition> path_constraint_positions;
    explicit AuthoringSnapshot(RuntimeFrame publication) : frame(std::move(publication)) {}
};
}
