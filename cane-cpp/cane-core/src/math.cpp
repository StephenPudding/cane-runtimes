#include "cane/math.hpp"
#include "cane/error.hpp"
#include <cmath>

namespace cane {
namespace {
float cosine(float value) noexcept { return static_cast<float>(std::cos(static_cast<double>(value))); }
float sine(float value) noexcept { return static_cast<float>(std::sin(static_cast<double>(value))); }
float angle(float y, float x) noexcept { return static_cast<float>(std::atan2(static_cast<double>(y), static_cast<double>(x))); }
float remainder(float value, float period) noexcept {
    float result = std::fmod(value, period);
    if (result < 0) result += period;
    return result;
}
}
float hypot(float x, float y) noexcept { return static_cast<float>(std::sqrt(static_cast<double>(x) * x + static_cast<double>(y) * y)); }
float wrap_degrees(float value) noexcept { return remainder(value + 180.0f, 360.0f) - 180.0f; }
float constraint_degrees(float value) noexcept { const float result = remainder(value, 360.0f); return result > 180.0f ? result - 360.0f : result; }
float Affine::determinant() const noexcept { return a * d - c * b; }
bool Affine::finite() const noexcept { return std::isfinite(a) && std::isfinite(b) && std::isfinite(c) && std::isfinite(d) && std::isfinite(tx) && std::isfinite(ty); }
Point Affine::transform(Point p) const noexcept { return {a * p.x + c * p.y + tx, b * p.x + d * p.y + ty}; }
Point Affine::transform_direction(Point p) const noexcept { return {a * p.x + c * p.y, b * p.x + d * p.y}; }
Affine operator*(const Affine& l, const Affine& r) noexcept {
    return {l.a * r.a + l.c * r.b, l.b * r.a + l.d * r.b, l.a * r.c + l.c * r.d, l.b * r.c + l.d * r.d,
            l.a * r.tx + l.c * r.ty + l.tx, l.b * r.tx + l.d * r.ty + l.ty};
}
std::optional<Affine> Affine::inverse(float threshold) const noexcept {
    const float det = determinant();
    if (!finite() || !std::isfinite(det) || !std::isfinite(threshold) || threshold < 0 || std::abs(det) <= threshold) return {};
    const Affine result{d / det, -b / det, -c / det, a / det, (c * ty - d * tx) / det, (b * tx - a * ty) / det};
    return result.finite() ? std::optional<Affine>(result) : std::nullopt;
}
Affine Affine::from_local(const BoneLocal& local) noexcept {
    const float rx = (local.rotation_degrees + local.shear_x_degrees) * degrees_to_radians;
    const float ry = (local.rotation_degrees + local.shear_y_degrees) * degrees_to_radians;
    return {cosine(rx) * local.scale_x, sine(rx) * local.scale_x, -sine(ry) * local.scale_y,
            cosine(ry) * local.scale_y, local.x, local.y};
}
Affine Affine::child(const Affine& parent, const BoneLocal& local, TransformMode mode) {
    if (mode == TransformMode::normal) return parent * from_local(local);
    const Point origin = parent.transform({local.x, local.y});
    if (mode == TransformMode::only_translation) {
        Affine result = from_local(local); result.tx = origin.x; result.ty = origin.y; return result;
    }
    if (mode == TransformMode::no_rotation_or_reflection) {
        float pa = parent.a, pb = parent.c, pc = parent.b, pd = parent.d;
        const float squared = pa * pa + pc * pc; float rotation;
        if (squared > 0.0001f) {
            const float scale = std::abs(pa * pd - pb * pc) / squared;
            pb = pc * scale; pd = pa * scale; rotation = angle(pc, pa) * radians_to_degrees;
        } else { pa = pc = 0; rotation = 90.0f - angle(pd, pb) * radians_to_degrees; }
        const float rx = (local.rotation_degrees + local.shear_x_degrees - rotation) * degrees_to_radians;
        const float ry = (local.rotation_degrees + local.shear_y_degrees - rotation + 90.0f) * degrees_to_radians;
        const float la = cosine(rx) * local.scale_x, lc = sine(rx) * local.scale_x;
        const float lb = cosine(ry) * local.scale_y, ld = sine(ry) * local.scale_y;
        return {pa * la - pb * lc, pc * la + pd * lc, pa * lb - pb * ld, pc * lb + pd * ld, origin.x, origin.y};
    }
    if (mode != TransformMode::no_scale && mode != TransformMode::no_scale_or_reflection)
        throw Error(ErrorCode::invalid_argument, "composeBoneWorld", "Unknown transform mode.", "transformMode");
    const float rotation = local.rotation_degrees * degrees_to_radians, co = cosine(rotation), si = sine(rotation);
    float za = parent.a * co + parent.c * si, zc = parent.b * co + parent.d * si;
    const float length = hypot(za, zc);
    if (length > 0.00001f) { za /= length; zc /= length; }
    float reflection = hypot(za, zc);
    if (mode == TransformMode::no_scale && parent.determinant() < 0) reflection = -reflection;
    const float perpendicular = pi / 2.0f + angle(zc, za);
    const float zb = cosine(perpendicular) * reflection, zd = sine(perpendicular) * reflection;
    const float sx = local.shear_x_degrees * degrees_to_radians, sy = (90.0f + local.shear_y_degrees) * degrees_to_radians;
    const float ax = cosine(sx) * local.scale_x, ay = sine(sx) * local.scale_x;
    const float bx = cosine(sy) * local.scale_y, by = sine(sy) * local.scale_y;
    return {za * ax + zb * ay, zc * ax + zd * ay, za * bx + zb * by, zc * bx + zd * by, origin.x, origin.y};
}
}
