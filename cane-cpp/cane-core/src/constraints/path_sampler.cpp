#include "path_sampler.hpp"
#include <algorithm>
#include <cmath>

namespace cane::constraints {
namespace {
float angle(float x, float y) noexcept { return static_cast<float>(std::atan2(static_cast<double>(y), x)) * radians_to_degrees; }
std::optional<PathSample> sample(Point point, float tangent) noexcept {
    if (!std::isfinite(point.x) || !std::isfinite(point.y) || !std::isfinite(tangent)) return {};
    return PathSample{point, tangent};
}
}
Point PathSampler::Cubic::point(float t) const noexcept {
    const auto u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return {a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y};
}
float PathSampler::Cubic::tangent(float t) const noexcept {
    const auto u = 1 - t;
    const auto dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const auto dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    return dx != 0 || dy != 0 ? angle(dx, dy) : angle(p3.x - p0.x, p3.y - p0.y);
}
float PathSampler::Cubic::lengths(unsigned subdivisions, float* output) const noexcept {
    auto previous = p0; float total = 0;
    for (unsigned i = 0; i < subdivisions; ++i) {
        const auto next = point(static_cast<float>(i + 1) / static_cast<float>(subdivisions));
        total += cane::hypot(next.x - previous.x, next.y - previous.y);
        if (output) output[i] = total;
        previous = next;
    }
    return total;
}
void PathSampler::reset(const std::vector<float>& world, bool closed, bool constant_speed, const std::vector<float>& lengths) {
    closed_ = closed; constant_speed_ = constant_speed;
    if (world.size() < 12 || world.size() % 6 != 0 || std::any_of(world.begin(), world.end(), [](float v) { return !std::isfinite(v); })) { curves_.clear(); return; }
    const auto knots = world.size() / 6; curves_.resize(closed ? knots : knots - 1);
    auto authored = !constant_speed && lengths.size() == knots; float previous_length = 0;
    for (const auto value : lengths) { if (!std::isfinite(value) || value < previous_length) authored = false; previous_length = value; }
    const auto read = [&](std::size_t knot, std::size_t part) { const auto i = knot * 6 + part * 2; return Point{world[i], world[i + 1]}; };
    float sum = 0;
    for (std::size_t i = 0; i < curves_.size(); ++i) {
        const auto next = (i + 1) % knots; auto& c = curves_[i];
        c.p0 = read(i, 1); c.p1 = read(i, 2); c.p2 = read(next, 0); c.p3 = read(next, 1);
        if (authored) c.cumulative = lengths[i];
        else { sum += c.lengths(constant_speed ? 4u : 24u); c.cumulative = sum; }
        if (constant_speed) (void)c.lengths(10, c.detailed.data());
    }
}
bool PathSampler::available() const noexcept { return std::isfinite(length()) && length() > 0; }
std::optional<PathSample> PathSampler::at(float distance) const noexcept {
    if (!available() || !std::isfinite(distance)) return {};
    if (closed_) {
        distance = std::fmod(distance, length()); if (distance < 0) distance += length();
        // Addition may round a tiny negative remainder up to the modulus.
        if (distance == length()) distance = 0;
    } else if (distance < 0 || distance > length()) {
        const auto start = distance < 0; const auto& c = start ? curves_.front() : curves_.back();
        const auto end = start ? c.p0 : c.p3, from = start ? c.p1 : c.p2;
        auto dx = end.x - from.x, dy = end.y - from.y; const auto magnitude = cane::hypot(dx, dy);
        if (magnitude == 0 || !std::isfinite(magnitude)) return {};
        dx /= magnitude; dy /= magnitude; const auto amount = start ? -distance : distance - length();
        return sample({end.x + dx * amount, end.y + dy * amount}, angle(dx, dy));
    }
    const auto found = std::lower_bound(curves_.begin(), curves_.end(), distance, [](const Cubic& c, float d) { return c.cumulative < d; });
    const auto& c = *found; const auto before = found == curves_.begin() ? 0 : std::prev(found)->cumulative;
    const auto span = c.cumulative - before; auto t = span == 0 ? 0 : std::clamp((distance - before) / span, 0.0f, 1.0f);
    if (constant_speed_) {
        const auto target = t * c.detailed.back();
        if (!std::isfinite(target)) return {};
        const auto end = std::lower_bound(c.detailed.begin(), c.detailed.end(), target);
        const auto start = end == c.detailed.begin() ? 0 : *std::prev(end), segment_length = *end - start;
        const auto ratio = segment_length == 0 ? 0 : std::clamp((target - start) / segment_length, 0.0f, 1.0f);
        t = (static_cast<float>(end - c.detailed.begin()) + ratio) / 10;
    }
    return sample(c.point(t), c.tangent(t));
}
}
