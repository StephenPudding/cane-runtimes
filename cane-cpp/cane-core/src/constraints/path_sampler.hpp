#pragma once
#include "cane/math.hpp"
#include <array>
#include <vector>

namespace cane::constraints {
struct PathSample { Point position; float tangent = 0; };

// Reusable Core sampler over already-deformed world control points. No attachment,
// engine, or JSON ownership is hidden here; reset retains all table capacity.
class PathSampler {
    struct Cubic {
        Point p0, p1, p2, p3;
        float cumulative = 0;
        std::array<float, 10> detailed{};
        [[nodiscard]] Point point(float t) const noexcept;
        [[nodiscard]] float tangent(float t) const noexcept;
        [[nodiscard]] float lengths(unsigned subdivisions, float* cumulative_output = nullptr) const noexcept;
    };
    std::vector<Cubic> curves_;
    bool closed_ = false, constant_speed_ = true;
public:
    void reset(const std::vector<float>& world, bool closed, bool constant_speed, const std::vector<float>& lengths = {});
    [[nodiscard]] float length() const noexcept { return curves_.empty() ? 0 : curves_.back().cumulative; }
    [[nodiscard]] bool available() const noexcept;
    [[nodiscard]] bool closed() const noexcept { return closed_; }
    [[nodiscard]] std::optional<PathSample> at(float distance) const noexcept;
    [[nodiscard]] std::optional<float> project_distance(Point target) const noexcept;
};
}
