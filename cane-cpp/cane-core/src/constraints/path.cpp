#include "solvers.hpp"

namespace cane::constraints {
namespace {
void include(std::optional<float>& residual, float value) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "apply", "Path diagnostic residual is non-finite.");
    residual = residual ? std::max(*residual, value) : value;
}
}
void solve_path(Context& context, std::size_t index) {
    using P = animation::ConstraintProperty;
    auto& pose = context.pose; auto& scratch = context.scratch;
    pose.diagnostics.at(index) = std::monostate{};
    const auto& d = std::get<detail::PathDefinition>(pose.model().constraints.at(index).definition);
    const auto& parameters = pose.constraints[index];
    const auto target_bone = pose.model().slots[d.target_slot].bone;
    if (!pose.active_constraints[index] || !pose.active_bones[target_bone]) return;
    const auto selected = pose.slots[d.target_slot].attachment;
    if (!selected || pose.model().attachments[*selected].kind != detail::AttachmentKind::path) return;
    const auto mr = std::clamp(parameters[P::mix_rotate], 0.0f, 1.0f);
    const auto mx = std::clamp(parameters[P::mix_x], 0.0f, 1.0f), my = std::clamp(parameters[P::mix_y], 0.0f, 1.0f);
    if (mr == 0 && mx == 0 && my == 0) return;
    const auto& attachment = pose.model().attachments[*selected];
    pose.source_vertices(*selected, scratch.path_vertices);
    auto& path = scratch.path; path.reset(scratch.path_vertices, attachment.closed, attachment.constant_speed, attachment.lengths);
    if (!path.available()) return;

    // No pose write occurs during this pass: every current matrix, including
    // ancestors and descendants in the same authored list, sees one snapshot.
    const auto& bones = pose.data().bones(); const auto count = d.bones.size();
    const auto tangent = d.rotate_mode == detail::RotateMode::tangent, chain_scale = d.rotate_mode == detail::RotateMode::chain_scale;
    const auto spacing_count = tangent && count != 0 ? count - 1 : count;
    const auto spaces_count = tangent ? count : count + 1; float total = 0;
    for (std::size_t i = 0; i < count; ++i) {
        const auto bone = d.bones[i]; scratch.path_lengths[bone] = std::max(bones[bone].length, 0.0f) * x_scale(pose.world[bone]);
        if (i < spacing_count) total += scratch.path_lengths[bone];
    }
    const auto spacing = parameters[P::spacing];
    auto distance = parameters[P::position] * (d.position_mode == detail::PositionMode::percent ? path.length() : 1);
    const auto offset = parameters.path_rotation != 0 && pose.world[target_bone].determinant() < 0 ? -parameters.path_rotation : parameters.path_rotation;
    auto& staged = scratch.path_desired; auto& driven = scratch.path_driven; std::fill(driven.begin(), driven.end(), 0);
    PathDiagnostic diagnostic; diagnostic.mix_rotate = mr; diagnostic.mix_x = mx; diagnostic.mix_y = my;
    std::optional<PathSample> previous;
    for (const auto bone : d.bones) {
        const auto setup_length = std::max(bones[bone].length, 0.0f), world_length = scratch.path_lengths[bone]; float increment = 0;
        switch (d.spacing_mode) {
            case detail::SpacingMode::length: increment = setup_length > 0 ? std::max(setup_length + spacing, 0.0f) * world_length / setup_length : spacing; break;
            case detail::SpacingMode::fixed: increment = setup_length > 0 ? spacing * world_length / setup_length : spacing; break;
            case detail::SpacingMode::percent: increment = spacing * path.length(); break;
            case detail::SpacingMode::proportional: increment = total > 0 ? (setup_length > 0 ? world_length : spacing) / total * spacing * path.length() : spacing * path.length() / static_cast<float>(std::max(spaces_count, std::size_t{1})); break;
        }
        const auto sample = previous ? previous : path.at(distance), next = path.at(distance + increment);
        previous.reset(); distance += increment;
        if (!sample || !next) continue;
        const auto point = sample->position, ahead = next->position; const auto current = pose.world[bone]; const auto old_angle = x_angle(current);
        const auto chain_angle = static_cast<float>(std::atan2(static_cast<double>(ahead.y - point.y), ahead.x - point.x)) * radians_to_degrees;
        const auto desired_angle = (tangent ? sample->tangent : chain_angle) + offset;
        const auto angle = old_angle + wrap_degrees(desired_angle - old_angle) * mr;
        auto scale_x = x_scale(current); const auto scale_y = y_scale(current);
        const auto target_length = cane::hypot(ahead.x - point.x, ahead.y - point.y);
        if (chain_scale && bones[bone].length != 0) scale_x += (target_length / std::abs(bones[bone].length) - scale_x) * mr;
        const auto shear_y = y_angle(current) - old_angle - 90;
        const auto desired = Affine::from_local({current.tx + (point.x - current.tx) * mx, current.ty + (point.y - current.ty) * my, angle, scale_x, scale_y, 0, shear_y});
        if (!desired.finite()) throw Error(ErrorCode::non_finite, "apply", "Path world matrix is non-finite.", "bones", bones[bone].id);
        staged[bone] = desired; driven[bone] = 1; ++diagnostic.driven;
        if (mx != 0 || my != 0) include(diagnostic.translation_residual, cane::hypot(mx == 0 ? 0 : desired.tx - point.x, my == 0 ? 0 : desired.ty - point.y));
        if (mr != 0) include(diagnostic.rotation_residual, std::abs(wrap_degrees(x_angle(desired) - desired_angle)));
        if (chain_scale && mr != 0 && bones[bone].length != 0) include(diagnostic.scale_residual, std::abs(x_scale(desired) - target_length / std::abs(bones[bone].length)));
        if (!tangent && !chain_scale && parameters.path_rotation == 0 && mr != 0) {
            const auto rotated = rotate_axes(current, wrap_degrees(chain_angle - old_angle));
            const Point tip{point.x + bones[bone].length * rotated.a, point.y + bones[bone].length * rotated.b};
            previous = PathSample{{ahead.x + (tip.x - ahead.x) * mr, ahead.y + (tip.y - ahead.y) * mr}, next->tangent};
        }
    }
    // Skeleton-order commit preserves every stored driven world, then recomposes
    // only affected non-driven descendants. Unrelated prior solver results survive.
    auto& affected = scratch.affected; std::fill(affected.begin(), affected.end(), 0);
    for (std::size_t bone = 0; bone < bones.size(); ++bone) {
        if (driven[bone]) { affected[bone] = 1; context.set_world(bone, staged[bone]); }
        else if (bones[bone].parent_index && affected[*bones[bone].parent_index]) {
            affected[bone] = 1; pose.world[bone] = context.compose(bone, pose.locals[bone]);
            if (!pose.world[bone].finite()) throw Error(ErrorCode::non_finite, "apply", "Path hierarchy is non-finite.", "bones", bones[bone].id);
        }
    }
    pose.diagnostics[index] = diagnostic;
}
}
