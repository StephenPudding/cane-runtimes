#include "state.hpp"
#include <limits>

namespace cane {
namespace {
SlotState slot_state(const animation::Pose& pose, std::size_t index, std::size_t order, const char* operation) {
    if (order > std::numeric_limits<std::uint32_t>::max()) throw Error(ErrorCode::resource_limit, operation, "Slot order exceeds u32.", "drawIndex");
    const auto& slot = pose.slots[index]; SlotState result;
    result.slot_id = pose.data().catalog(RuntimeCatalogKind::slot)[index].id; result.attachment_key = slot.key;
    if (slot.attachment) result.attachment_id = pose.data().catalog(RuntimeCatalogKind::attachment)[*slot.attachment].id;
    result.tint = {slot.color, slot.dark, slot.alpha}; result.draw_index = static_cast<std::uint32_t>(order); return result;
}
}
BonePose RuntimePlayer::query_bone_pose(std::string_view id) const {
    return detail::operation("queryBonePose", [&] {
        const auto& p = impl(); return p.frame().bones()[p.index(RuntimeCatalogKind::bone, id, "queryBonePose", nullptr)];
    });
}
BoneLocal RuntimePlayer::query_bone_local(std::string_view id) const {
    return detail::operation("queryBoneLocal", [&] { return query_bone_pose(id).local; });
}
bool RuntimePlayer::query_bone_active(std::string_view id) const {
    return detail::operation("queryBoneActive", [&] { return query_bone_pose(id).active; });
}
TransformMode RuntimePlayer::query_bone_transform_mode(std::string_view id) const {
    return detail::operation("queryBoneTransformMode", [&] { return query_bone_pose(id).transform_mode; });
}
BoneLocalState RuntimePlayer::query_bone_local_state(std::string_view id) const {
    return detail::operation("queryBoneLocalState", [&] {
        const auto bone = query_bone_pose(id); return BoneLocalState{bone.bone_id, bone.local, bone.transform_mode};
    });
}
RegionLocal RuntimePlayer::query_region_attachment_pose(std::string_view id) const {
    return detail::operation("queryRegionAttachmentPose", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::attachment, id, "queryRegionAttachmentPose", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        if (pose.model().attachments[index].kind != detail::AttachmentKind::region)
            throw Error(ErrorCode::invalid_argument, "queryRegionAttachmentPose", "Attachment must be a Region.", "attachmentId", std::string(id));
        const auto& r = pose.regions[index]; return RegionLocal{r.x, r.y, r.rotation_degrees, r.scale_x, r.scale_y};
    });
}
std::uint32_t RuntimePlayer::query_sequence_index(std::string_view id) const {
    return detail::operation("querySequenceIndex", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::attachment, id, "querySequenceIndex", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        if (pose.model().attachments[index].sequence_images.empty())
            throw Error(ErrorCode::invalid_argument, "querySequenceIndex", "Attachment has no sequence.", "attachmentId", std::string(id));
        return pose.sequence_indices[index];
    });
}
SlotState RuntimePlayer::query_slot_state(std::string_view id) const {
    return detail::operation("querySlotState", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::slot, id, "querySlotState", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        const auto at = std::find(pose.order.begin(), pose.order.end(), index);
        if (at == pose.order.end()) throw Error(ErrorCode::invalid_state, "querySlotState", "Slot is absent from sampled draw order.", "drawIndex", std::string(id));
        const auto order = static_cast<std::size_t>(at - pose.order.begin());
        if (order > std::numeric_limits<std::uint32_t>::max()) throw Error(ErrorCode::resource_limit, "querySlotState", "Slot order exceeds u32.", "drawIndex", std::string(id));
        return slot_state(pose, index, order, "querySlotState");
    });
}
std::vector<SlotState> RuntimePlayer::query_slot_states() const {
    return detail::operation("querySlotStates", [&] {
        const auto& p = impl(); const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        std::vector<SlotState> result; result.reserve(pose.order.size());
        for (std::size_t i = 0; i < pose.order.size(); ++i) result.push_back(slot_state(pose, pose.order[i], i, "querySlotStates"));
        return result;
    });
}
BonePose RuntimePlayer::query_slot_bone_pose(std::string_view id) const {
    return detail::operation("querySlotBonePose", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::slot, id, "querySlotBonePose", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        return p.frame().bones()[pose.model().slots[index].bone];
    });
}
PointAttachmentPose RuntimePlayer::query_point_attachment_pose(std::string_view id) const {
    return detail::operation("queryPointAttachmentPose", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::attachment, id, "queryPointAttachmentPose", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        if (pose.model().attachments[index].kind != detail::AttachmentKind::point)
            throw Error(ErrorCode::invalid_argument, "queryPointAttachmentPose", "Attachment must be a Point.", "attachmentId", std::string(id));
        const auto world = pose.attachment_affine(index); const float angle = std::atan2(world.b, world.a) * radians_to_degrees;
        detail::require_finite(angle, "queryPointAttachmentPose", "rotationDegrees");
        const auto slot = pose.model().attachments[index].slot;
        PointAttachmentPose result; result.attachment_id = id; result.matrix = world;
        result.x = world.tx; result.y = world.ty; result.rotation_degrees = angle;
        result.slot_id = pose.data().catalog(RuntimeCatalogKind::slot)[slot].id;
        result.active = pose.active_bones[pose.model().slots[slot].bone];
        result.selected = pose.slots[slot].attachment == index; return result;
    });
}
AttachmentGeometry RuntimePlayer::query_attachment_geometry(std::string_view id) const {
    return detail::operation("queryAttachmentGeometry", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::attachment, id, "queryAttachmentGeometry", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame); const auto& a = pose.model().attachments[index];
        AttachmentGeometry result; result.attachment_id = id;
        switch (a.kind) {
            case detail::AttachmentKind::path: result.kind = AttachmentGeometryKind::path; result.closed = a.closed; break;
            case detail::AttachmentKind::bounding_box: result.kind = AttachmentGeometryKind::bounding_box; break;
            case detail::AttachmentKind::clipping: result.kind = AttachmentGeometryKind::clipping; break;
            default: throw Error(ErrorCode::invalid_argument, "queryAttachmentGeometry", "Attachment has no non-renderable vertex geometry.", "attachmentId", std::string(id));
        }
        pose.source_vertices(index, result.world_vertices_xy); return result;
    });
}
}
