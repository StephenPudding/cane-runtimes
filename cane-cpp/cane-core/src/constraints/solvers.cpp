#include "solvers.hpp"

namespace cane::constraints {
float x_angle(const Affine& m) noexcept { return static_cast<float>(std::atan2(static_cast<double>(m.b), m.a)) * radians_to_degrees; }
float y_angle(const Affine& m) noexcept { return static_cast<float>(std::atan2(static_cast<double>(m.d), m.c)) * radians_to_degrees; }
float x_scale(const Affine& m) noexcept { return cane::hypot(m.a, m.b); }
float y_scale(const Affine& m) noexcept { return cane::hypot(m.c, m.d); }
float world_shear_y(const Affine& m) noexcept { return constraint_degrees(static_cast<float>(std::atan2(static_cast<double>(-m.c), m.d)) * radians_to_degrees - x_angle(m)); }
Affine rotate_axes(const Affine& m, float degrees) noexcept {
    const auto radians = degrees * degrees_to_radians;
    const auto co = static_cast<float>(std::cos(static_cast<double>(radians))), si = static_cast<float>(std::sin(static_cast<double>(radians)));
    return {co * m.a - si * m.b, si * m.a + co * m.b, co * m.c - si * m.d, si * m.c + co * m.d, m.tx, m.ty};
}
std::optional<BoneLocal> reconstruct_local(const BoneLocal& previous, const Affine& world, const Affine& parent, TransformMode mode) {
    const auto inverse = parent.inverse(matrix_epsilon); if (!inverse) return {};
    const auto position = inverse->transform({world.tx, world.ty}); Affine axes; float rotation_base = 0;
    if (mode == TransformMode::normal) axes = *inverse * world;
    else if (mode == TransformMode::only_translation) axes = world;
    else if (mode == TransformMode::no_rotation_or_reflection) {
        const auto basis = Affine::child(parent, {}, mode).inverse(matrix_epsilon); if (!basis) return {};
        axes = *basis * world;
    } else {
        const auto desired = x_angle(world); auto rotation = previous.rotation_degrees;
        for (unsigned i = 0; i < 12; ++i) {
            auto probe = previous; probe.rotation_degrees = rotation; const auto current = Affine::child(parent, probe, mode);
            if (x_scale(current) <= .00001f) return {};
            const auto error = constraint_degrees(desired - x_angle(current)); if (std::abs(error) <= .0001f) break;
            probe.rotation_degrees = rotation + .01f;
            const auto derivative = constraint_degrees(x_angle(Affine::child(parent, probe, mode)) - x_angle(current)) / .01f;
            if (std::abs(derivative) <= .00001f) return {};
            rotation += std::clamp(error / derivative, -45.0f, 45.0f);
        }
        rotation_base = rotation; BoneLocal base; base.rotation_degrees = rotation;
        const auto basis = Affine::child(parent, base, mode); const auto inverted = basis.inverse(matrix_epsilon);
        if (x_scale(basis) <= .00001f || !inverted) return {};
        axes = *inverted * world;
    }
    const auto sign_x = previous.scale_x < 0 ? -1.0f : 1.0f, sign_y = previous.scale_y < 0 ? -1.0f : 1.0f;
    const auto scale_x = x_scale(axes) * sign_x, scale_y = y_scale(axes) * sign_y;
    if (std::abs(scale_x) <= matrix_epsilon || std::abs(scale_y) <= matrix_epsilon) return {};
    const auto rotation = static_cast<float>(std::atan2(static_cast<double>(axes.b * sign_x), axes.a * sign_x)) * radians_to_degrees - previous.shear_x_degrees;
    const auto angle_y = static_cast<float>(std::atan2(static_cast<double>(-axes.c * sign_y), axes.d * sign_y)) * radians_to_degrees;
    const BoneLocal local{position.x, position.y, constraint_degrees(rotation_base + rotation), scale_x, scale_y, previous.shear_x_degrees, constraint_degrees(angle_y - rotation)};
    return Affine::from_local(local).finite() ? std::optional<BoneLocal>(local) : std::nullopt;
}
Affine Context::parent(std::size_t bone) const {
    const auto index = pose.data().bones().at(bone).parent_index; return index ? pose.world[*index] : root;
}
Affine Context::compose(std::size_t bone, const BoneLocal& local) const {
    return pose.data().bones()[bone].parent_index ? Affine::child(parent(bone), local, pose.modes[bone]) : root * Affine::from_local(local);
}
void Context::refresh_descendants(std::size_t bone) {
    auto& affected = scratch.affected; std::fill(affected.begin(), affected.end(), 0); affected.at(bone) = 1;
    const auto& bones = pose.data().bones();
    for (std::size_t i = bone; i < bones.size(); ++i) {
        if (i != bone && bones[i].parent_index && affected[*bones[i].parent_index]) {
            affected[i] = 1; pose.world[i] = Affine::child(pose.world[*bones[i].parent_index], pose.locals[i], pose.modes[i]);
        }
        if (affected[i] && !pose.world[i].finite()) throw Error(ErrorCode::non_finite, "apply", "Constraint hierarchy is non-finite.", "bones", bones[i].id);
    }
}
void Context::write_local(std::size_t bone, const BoneLocal& local) { pose.locals[bone] = local; pose.world[bone] = compose(bone, local); refresh_descendants(bone); }
void Context::set_world(std::size_t bone, const Affine& world) {
    if (!world.finite()) throw Error(ErrorCode::non_finite, "apply", "Constraint world matrix is non-finite.", "bones", pose.data().bones()[bone].id);
    pose.world[bone] = world;
    const auto local = reconstruct_local(pose.locals[bone], world, parent(bone), pose.data().bones()[bone].parent_index ? pose.modes[bone] : TransformMode::normal);
    if (local) pose.locals[bone] = *local;
}
void Context::write_world(std::size_t bone, const Affine& world) { set_world(bone, world); refresh_descendants(bone); }
}
