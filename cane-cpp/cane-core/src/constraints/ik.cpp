#include "solvers.hpp"

namespace cane::constraints {
namespace {
using P = animation::ConstraintProperty;
struct IkSolve {
    Context& context;
    const detail::IkDefinition& definition;
    const detail::ConstraintParameters& parameters;
    float mix;
    [[nodiscard]] Point tip(std::size_t bone) const { return context.pose.world[bone].transform({context.pose.data().bones()[bone].length, 0}); }
    [[nodiscard]] float scale_y(float current, float multiplier) const {
        if (definition.uniform == detail::ScaleYMode::none) return current;
        if (definition.uniform == detail::ScaleYMode::uniform) return current * multiplier;
        return current / (multiplier < .7f ? .25f + .642857f * multiplier : multiplier);
    }
    [[nodiscard]] bool one(std::size_t bone, Point target) {
        const auto inverse = context.parent(bone).inverse(matrix_epsilon); if (!inverse) return false;
        auto& pose = context.pose; const auto current = pose.locals[bone]; const auto local = inverse->transform(target);
        const auto x = local.x - current.x, y = local.y - current.y, distance = cane::hypot(x, y);
        if (distance <= .001f) return false;
        auto desired = static_cast<float>(std::atan2(static_cast<double>(y), x)) * radians_to_degrees - current.shear_x_degrees;
        if (current.scale_x < 0) desired = constraint_degrees(desired + 180);
        auto next = current; next.rotation_degrees = constraint_degrees(current.rotation_degrees + constraint_degrees(desired - current.rotation_degrees) * mix);
        const auto length = std::abs(pose.data().bones()[bone].length * current.scale_x);
        if (length > .001f && ((parameters.booleans[1] && distance < length) || (parameters.booleans[2] && distance > length))) {
            const auto multiplier = (distance / length - 1) * mix + 1;
            next.scale_x = current.scale_x * multiplier; next.scale_y = scale_y(current.scale_y, multiplier);
        }
        pose.locals[bone] = next; pose.update_world(context.root); return true;
    }
    [[nodiscard]] float inherited_rotation(std::size_t bone) const {
        const auto& pose = context.pose; if (!pose.data().bones()[bone].parent_index) return x_angle(context.root);
        const auto mode = pose.modes[bone]; return mode == TransformMode::only_translation || mode == TransformMode::no_rotation_or_reflection ? 0 : x_angle(context.parent(bone));
    }
    [[nodiscard]] bool two(std::size_t parent, std::size_t child, Point target) {
        auto& pose = context.pose; auto p = pose.locals[parent], c = pose.locals[child];
        const bool uniform = std::abs(std::abs(p.scale_x) - std::abs(p.scale_y)) <= .000001f;
        p.shear_x_degrees = p.shear_y_degrees = 0;
        if (!uniform || parameters.booleans[2]) c.y = 0;
        pose.locals[parent] = p; pose.locals[child] = c; pose.update_world(context.root);
        const auto wp = pose.world[parent], wc = pose.world[child]; const auto end = tip(child);
        const auto x1 = wc.tx - wp.tx, y1 = wc.ty - wp.ty, x2 = end.x - wc.tx, y2 = end.y - wc.ty;
        auto l1 = cane::hypot(x1, y1), l2 = cane::hypot(x2, y2);
        if (l1 <= .001f || l2 <= .001f) return one(parent, target);
        const auto parent_offset = constraint_degrees(static_cast<float>(std::atan2(static_cast<double>(y1), x1)) * radians_to_degrees - x_angle(wp));
        const auto child_offset = constraint_degrees(static_cast<float>(std::atan2(static_cast<double>(y2), x2)) * radians_to_degrees - x_angle(wc));
        auto qx = target.x - wp.tx, qy = target.y - wp.ty, distance = cane::hypot(qx, qy); const auto softness = parameters[P::softness];
        if (distance <= .001f) return false;
        if (softness > .000001f) {
            const auto scale = std::max((std::abs(x_scale(wp)) + std::abs(x_scale(wc))) * .5f, .000001f);
            const auto soft = softness * scale, delta = distance - l1 - l2 + soft;
            if (delta > 0) {
                auto progress = std::min(delta / (soft * 2), 1.0f) - 1;
                progress = (delta - soft * (1 - progress * progress)) / distance;
                qx -= progress * qx; qy -= progress * qy; distance = cane::hypot(qx, qy);
            }
        }
        const bool inherits = pose.modes[child] == TransformMode::normal || pose.modes[child] == TransformMode::no_rotation_or_reflection;
        const auto maximum = l1 + l2, minimum = std::abs(l1 - l2); float request = 0;
        if (parameters.booleans[2] && uniform && softness <= 0 && distance > maximum + .000001f) request = inherits ? distance / maximum : (distance - l2) / l1;
        else if (parameters.booleans[1] && distance < minimum - .000001f) request = inherits ? distance / minimum : l1 >= l2 ? (distance + l2) / l1 : (l2 - distance) / l1;
        if (std::isfinite(request) && request > .000001f) {
            const auto multiplier = (request - 1) * mix + 1;
            p.scale_x *= multiplier; p.scale_y = scale_y(p.scale_y, multiplier); l1 *= multiplier; if (inherits) l2 *= multiplier;
        }
        distance = std::max(distance, .001f);
        const auto cosine = std::clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1.0f, 1.0f);
        const auto angle_child = static_cast<float>(std::acos(static_cast<double>(cosine))) * (parameters.booleans[0] ? 1.0f : -1.0f);
        const auto sin_child = static_cast<float>(std::sin(static_cast<double>(angle_child))), cos_child = static_cast<float>(std::cos(static_cast<double>(angle_child)));
        const auto angle_parent = static_cast<float>(std::atan2(static_cast<double>(qy), qx)) - static_cast<float>(std::atan2(static_cast<double>(l2 * sin_child), l1 + l2 * cos_child));
        auto desired = constraint_degrees(constraint_degrees(angle_parent * radians_to_degrees - parent_offset) - inherited_rotation(parent));
        p.rotation_degrees = constraint_degrees(p.rotation_degrees + constraint_degrees(desired - p.rotation_degrees) * mix);
        pose.locals[parent] = p; pose.update_world(context.root);
        desired = constraint_degrees(constraint_degrees((angle_parent + angle_child) * radians_to_degrees - child_offset) - inherited_rotation(child));
        c.rotation_degrees = constraint_degrees(c.rotation_degrees + constraint_degrees(desired - c.rotation_degrees) * mix);
        pose.locals[child] = c; pose.update_world(context.root); return true;
    }
    [[nodiscard]] std::uint32_t ccd(Point target) {
        auto& pose = context.pose; const auto& chain = definition.bones; auto& before = context.scratch.rotations;
        for (std::size_t i = 0; i < chain.size(); ++i) before[i] = pose.locals[chain[i]].rotation_degrees;
        const auto last = chain.back(); const auto threshold = std::max(0.0f, definition.threshold); std::uint32_t used = 0;
        const auto reached = [&] { const auto p = tip(last); return cane::hypot(p.x - target.x, p.y - target.y) <= threshold; };
        for (std::uint32_t iteration = 0; iteration < definition.iterations; ++iteration) {
            if (reached()) break;
            used = iteration + 1; bool changed = false, done = false;
            for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
                const auto bone = *it; const auto pivot = pose.world[bone]; const auto end = tip(last);
                const auto fx = end.x - pivot.tx, fy = end.y - pivot.ty, tx = target.x - pivot.tx, ty = target.y - pivot.ty;
                if (fx * fx + fy * fy <= .000001f || tx * tx + ty * ty <= .000001f) continue;
                const auto delta = static_cast<float>(std::atan2(static_cast<double>(fx * ty - fy * tx), fx * tx + fy * ty)) * radians_to_degrees;
                if (std::abs(delta) <= .00001f) continue;
                pose.locals[bone].rotation_degrees += delta; pose.update_world(context.root); changed = true;
                if (reached()) { done = true; break; }
            }
            if (done || !changed) break;
        }
        if (mix < 1) {
            for (std::size_t i = 0; i < chain.size(); ++i) pose.locals[chain[i]].rotation_degrees = before[i] + constraint_degrees(pose.locals[chain[i]].rotation_degrees - before[i]) * mix;
            pose.update_world(context.root);
        }
        return used;
    }
};
}
void solve_ik(Context& context, std::size_t index) {
    auto& pose = context.pose; pose.diagnostics.at(index) = std::monostate{};
    const auto& definition = std::get<detail::IkDefinition>(pose.model().constraints.at(index).definition); const auto& values = pose.constraints[index];
    const auto target_bone = values.explicit_ik_target ? std::nullopt : definition.target;
    if (!pose.active_constraints[index] || (target_bone && !pose.active_bones[*target_bone])) return;
    const auto target = target_bone ? Point{pose.world[*target_bone].tx, pose.world[*target_bone].ty} : Point{values[P::target_x], values[P::target_y]};
    const auto mix = std::clamp(values[P::mix], 0.0f, 1.0f); IkSolve solver{context, definition, values, mix}; std::uint32_t used = 0;
    if (mix != 0) {
        if (definition.bones.size() == 1 && solver.one(definition.bones[0], target)) used = 1;
        else if (definition.bones.size() == 2 && solver.two(definition.bones[0], definition.bones[1], target)) used = 1;
        else used = solver.ccd(target);
    }
    const auto end = solver.tip(definition.bones.back()); const auto residual = cane::hypot(end.x - target.x, end.y - target.y);
    if (!std::isfinite(residual)) throw Error(ErrorCode::non_finite, "apply", "IK residual is non-finite.", "constraints", pose.data().catalog(RuntimeCatalogKind::constraint)[index].id);
    const auto threshold = std::max(0.0f, definition.threshold);
    pose.diagnostics[index] = IkDiagnostic{residual, threshold, mix, used, definition.iterations, mix >= .999f && residual > std::max(threshold, .0001f)};
}
}
