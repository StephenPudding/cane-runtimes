#pragma once
#include <optional>

namespace cane {
inline constexpr float matrix_epsilon = 1.1920928955078125e-7f;
inline constexpr float pi = 3.1415927410125732421875f;
inline constexpr float degrees_to_radians = pi / 180.0f;
inline constexpr float radians_to_degrees = 180.0f / pi;

struct Point { float x = 0, y = 0; };
struct BoneLocal {
    float x = 0, y = 0, rotation_degrees = 0, scale_x = 1, scale_y = 1;
    float shear_x_degrees = 0, shear_y_degrees = 0;
};
enum class TransformMode { normal, only_translation, no_rotation_or_reflection, no_scale, no_scale_or_reflection };

// Authoritative X-right/Y-up world transform, including shear and reflection.
struct Affine {
    float a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;
    [[nodiscard]] float determinant() const noexcept;
    [[nodiscard]] bool finite() const noexcept;
    [[nodiscard]] Point transform(Point point) const noexcept;
    [[nodiscard]] Point transform_direction(Point direction) const noexcept;
    [[nodiscard]] std::optional<Affine> inverse(float determinant_threshold = 0) const noexcept;
    [[nodiscard]] static Affine from_local(const BoneLocal& local) noexcept;
    [[nodiscard]] static Affine child(const Affine& parent, const BoneLocal& local, TransformMode mode);
};
[[nodiscard]] Affine operator*(const Affine& left, const Affine& right) noexcept;
[[nodiscard]] float hypot(float x, float y) noexcept;
[[nodiscard]] float wrap_degrees(float value) noexcept;
[[nodiscard]] float constraint_degrees(float value) noexcept;
}
