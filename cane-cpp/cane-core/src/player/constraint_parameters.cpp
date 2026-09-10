#include "constraint_parameters.hpp"
#include "state.hpp"
#include <limits>
#include <type_traits>

namespace cane::detail {
ConstraintKind public_constraint_kind(animation::ConstraintKind kind) {
    switch (kind) {
        case animation::ConstraintKind::ik: return ConstraintKind::ik;
        case animation::ConstraintKind::transform: return ConstraintKind::transform;
        case animation::ConstraintKind::path: return ConstraintKind::path;
        case animation::ConstraintKind::physics: return ConstraintKind::physics;
        case animation::ConstraintKind::slider: return ConstraintKind::slider;
    }
    throw Error(ErrorCode::invalid_state, "queryConstraintState", "Unknown compiled constraint kind.");
}
ConstraintKind override_kind(const ConstraintOverride& parameters) {
    return std::visit([](const auto& value) {
        using T = std::decay_t<decltype(value)>;
        if constexpr (std::is_same_v<T, IkConstraintOverride>) return ConstraintKind::ik;
        else if constexpr (std::is_same_v<T, TransformConstraintOverride>) return ConstraintKind::transform;
        else if constexpr (std::is_same_v<T, PathConstraintOverride>) return ConstraintKind::path;
        else if constexpr (std::is_same_v<T, PhysicsConstraintOverride>) return ConstraintKind::physics;
        else return ConstraintKind::slider;
    }, parameters);
}
void apply_constraint_override(ConstraintParameters& sampled, const ConstraintOverride& parameters, const char* op) {
    using P = animation::ConstraintProperty;
    const auto write = [&](float& target, std::optional<float> value, const char* field, float minimum = -std::numeric_limits<float>::max(), float maximum = std::numeric_limits<float>::max()) {
        if (!value) return;
        require_finite(*value, op, field);
        if (*value < minimum || *value > maximum) throw Error(ErrorCode::invalid_argument, op, "Constraint parameter is outside its permitted range.", field);
        target = *value;
    };
    std::visit([&](const auto& value) {
        using T = std::decay_t<decltype(value)>;
        if constexpr (std::is_same_v<T, IkConstraintOverride>) {
            if (value.target) {
                write(sampled[P::target_x], value.target->x, "parameters.target.x"); write(sampled[P::target_y], value.target->y, "parameters.target.y");
                sampled.explicit_ik_target = true;
            }
            write(sampled[P::mix], value.mix, "parameters.mix", 0, 1); write(sampled[P::softness], value.softness, "parameters.softness", 0);
            if (value.bend_positive) sampled.booleans[0] = *value.bend_positive;
            if (value.compress) sampled.booleans[1] = *value.compress;
            if (value.stretch) sampled.booleans[2] = *value.stretch;
        } else if constexpr (std::is_same_v<T, TransformConstraintOverride>) {
            const std::array<std::optional<float>, 6> offsets{value.rotation_degrees, value.x, value.y, value.scale_x, value.scale_y, value.shear_y_degrees};
            const std::array<std::optional<float>, 6> mixes{value.mix_rotate, value.mix_x, value.mix_y, value.mix_scale_x, value.mix_scale_y, value.mix_shear_y};
            constexpr std::array<const char*, 6> fields{"parameters.rotationDegrees", "parameters.x", "parameters.y", "parameters.scaleX", "parameters.scaleY", "parameters.shearYDegrees"};
            constexpr std::array<const char*, 6> mix_fields{"parameters.mixRotate", "parameters.mixX", "parameters.mixY", "parameters.mixScaleX", "parameters.mixScaleY", "parameters.mixShearY"};
            for (std::size_t i = 0; i < 6; ++i) { write(sampled.transform_offsets[i], offsets[i], fields[i]); write(sampled.scalars[static_cast<std::size_t>(P::mix_rotate) + i], mixes[i], mix_fields[i]); }
        } else if constexpr (std::is_same_v<T, PathConstraintOverride>) {
            write(sampled.path_rotation, value.rotation_degrees, "parameters.rotationDegrees"); write(sampled[P::position], value.position, "parameters.position"); write(sampled[P::spacing], value.spacing, "parameters.spacing");
            write(sampled[P::mix_rotate], value.mix_rotate, "parameters.mixRotate", 0, 1); write(sampled[P::mix_x], value.mix_x, "parameters.mixX", 0, 1); write(sampled[P::mix_y], value.mix_y, "parameters.mixY", 0, 1);
        } else if constexpr (std::is_same_v<T, PhysicsConstraintOverride>) {
            auto& physics = sampled.physics;
            write(physics.x, value.x, "parameters.x", 0, 1); write(physics.y, value.y, "parameters.y", 0, 1); write(physics.rotate, value.rotate, "parameters.rotate", 0, 1);
            write(physics.scale_x, value.scale_x, "parameters.scaleX", 0, 1); write(physics.shear_x, value.shear_x, "parameters.shearX", 0, 1); write(physics.limit, value.limit, "parameters.limit", 0);
            if (value.fps) { if (*value.fps == 0) throw Error(ErrorCode::invalid_argument, op, "Physics FPS must be a positive u32.", "parameters.fps"); physics.fps = *value.fps; }
            write(sampled[P::inertia], value.inertia, "parameters.inertia", 0, 1); write(sampled[P::strength], value.strength, "parameters.strength", 0);
            write(sampled[P::damping], value.damping, "parameters.damping", 0, 1); write(sampled[P::mass], value.mass, "parameters.mass", std::numeric_limits<float>::denorm_min());
            write(sampled[P::wind], value.wind, "parameters.wind"); write(sampled[P::gravity], value.gravity, "parameters.gravity"); write(sampled[P::mix], value.mix, "parameters.mix", 0, 1);
        } else {
            write(sampled.slider.source_offset, value.source_offset, "parameters.sourceOffset"); write(sampled.slider.time_offset, value.time_offset, "parameters.timeOffset"); write(sampled.slider.time_scale, value.time_scale, "parameters.timeScale");
            write(sampled.slider.range_max, value.range_max, "parameters.rangeMax", 0); write(sampled[P::slider_time], value.time, "parameters.time"); write(sampled[P::mix], value.mix, "parameters.mix");
        }
    }, parameters);
}
cane::ConstraintParameters project_constraint_parameters(animation::ConstraintKind kind, const ConstraintParameters& p) {
    using P = animation::ConstraintProperty;
    // Validate the owned sampled record before exposing any part of the query result.
    for (const auto value : p.scalars) require_finite(value, "queryConstraintState", "sampledParameters");
    for (const auto value : p.transform_offsets) require_finite(value, "queryConstraintState", "sampledParameters");
    for (const auto value : {p.path_rotation, p.physics.x, p.physics.y, p.physics.rotate, p.physics.scale_x, p.physics.shear_x, p.physics.limit,
                           p.slider.source_offset, p.slider.time_offset, p.slider.time_scale, p.slider.range_max}) require_finite(value, "queryConstraintState", "sampledParameters");
    if (!std::isfinite(p.physics.fps)) throw Error(ErrorCode::non_finite, "queryConstraintState", "Sampled Physics FPS is non-finite.", "sampledParameters.fps");
    switch (kind) {
        case animation::ConstraintKind::ik: return IkConstraintParameters{{p[P::target_x], p[P::target_y]}, p[P::mix], p[P::softness], p.booleans[0], p.booleans[1], p.booleans[2]};
        case animation::ConstraintKind::transform: {
            const auto& o = p.transform_offsets;
            return TransformConstraintParameters{o[0], o[1], o[2], o[3], o[4], o[5], p[P::mix_rotate], p[P::mix_x], p[P::mix_y], p[P::mix_scale_x], p[P::mix_scale_y], p[P::mix_shear_y]};
        }
        case animation::ConstraintKind::path: return PathConstraintParameters{p.path_rotation, p[P::position], p[P::spacing], p[P::mix_rotate], p[P::mix_x], p[P::mix_y]};
        case animation::ConstraintKind::physics: return PhysicsConstraintParameters{p.physics.x, p.physics.y, p.physics.rotate, p.physics.scale_x, p.physics.shear_x, p.physics.limit, p.physics.fps,
            p[P::inertia], p[P::strength], p[P::damping], p[P::mass], p[P::wind], p[P::gravity], p[P::mix]};
        case animation::ConstraintKind::slider: return SliderConstraintParameters{p.slider.source_offset, p.slider.time_offset, p.slider.time_scale, p.slider.range_max, p[P::slider_time], p[P::mix]};
    }
    throw Error(ErrorCode::invalid_state, "queryConstraintState", "Unknown compiled constraint kind.");
}
}
