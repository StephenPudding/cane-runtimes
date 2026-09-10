#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace cane::animation {
enum class CurveKind { linear, stepped, bezier, bezier_value };

// Compiled once per outgoing key. Sampling has no JSON access or heap allocation.
class Curve {
    CurveKind kind_ = CurveKind::linear;
    float x1_ = 0, y1_ = 0, x2_ = 0, y2_ = 0;
    bool monotonic_ = true;
public:
    Curve() = default;
    Curve(CurveKind kind, float x1 = 0, float y1 = 0, float x2 = 0, float y2 = 0);
    [[nodiscard]] CurveKind kind() const noexcept { return kind_; }
    [[nodiscard]] bool monotonic_x() const noexcept { return monotonic_; }
    [[nodiscard]] float sample(float from, float to, float progress, bool angular = false, bool discrete = false) const;
};

struct PropertyCurves {
    Curve default_curve;
    std::unordered_map<std::string, Curve> properties;
    [[nodiscard]] Curve select(std::string_view property) const;
};

struct ScalarKey {
    float time = 0;
    float value = 0;
    Curve curve;
};

class ScalarChannel {
    std::vector<ScalarKey> keys_;
public:
    // Input declaration order is retained within each equal binary32 time group.
    explicit ScalarChannel(std::vector<ScalarKey> keys = {});
    [[nodiscard]] static ScalarChannel merge(const ScalarChannel& paired, const ScalarChannel& axis);
    [[nodiscard]] const std::vector<ScalarKey>& keys() const noexcept { return keys_; }
    [[nodiscard]] std::optional<float> sample(float time, bool angular = false, bool discrete = false) const;
};

[[nodiscard]] float blend_scalar(float current, float setup, float sample, float alpha, bool additive, bool angular = false);
[[nodiscard]] float fixed_frame_time(float pose_time, float frame_step_seconds);
}
