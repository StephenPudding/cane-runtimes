#pragma once
#include "constraint_state.hpp"
#include <vector>

namespace cane {
struct BoneLocalPatch {
    std::optional<float> x, y, rotation_degrees, scale_x, scale_y, shear_x_degrees, shear_y_degrees;
};
struct BoneLocalAdditive {
    std::optional<float> x_delta, y_delta, rotation_degrees_delta, scale_x_delta, scale_y_delta, shear_x_degrees_delta, shear_y_degrees_delta;
};
struct ReplaceBoneLocal { std::string bone_id; BoneLocal local; };
struct PatchBoneLocal { std::string bone_id; BoneLocalPatch patch; };
struct AddBoneLocal { std::string bone_id; BoneLocalAdditive delta; };
struct PatchConstraint { std::string constraint_id; ConstraintOverride parameters; };
using PoseModifierOperation = std::variant<ReplaceBoneLocal, PatchBoneLocal, AddBoneLocal, PatchConstraint>;
struct PoseModifiers { std::vector<PoseModifierOperation> operations; };
}
