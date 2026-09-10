#include "state.hpp"
#include "runtime_data_internal.hpp"
#include <set>

namespace cane {
namespace {
using detail::PlayerState;
using animation::EventSink;
void host(detail::RuntimePlayerImpl& p, const char* op, const std::function<void(detail::HostState&)>& edit) {
    p.configure(op, [&](PlayerState& s, EventSink&, EventSink&) { edit(s.host); });
}
std::size_t physics_constraint(const detail::RuntimePlayerImpl& p, std::string_view id, const char* op) {
    const auto index = p.index(RuntimeCatalogKind::constraint, id, op, "constraintId");
    if (detail::RuntimeDataAccess::get(p.data()).model.constraints[index].kind != animation::ConstraintKind::physics)
        throw Error(ErrorCode::invalid_argument, op, "Constraint must be Physics.", "constraintId", std::string(id));
    return index;
}
constraints::PhysicsHostMotion motion_mode(PhysicsHostMotion motion) {
    switch (motion) {
        case PhysicsHostMotion::move: return constraints::PhysicsHostMotion::move;
        case PhysicsHostMotion::teleport: return constraints::PhysicsHostMotion::teleport;
        case PhysicsHostMotion::preserve_inertia: return constraints::PhysicsHostMotion::preserve_inertia;
        case PhysicsHostMotion::clear_inertia: return constraints::PhysicsHostMotion::clear_inertia;
    }
    throw Error(ErrorCode::invalid_argument, "setRootTransform", "Unknown Physics host motion mode.", "physicsMode");
}
}
void RuntimePlayer::set_skins(const std::vector<std::string>& ids) {
    auto& p = impl(); host(p, "setSkins", [&](detail::HostState& h) {
        std::vector<std::size_t> skins; skins.reserve(ids.size()); std::set<std::size_t> unique;
        for (const auto& id : ids) {
            const auto index = p.index(RuntimeCatalogKind::skin, id, "setSkins", "skinIds");
            if (!unique.insert(index).second) throw Error(ErrorCode::invalid_argument, "setSkins", "Skin IDs must be unique.", "skinIds", id);
            skins.push_back(index);
        }
        h.skins = std::move(skins);
    });
}
void RuntimePlayer::set_root_transform(const RegionLocal& value, PhysicsHostMotion motion, std::optional<std::string_view> constraint_id) {
    auto& p = impl(); p.configure("setRootTransform", [&](PlayerState& s, EventSink&, EventSink&) {
        const auto local = detail::bone_local(value); detail::validate_local(local, "setRootTransform", "rootTransform");
        const auto next = Affine::from_local(local);
        if (!next.finite()) throw Error(ErrorCode::non_finite, "setRootTransform", "Root transform overflowed.", "rootTransform");
        const auto mode = motion_mode(motion);
        const auto target = constraint_id ? std::optional<std::size_t>(physics_constraint(p, *constraint_id, "setRootTransform")) : std::nullopt;
        s.physics.host_motion(detail::RuntimeFrameAccess::pose(*s.frame), s.host.root, next, mode, target);
        s.host.root_local = value; s.host.root = next;
    });
}
RegionLocal RuntimePlayer::root_transform() const { return impl().state->host.root_local; }
void RuntimePlayer::set_physics_environment(const PhysicsEnvironment& value) {
    host(impl(), "setPhysicsEnvironment", [&](detail::HostState& h) {
        for (const float scalar : {value.wind_x, value.wind_y, value.gravity_x, value.gravity_y}) detail::require_finite(scalar, "setPhysicsEnvironment", "environment");
        h.environment = value;
    });
}
void RuntimePlayer::reset_physics() { impl().configure("resetPhysics", [](PlayerState& s, EventSink&, EventSink&) { (void)s.physics.reset(); }); }
bool RuntimePlayer::reset_physics_constraint(std::string_view id) {
    auto& p = impl(); const auto index = physics_constraint(p, id, "resetPhysicsConstraint"); const bool had = p.state->physics.state(index).has_value();
    p.configure("resetPhysicsConstraint", [&](PlayerState& s, EventSink&, EventSink&) { (void)s.physics.reset(index); }); return had;
}
void RuntimePlayer::set_bone_local_override(std::string_view id, const BoneOverride& value) {
    (void)apply_authoring({{SetBoneLocalOverride{std::string(id), value}}}, {}, "setBoneLocalOverride");
}
void RuntimePlayer::clear_bone_local_override(std::string_view id) {
    (void)apply_authoring({{ClearBoneLocalOverride{std::string(id)}}}, {}, "clearBoneLocalOverride");
}
void RuntimePlayer::set_region_pose_override(std::string_view id, const RegionLocal& value) {
    (void)apply_authoring({{SetRegionPoseOverride{std::string(id), value}}}, {}, "setRegionPoseOverride");
}
void RuntimePlayer::clear_region_pose_override(std::string_view id) {
    (void)apply_authoring({{ClearRegionPoseOverride{std::string(id)}}}, {}, "clearRegionPoseOverride");
}
void RuntimePlayer::set_draw_order_override(const std::vector<std::string>& ids) {
    (void)apply_authoring({{SetDrawOrderOverride{ids}}}, {}, "setDrawOrderOverride");
}
void RuntimePlayer::clear_draw_order_override() { (void)apply_authoring({{ClearDrawOrderOverride{}}}, {}, "clearDrawOrderOverride"); }
void RuntimePlayer::set_slot_attachment_override(std::string_view id, std::optional<std::string_view> attachment) {
    (void)apply_authoring({{SetSlotAttachmentOverride{std::string(id), attachment ? std::optional<std::string>(*attachment) : std::nullopt}}}, {}, "setSlotAttachmentOverride");
}
void RuntimePlayer::clear_slot_attachment_override(std::string_view id) {
    (void)apply_authoring({{ClearSlotAttachmentOverride{std::string(id)}}}, {}, "clearSlotAttachmentOverride");
}
void RuntimePlayer::set_slot_tint_override(std::string_view id, const FinalTint& tint) {
    (void)apply_authoring({{SetSlotTintOverride{std::string(id), tint}}}, {}, "setSlotTintOverride");
}
void RuntimePlayer::clear_slot_tint_override(std::string_view id) {
    (void)apply_authoring({{ClearSlotTintOverride{std::string(id)}}}, {}, "clearSlotTintOverride");
}
}
