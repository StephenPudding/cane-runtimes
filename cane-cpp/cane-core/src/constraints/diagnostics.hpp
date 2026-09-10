#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <variant>

namespace cane::constraints {
struct IkDiagnostic {
    float residual = 0, threshold = 0, mix = 0;
    std::uint32_t iterations_used = 0, iteration_limit = 0;
    bool saturated = false;
};
struct TransformDiagnostic {
    std::size_t driven = 0;
    std::array<float, 6> mixes{};
    std::optional<float> translation_residual, rotation_residual, scale_residual, shear_residual;
};
struct PathDiagnostic {
    std::size_t driven = 0;
    float mix_rotate = 0, mix_x = 0, mix_y = 0;
    std::optional<float> translation_residual, rotation_residual, scale_residual;
};
struct SliderDiagnostic {
    std::optional<float> source_value;
    float mapped_time = 0, resolved_time = 0, duration = 0;
    bool wrapped = false, clamped = false;
};
struct PhysicsDiagnostic {
    std::uint32_t fixed_steps = 0;
    float translation_offset = 0, translation_speed = 0, rotation_offset_degrees = 0, angular_speed_degrees = 0;
    float scale_offset = 0, scale_speed = 0, configured_limit = 0;
    std::optional<float> required_limit;
    bool limit_saturated = false;
};
using Diagnostic = std::variant<std::monostate, IkDiagnostic, TransformDiagnostic, PathDiagnostic, SliderDiagnostic, PhysicsDiagnostic>;
}
