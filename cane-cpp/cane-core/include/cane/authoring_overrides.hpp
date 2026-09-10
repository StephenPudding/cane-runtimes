#pragma once
#include "constraint_state.hpp"
#include "render_packet.hpp"
#include "vertex_geometry.hpp"

namespace cane {
struct RegionLocal { float x = 0, y = 0, rotation_degrees = 0, scale_x = 1, scale_y = 1; };
struct BoneOverride { BoneLocal local; std::optional<TransformMode> transform_mode; };
struct SetBoneLocalOverride { std::string bone_id; BoneOverride value; };
struct ClearBoneLocalOverride { std::string bone_id; };
struct SetRegionPoseOverride { std::string attachment_id; RegionLocal value; };
struct ClearRegionPoseOverride { std::string attachment_id; };
struct SetDrawOrderOverride { std::vector<std::string> slot_ids; };
struct ClearDrawOrderOverride {};
struct SetVertexDeformOverride { std::string attachment_id; VertexDeformSpace space; std::vector<float> values; };
struct ClearVertexDeformOverride { std::string attachment_id; };
struct SetSlotAttachmentOverride { std::string slot_id; std::optional<std::string> attachment_id; };
struct ClearSlotAttachmentOverride { std::string slot_id; };
struct SetSlotTintOverride { std::string slot_id; FinalTint tint; };
struct ClearSlotTintOverride { std::string slot_id; };
struct SetConstraintOverride { std::string constraint_id; ConstraintOverride parameters; };
struct ClearConstraintOverride { std::string constraint_id; };
using AuthoringOperation = std::variant<SetBoneLocalOverride, ClearBoneLocalOverride, SetRegionPoseOverride, ClearRegionPoseOverride,
    SetDrawOrderOverride, ClearDrawOrderOverride, SetVertexDeformOverride, ClearVertexDeformOverride,
    SetSlotAttachmentOverride, ClearSlotAttachmentOverride, SetSlotTintOverride, ClearSlotTintOverride,
    SetConstraintOverride, ClearConstraintOverride>;
struct AuthoringOverrides {
    // Owned values in declaration order; duplicate targets use the last operation.
    std::vector<AuthoringOperation> operations;
};
}
