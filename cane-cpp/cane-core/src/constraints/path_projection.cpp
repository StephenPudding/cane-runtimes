#include "path_sampler.hpp"
#include <algorithm>
#include <cmath>
#include <limits>

namespace cane::constraints {
std::optional<float> PathSampler::project_distance(Point target) const noexcept {
    if (!available() || !std::isfinite(target.x) || !std::isfinite(target.y)) return {};
    auto best_squared = std::numeric_limits<float>::infinity(); std::optional<float> best;
    const auto consider = [&](Point point, float distance) {
        const auto dx = target.x - point.x, dy = target.y - point.y, squared = dx * dx + dy * dy;
        if (std::isfinite(distance) && squared < best_squared) { best_squared = squared; best = distance; }
    };
    const auto segment = [&](Point from, Point to, float begin, float end) {
        const auto dx = to.x - from.x, dy = to.y - from.y, squared = dx * dx + dy * dy;
        if (squared == 0 || !std::isfinite(squared)) return;
        const auto ratio = std::clamp(((target.x - from.x) * dx + (target.y - from.y) * dy) / squared, 0.0f, 1.0f);
        consider({from.x + dx * ratio, from.y + dy * ratio}, begin + (end - begin) * ratio);
    };
    float begin = 0;
    for (const auto& c : curves_) {
        std::array<float, 24> local{}; const auto local_total = constant_speed_ ? c.lengths(24, local.data()) : 0;
        const auto span = c.cumulative - begin; auto previous = c.p0; auto before = begin;
        for (unsigned i = 0; i < 24; ++i) {
            const auto t = static_cast<float>(i + 1) / 24; const auto next = c.point(t);
            const auto progress = constant_speed_ ? local_total > 0 ? local[i] / local_total : 0 : t;
            const auto after = begin + span * progress;
            segment(previous, next, before, after); previous = next; before = after;
        }
        begin = c.cumulative;
    }
    if (!closed_) {
        const auto ray = [&](Point anchor, Point handle, bool start) {
            auto dx = start ? handle.x - anchor.x : anchor.x - handle.x;
            auto dy = start ? handle.y - anchor.y : anchor.y - handle.y;
            const auto magnitude = cane::hypot(dx, dy); if (magnitude == 0 || !std::isfinite(magnitude)) return;
            dx /= magnitude; dy /= magnitude;
            const auto distance = (target.x - anchor.x) * dx + (target.y - anchor.y) * dy;
            if (start ? distance >= 0 : distance <= 0) return;
            consider({anchor.x + dx * distance, anchor.y + dy * distance}, start ? distance : length() + distance);
        };
        ray(curves_.front().p0, curves_.front().p1, true); ray(curves_.back().p3, curves_.back().p2, false);
    }
    return best;
}
}
