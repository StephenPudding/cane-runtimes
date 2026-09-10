#include "state.hpp"
#include "constraint_parameters.hpp"
#include <limits>
#include <type_traits>

namespace cane {
namespace {
using K = animation::ConstraintKind;
void finite(float value, const char* op, std::string_view id, const char* field) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, op, "Constraint query value is non-finite.", field, std::string(id));
}
void finite(std::optional<float> value, const char* op, std::string_view id, const char* field) { if (value) finite(*value, op, id, field); }
void point_finite(Point value, const char* op, std::string_view id, const char* field) { finite(value.x, op, id, field); finite(value.y, op, id, field); }
std::uint32_t count(std::size_t value, std::string_view id) {
    if (value > std::numeric_limits<std::uint32_t>::max()) throw Error(ErrorCode::resource_limit, "queryConstraintState", "Diagnostic count exceeds u32.", "diagnostic.drivenBoneCount", std::string(id));
    return static_cast<std::uint32_t>(value);
}
ConstraintDiagnostic diagnostic(K kind, const constraints::Diagnostic& source, std::string_view id) {
    const auto same_kind = [&](K expected) { if (kind != expected) throw Error(ErrorCode::invalid_state, "queryConstraintState", "Sampled diagnostic kind differs from its constraint.", "diagnostic", std::string(id)); };
    const auto check = [&](auto value) { finite(value, "queryConstraintState", id, "diagnostic"); };
    return std::visit([&](const auto& d) -> ConstraintDiagnostic {
        using T = std::decay_t<decltype(d)>;
        if constexpr (std::is_same_v<T, std::monostate>) return std::monostate{};
        else if constexpr (std::is_same_v<T, constraints::IkDiagnostic>) {
            same_kind(K::ik); check(d.residual); check(d.threshold); check(d.mix);
            return IkConstraintDiagnostic{d.residual, d.threshold, d.mix, d.iterations_used, d.iteration_limit, d.saturated};
        } else if constexpr (std::is_same_v<T, constraints::TransformDiagnostic>) {
            same_kind(K::transform); for (const float v : d.mixes) check(v);
            check(d.translation_residual); check(d.rotation_residual); check(d.scale_residual); check(d.shear_residual);
            return TransformConstraintDiagnostic{count(d.driven, id), d.mixes, d.translation_residual, d.rotation_residual, d.scale_residual, d.shear_residual};
        } else if constexpr (std::is_same_v<T, constraints::PathDiagnostic>) {
            same_kind(K::path); check(d.mix_rotate); check(d.mix_x); check(d.mix_y); check(d.translation_residual); check(d.rotation_residual); check(d.scale_residual);
            return PathConstraintDiagnostic{count(d.driven, id), d.mix_rotate, d.mix_x, d.mix_y, d.translation_residual, d.rotation_residual, d.scale_residual};
        } else if constexpr (std::is_same_v<T, constraints::PhysicsDiagnostic>) {
            same_kind(K::physics);
            for (const float v : {d.translation_offset, d.translation_speed, d.rotation_offset_degrees, d.angular_speed_degrees, d.scale_offset, d.scale_speed, d.configured_limit}) check(v);
            check(d.required_limit);
            return PhysicsConstraintDiagnostic{d.fixed_steps, d.translation_offset, d.translation_speed, d.rotation_offset_degrees, d.angular_speed_degrees, d.scale_offset, d.scale_speed, d.configured_limit, d.required_limit, d.limit_saturated};
        } else {
            same_kind(K::slider); check(d.source_value); check(d.mapped_time); check(d.resolved_time); check(d.duration);
            return SliderConstraintDiagnostic{d.source_value, d.mapped_time, d.resolved_time, d.duration, d.wrapped, d.clamped};
        }
    }, source);
}
std::size_t constraint(const detail::RuntimePlayerImpl& player, std::string_view id, const char* op, K kind) {
    const auto index = player.index(RuntimeCatalogKind::constraint, id, op, nullptr);
    const auto& pose = detail::RuntimeFrameAccess::pose(*player.state->frame);
    if (pose.model().constraints[index].kind != kind) throw Error(ErrorCode::invalid_argument, op, "Constraint has the wrong kind for this query.", "constraintId", std::string(id));
    return index;
}
constraints::PathSampler active_path(const animation::Pose& pose, std::size_t index, const char* op, std::string_view id) {
    const auto& definition = std::get<detail::PathDefinition>(pose.model().constraints[index].definition);
    const auto selected = pose.slots[definition.target_slot].attachment;
    if (!selected || pose.model().attachments[*selected].kind != detail::AttachmentKind::path)
        throw Error(ErrorCode::invalid_state, op, "The target slot has no current Path attachment.", "targetSlotId", std::string(id));
    const auto& attachment = pose.model().attachments[*selected]; std::vector<float> vertices;
    pose.source_vertices(*selected, vertices); constraints::PathSampler path;
    path.reset(vertices, attachment.closed, attachment.constant_speed, attachment.lengths);
    finite(path.length(), op, id, "pathLength");
    if (!path.available()) throw Error(ErrorCode::invalid_state, op, "Current Path has no positive length.", "pathLength", std::string(id));
    return path;
}
}
ConstraintState RuntimePlayer::query_constraint_state(std::string_view id) const {
    return detail::operation("queryConstraintState", [&] {
        const auto& p = impl(); const auto index = p.index(RuntimeCatalogKind::constraint, id, "queryConstraintState", nullptr);
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        if (index >= pose.constraints.size() || index >= pose.diagnostics.size()) throw Error(ErrorCode::invalid_state, "queryConstraintState", "Constraint has no sampled state.", {}, std::string(id));
        const auto kind = pose.model().constraints[index].kind;
        try {
            auto parameters = detail::project_constraint_parameters(kind, pose.constraints[index]); auto output = diagnostic(kind, pose.diagnostics[index], id);
            std::optional<float> slider_time;
            if (const auto* slider = std::get_if<SliderConstraintDiagnostic>(&output)) slider_time = slider->resolved_time;
            return ConstraintState{std::string(id), detail::public_constraint_kind(kind), std::move(parameters), slider_time, std::move(output)};
        } catch (const Error& e) { throw Error(e.code, e.operation, e.what(), e.field, std::string(id), e.detail); }
    });
}
PathConstraintPosition RuntimePlayer::query_path_constraint_position(std::string_view id) const {
    constexpr auto op = "queryPathConstraintPosition";
    return detail::operation(op, [&] {
        const auto& p = impl(); const auto index = constraint(p, id, op, K::path); const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame);
        const auto path = active_path(pose, index, op, id);
        const auto& definition = std::get<detail::PathDefinition>(pose.model().constraints[index].definition);
        const auto distance = pose.constraints[index][animation::ConstraintProperty::position] * (definition.position_mode == detail::PositionMode::percent ? path.length() : 1);
        finite(distance, op, id, "position"); const auto at = path.at(distance), start = path.at(0), end = path.at(path.length());
        if (!at || !start || !end) throw Error(ErrorCode::invalid_state, op, "Current Path sample is unavailable.", "position", std::string(id));
        point_finite(at->position, op, id, "point"); finite(at->tangent, op, id, "tangentDegrees"); point_finite(start->position, op, id, "pathStart"); point_finite(end->position, op, id, "pathEnd");
        return PathConstraintPosition{std::string(id), at->position, at->tangent, distance, path.length(), start->position, end->position, path.closed()};
    });
}
float RuntimePlayer::query_path_constraint_position_for_world_target(std::string_view id, Point target) const {
    constexpr auto op = "queryPathConstraintPositionForWorldTarget";
    return detail::operation(op, [&] {
        const auto& p = impl(); const auto index = constraint(p, id, op, K::path); point_finite(target, op, id, "targetWorld");
        const auto& pose = detail::RuntimeFrameAccess::pose(*p.state->frame); const auto path = active_path(pose, index, op, id); const auto distance = path.project_distance(target);
        if (!distance) throw Error(ErrorCode::invalid_state, op, "Current Path has no finite projection candidate.", {}, std::string(id));
        const auto& definition = std::get<detail::PathDefinition>(pose.model().constraints[index].definition);
        const auto result = *distance / (definition.position_mode == detail::PositionMode::percent ? path.length() : 1);
        finite(result, op, id, "position"); return result;
    });
}
TransformConstraintOffsets RuntimePlayer::query_matched_transform_constraint_offsets(std::string_view id) const {
    constexpr auto op = "queryMatchedTransformConstraintOffsets";
    return detail::operation(op, [&] {
        const auto& p = impl(); const auto index = constraint(p, id, op, K::transform);
        auto detached = detail::RuntimeFrameAccess::pose(*p.state->frame); constraints::Workspace scratch(detached.locals.size());
        constraints::Context context{detached, p.state->host.root, scratch}; ErrorCode failure = ErrorCode::invalid_state;
        const auto values = constraints::matched_transform_offsets(context, index, &failure);
        if (!values) throw Error(failure, op, "Canonical Transform Match is unavailable for the current sampled pose.", {}, std::string(id));
        const auto& v = *values; return TransformConstraintOffsets{std::string(id), v[0], v[1], v[2], v[3], v[4], v[5]};
    });
}
}
