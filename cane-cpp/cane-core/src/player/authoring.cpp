#include "state.hpp"
#include "constraint_parameters.hpp"
#include "runtime_data_internal.hpp"
#include "geometry/deformation.hpp"
#include <type_traits>

namespace cane {
namespace {
void validate_mode(TransformMode value, const char* op) {
    switch (value) {
        case TransformMode::normal: case TransformMode::only_translation: case TransformMode::no_rotation_or_reflection:
        case TransformMode::no_scale: case TransformMode::no_scale_or_reflection: return;
    }
    throw Error(ErrorCode::invalid_argument, op, "Unknown bone inheritance mode.", "transformMode");
}
void stage(const detail::RuntimePlayerImpl& p, detail::HostState& host, const AuthoringOperation& operation, const char* op) {
    const auto& model = detail::RuntimeDataAccess::get(p.data()).model;
    std::visit([&](const auto& edit) {
        using T = std::decay_t<decltype(edit)>;
        if constexpr (std::is_same_v<T, SetBoneLocalOverride> || std::is_same_v<T, ClearBoneLocalOverride>) {
            const auto index = p.index(RuntimeCatalogKind::bone, edit.bone_id, op, "boneId");
            if constexpr (std::is_same_v<T, ClearBoneLocalOverride>) host.bones.erase(index);
            else { detail::validate_local(edit.value.local, op, "local"); if (edit.value.transform_mode) validate_mode(*edit.value.transform_mode, op); host.bones[index] = edit.value; }
        } else if constexpr (std::is_same_v<T, SetRegionPoseOverride> || std::is_same_v<T, ClearRegionPoseOverride>) {
            const auto index = p.index(RuntimeCatalogKind::attachment, edit.attachment_id, op, "attachmentId");
            if (model.attachments[index].kind != detail::AttachmentKind::region) throw Error(ErrorCode::invalid_argument, op, "Attachment must be a Region.", "attachmentId", edit.attachment_id);
            if constexpr (std::is_same_v<T, ClearRegionPoseOverride>) host.regions.erase(index);
            else { detail::validate_local(detail::bone_local(edit.value), op, "local"); host.regions[index] = edit.value; }
        } else if constexpr (std::is_same_v<T, SetDrawOrderOverride>) {
            if (edit.slot_ids.size() != model.slots.size()) throw Error(ErrorCode::invalid_argument, op, "Draw order must contain every slot exactly once.", "slotIds");
            std::vector<std::size_t> order; order.reserve(edit.slot_ids.size()); std::vector<bool> seen(model.slots.size());
            for (const auto& id : edit.slot_ids) {
                const auto index = p.index(RuntimeCatalogKind::slot, id, op, "slotIds");
                if (seen[index]) throw Error(ErrorCode::invalid_argument, op, "Draw order contains a duplicate slot.", "slotIds", id);
                seen[index] = true; order.push_back(index);
            }
            host.order = std::move(order);
        } else if constexpr (std::is_same_v<T, ClearDrawOrderOverride>) host.order.reset();
        else if constexpr (std::is_same_v<T, SetVertexDeformOverride> || std::is_same_v<T, ClearVertexDeformOverride>) {
            const auto index = p.index(RuntimeCatalogKind::attachment, edit.attachment_id, op, "attachmentId");
            const geometry::VertexSource source(detail::RuntimeFrameAccess::pose(*p.state->frame), index, op);
            if constexpr (std::is_same_v<T, ClearVertexDeformOverride>) host.deforms.erase(source.attachment().deform_owner);
            else host.deforms[source.attachment().deform_owner] = source.canonical(edit.space, edit.values, "values");
        } else if constexpr (std::is_same_v<T, SetSlotAttachmentOverride> || std::is_same_v<T, ClearSlotAttachmentOverride>) {
            const auto index = p.index(RuntimeCatalogKind::slot, edit.slot_id, op, "slotId");
            if constexpr (std::is_same_v<T, ClearSlotAttachmentOverride>) host.attachments.erase(index);
            else {
                if (edit.attachment_id) {
                    const auto attachment = p.index(RuntimeCatalogKind::attachment, *edit.attachment_id, op, "attachmentId");
                    if (model.attachments[attachment].slot != index) throw Error(ErrorCode::not_found, op, "Attachment is not owned by this slot.", "attachmentId", *edit.attachment_id);
                }
                host.attachments[index] = edit.attachment_id;
            }
        } else if constexpr (std::is_same_v<T, SetSlotTintOverride> || std::is_same_v<T, ClearSlotTintOverride>) {
            const auto index = p.index(RuntimeCatalogKind::slot, edit.slot_id, op, "slotId");
            if constexpr (std::is_same_v<T, ClearSlotTintOverride>) host.tints.erase(index);
            else { detail::require_nonnegative(edit.tint.alpha, op, "alpha"); if (edit.tint.alpha > 1) throw Error(ErrorCode::invalid_argument, op, "Alpha must be in 0..1.", "alpha"); host.tints[index] = edit.tint; }
        } else if constexpr (std::is_same_v<T, SetConstraintOverride> || std::is_same_v<T, ClearConstraintOverride>) {
            if (edit.constraint_id.empty()) throw Error(ErrorCode::invalid_argument, op, "Constraint ID must not be empty.", "constraintId");
            const auto index = p.index(RuntimeCatalogKind::constraint, edit.constraint_id, op, nullptr);
            if constexpr (std::is_same_v<T, ClearConstraintOverride>) host.constraints.erase(index);
            else {
                const auto& definition = model.constraints[index];
                if (detail::public_constraint_kind(definition.kind) != detail::override_kind(edit.parameters)) throw Error(ErrorCode::invalid_argument, op, "Override kind differs from the constraint.", "parameters.type", edit.constraint_id);
                auto checked = definition.setup;
                try { detail::apply_constraint_override(checked, edit.parameters, op); }
                catch (const Error& e) { throw Error(e.code, e.operation, e.what(), e.field, edit.constraint_id, e.detail); }
                host.constraints[index] = edit.parameters;
            }
        }
    }, operation);
}
}
RuntimeFrame RuntimePlayer::apply_authoring(const AuthoringOverrides& request, const SamplingOptions& options, const char* op) {
    return detail::operation(op, [&] {
        auto& p = impl(); const auto sequence = p.next_sequence(op); const auto sampling = detail::checked_sampling(options, op);
        if (request.operations.size() > 1000000) throw Error(ErrorCode::resource_limit, op, "Authoring batch exceeds 1,000,000 operations.", "operations");
        auto candidate = std::make_unique<detail::PlayerState>(*p.state);
        for (const auto& edit : request.operations) stage(p, candidate->host, edit, op);
        constraints::PhysicsBudget budget;
        p.publish(*candidate, p.evaluate(*candidate, budget, sampling, nullptr, op, nullptr, sequence), sequence);
        p.state.swap(candidate); return p.frame();
    });
}
RuntimeFrame RuntimePlayer::set_authoring_overrides(const AuthoringOverrides& request) { return apply_authoring(request, {}, "setAuthoringOverrides"); }
RuntimeFrame RuntimePlayer::set_authoring_overrides_with_sampling(const AuthoringOverrides& request, const SamplingOptions& sampling) {
    return apply_authoring(request, sampling, "setAuthoringOverridesWithSampling");
}
AuthoringSnapshot RuntimePlayer::query_authoring_snapshot() const {
    constexpr auto op = "queryAuthoringSnapshot";
    return detail::operation(op, [&] {
        AuthoringSnapshot result(frame()); const auto& p = impl(); const auto& data = p.data();
        result.bone_local_states.reserve(data.bones().size());
        result.slot_states.reserve(data.catalog(RuntimeCatalogKind::slot).size());
        result.constraint_states.reserve(data.catalog(RuntimeCatalogKind::constraint).size());
        for (const auto& bone : data.bones()) result.bone_local_states.push_back(query_bone_local_state(bone.id));
        for (const auto& slot : data.catalog(RuntimeCatalogKind::slot)) result.slot_states.push_back(query_slot_state(slot.id));
        for (const auto& constraint : data.catalog(RuntimeCatalogKind::constraint)) {
            result.constraint_states.push_back(query_constraint_state(constraint.id));
            if (result.constraint_states.back().kind == ConstraintKind::path) {
                try { result.path_constraint_positions.push_back(query_path_constraint_position(constraint.id)); }
                catch (const Error& e) { if (e.code != ErrorCode::invalid_state) throw; }
            }
        }
        const auto& model = detail::RuntimeDataAccess::get(data).model;
        const auto& attachments = data.catalog(RuntimeCatalogKind::attachment);
        for (std::size_t i = 0; i < attachments.size(); ++i) {
            const auto& id = attachments[i].id; const auto kind = model.attachments[i].kind;
            if (kind == detail::AttachmentKind::point) result.point_attachment_poses.push_back(query_point_attachment_pose(id));
            if (kind == detail::AttachmentKind::path || kind == detail::AttachmentKind::bounding_box || kind == detail::AttachmentKind::clipping) result.attachment_geometries.push_back(query_attachment_geometry(id));
            if (kind == detail::AttachmentKind::mesh || kind == detail::AttachmentKind::path || kind == detail::AttachmentKind::bounding_box || kind == detail::AttachmentKind::clipping) result.vertex_attachment_source_geometries.push_back(query_vertex_attachment_source_geometry(id));
        }
        return result;
    });
}
}
