#pragma once
#include "cane/bounds.hpp"

namespace cane::geometry {
[[nodiscard]] bool bounds_polygon_contains(const std::vector<float>& vertices, Point point) noexcept;
[[nodiscard]] bool bounds_polygon_segment(const std::vector<float>& vertices, Point start, Point end) noexcept;
[[nodiscard]] bool bounds_polygons_intersect(const std::vector<float>& first, const std::vector<float>& second) noexcept;
[[nodiscard]] bool bounds_aabb_segment(const BoundsAabb& aabb, Point start, Point end) noexcept;
}
