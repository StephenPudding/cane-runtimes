#include "bounds_math.hpp"
#include <algorithm>
#include <cmath>
#include <limits>

namespace cane::geometry {
namespace {
struct DoublePoint { double x, y; };
DoublePoint point(const std::vector<float>& v, std::size_t i) noexcept { return {v[i], v[i + 1]}; }
bool on_segment(DoublePoint p, DoublePoint a, DoublePoint b) noexcept {
    const double scale = std::max({1.0, std::abs(p.x), std::abs(p.y), std::abs(a.x), std::abs(a.y), std::abs(b.x), std::abs(b.y)});
    const double cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    if (std::abs(cross) > std::numeric_limits<double>::epsilon() * 32 * scale * scale) return false;
    return p.x >= std::min(a.x, b.x) && p.x <= std::max(a.x, b.x) && p.y >= std::min(a.y, b.y) && p.y <= std::max(a.y, b.y);
}
double orientation(DoublePoint a, DoublePoint b, DoublePoint c) noexcept {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
bool crosses(DoublePoint a, DoublePoint b, DoublePoint c, DoublePoint d) noexcept {
    const double ac = orientation(a, b, c), ad = orientation(a, b, d), ca = orientation(c, d, a), cb = orientation(c, d, b);
    if (((ac > 0 && ad < 0) || (ac < 0 && ad > 0)) && ((ca > 0 && cb < 0) || (ca < 0 && cb > 0))) return true;
    return (ac == 0 && on_segment(c, a, b)) || (ad == 0 && on_segment(d, a, b)) ||
        (ca == 0 && on_segment(a, c, d)) || (cb == 0 && on_segment(b, c, d));
}
bool contains(const std::vector<float>& v, DoublePoint p) noexcept {
    if (v.size() < 6) return false;
    bool inside = false;
    for (std::size_t previous = v.size() - 2, current = 0; current < v.size(); previous = current, current += 2) {
        const auto a = point(v, previous), b = point(v, current);
        if (on_segment(p, a, b)) return true;
        if ((a.y > p.y) != (b.y > p.y) && p.x < (a.x - b.x) * (p.y - b.y) / (a.y - b.y) + b.x) inside = !inside;
    }
    return inside;
}
bool segment(const std::vector<float>& v, DoublePoint start, DoublePoint end) noexcept {
    if (v.size() < 6) return false;
    if (contains(v, start) || contains(v, end)) return true;
    for (std::size_t previous = v.size() - 2, current = 0; current < v.size(); previous = current, current += 2)
        if (crosses(start, end, point(v, previous), point(v, current))) return true;
    return false;
}
}
bool bounds_polygon_contains(const std::vector<float>& v, Point p) noexcept { return contains(v, {p.x, p.y}); }
bool bounds_polygon_segment(const std::vector<float>& v, Point start, Point end) noexcept { return segment(v, {start.x, start.y}, {end.x, end.y}); }
bool bounds_polygons_intersect(const std::vector<float>& a, const std::vector<float>& b) noexcept {
    if (a.size() < 6 || b.size() < 6) return false;
    if (contains(a, point(b, 0)) || contains(b, point(a, 0))) return true;
    for (std::size_t previous = a.size() - 2, current = 0; current < a.size(); previous = current, current += 2)
        if (segment(b, point(a, previous), point(a, current))) return true;
    return false;
}
bool bounds_aabb_segment(const BoundsAabb& aabb, Point start, Point end) noexcept {
    if (aabb.empty) return false;
    double low = 0, high = 1;
    const double dx = static_cast<double>(end.x) - start.x, dy = static_cast<double>(end.y) - start.y;
    const auto clip = [&](double p, double q) {
        if (p == 0) return q >= 0;
        const double t = q / p;
        if (p < 0) { if (t > high) return false; low = std::max(low, t); }
        else { if (t < low) return false; high = std::min(high, t); }
        return true;
    };
    return clip(-dx, static_cast<double>(start.x) - aabb.min_x) && clip(dx, static_cast<double>(aabb.max_x) - start.x) &&
        clip(-dy, static_cast<double>(start.y) - aabb.min_y) && clip(dy, static_cast<double>(aabb.max_y) - start.y);
}
}
