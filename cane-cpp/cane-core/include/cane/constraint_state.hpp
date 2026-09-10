#pragma once
#include "math.hpp"
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <variant>

namespace cane {
enum class ConstraintKind { ik, transform, path, physics, slider };
struct IkConstraintOverride {
    std::optional<Point> target;
    std::optional<float> mix, softness;
    std::optional<bool> bend_positive, compress, stretch;
};
struct TransformConstraintOverride {
    std::optional<float> rotation_degrees, x, y, scale_x, scale_y, shear_y_degrees;
    std::optional<float> mix_rotate, mix_x, mix_y, mix_scale_x, mix_scale_y, mix_shear_y;
};
struct PathConstraintOverride {
    std::optional<float> rotation_degrees, position, spacing, mix_rotate, mix_x, mix_y;
};
struct PhysicsConstraintOverride {
    std::optional<float> x, y, rotate, scale_x, shear_x, limit;
    std::optional<std::uint32_t> fps;
    std::optional<float> inertia, strength, damping, mass, wind, gravity, mix;
};
struct SliderConstraintOverride {
    std::optional<float> source_offset, time_offset, time_scale, range_max, time, mix;
};
using ConstraintOverride = std::variant<IkConstraintOverride, TransformConstraintOverride, PathConstraintOverride, PhysicsConstraintOverride, SliderConstraintOverride>;

struct IkConstraintParameters { Point target; float mix = 0, softness = 0; bool bend_positive = true, compress = false, stretch = false; };
struct TransformConstraintParameters {
    float rotation_degrees = 0, x = 0, y = 0, scale_x = 0, scale_y = 0, shear_y_degrees = 0;
    float mix_rotate = 0, mix_x = 0, mix_y = 0, mix_scale_x = 0, mix_scale_y = 0, mix_shear_y = 0;
};
struct PathConstraintParameters { float rotation_degrees = 0, position = 0, spacing = 0, mix_rotate = 0, mix_x = 0, mix_y = 0; };
struct PhysicsConstraintParameters {
    float x = 0, y = 0, rotate = 0, scale_x = 0, shear_x = 0, limit = 0;
    // Preserves both an authored positive binary32 rate and an exact host u32 rate.
    double fps = 0;
    float inertia = 0, strength = 0, damping = 0, mass = 0, wind = 0, gravity = 0, mix = 0;
};
struct SliderConstraintParameters { float source_offset = 0, time_offset = 0, time_scale = 0, range_max = 0, time = 0, mix = 0; };
using ConstraintParameters = std::variant<IkConstraintParameters, TransformConstraintParameters, PathConstraintParameters, PhysicsConstraintParameters, SliderConstraintParameters>;

struct IkConstraintDiagnostic {
    float residual = 0, threshold = 0, mix = 0;
    std::uint32_t iterations_used = 0, iteration_limit = 0;
    bool saturated = false;
};
struct TransformConstraintDiagnostic {
    std::uint32_t driven_bone_count = 0;
    std::array<float, 6> mixes{};
    std::optional<float> translation_residual, rotation_residual, scale_residual, shear_residual;
};
struct PathConstraintDiagnostic {
    std::uint32_t driven_bone_count = 0;
    float mix_rotate = 0, mix_x = 0, mix_y = 0;
    std::optional<float> translation_residual, rotation_residual, scale_residual;
};
struct PhysicsConstraintDiagnostic {
    std::uint32_t fixed_steps = 0;
    float translation_offset = 0, translation_speed = 0, rotation_offset_degrees = 0, angular_speed_degrees = 0;
    float scale_offset = 0, scale_speed = 0, configured_limit = 0;
    std::optional<float> required_limit;
    bool limit_saturated = false;
};
struct SliderConstraintDiagnostic {
    std::optional<float> source_value;
    float mapped_time = 0, resolved_time = 0, duration = 0;
    bool wrapped = false, clamped = false;
};
using ConstraintDiagnostic = std::variant<std::monostate, IkConstraintDiagnostic, TransformConstraintDiagnostic, PathConstraintDiagnostic, PhysicsConstraintDiagnostic, SliderConstraintDiagnostic>;
struct ConstraintState {
    std::string constraint_id;
    ConstraintKind kind = ConstraintKind::ik;
    ConstraintParameters sampled_parameters;
    std::optional<float> sampled_slider_time_seconds;
    ConstraintDiagnostic diagnostic;
};
struct PathConstraintPosition {
    std::string constraint_id;
    Point point;
    float tangent_degrees = 0, distance = 0, path_length = 0;
    Point path_start, path_end;
    bool closed = false;
};
struct TransformConstraintOffsets {
    std::string constraint_id;
    float rotation_degrees = 0, x = 0, y = 0, scale_x = 0, scale_y = 0, shear_y_degrees = 0;
    [[nodiscard]] TransformConstraintOverride to_override() const {
        TransformConstraintOverride value; value.rotation_degrees = rotation_degrees; value.x = x; value.y = y;
        value.scale_x = scale_x; value.scale_y = scale_y; value.shear_y_degrees = shear_y_degrees; return value;
    }
};
}
