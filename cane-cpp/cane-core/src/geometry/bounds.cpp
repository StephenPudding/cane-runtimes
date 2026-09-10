#include "cane/bounds.hpp"
#include "bounds_math.hpp"
#include "cane/error.hpp"
#include <cmath>

namespace cane {
namespace {
void finite(Point point, const char* op) {
    if (!std::isfinite(point.x) || !std::isfinite(point.y)) throw Error(ErrorCode::non_finite, op, "Bounds query coordinates must be finite.");
}
template<class F> auto allocate(const char* op, F&& body) {
    try { return body(); } catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, op, "Bounds query allocation failed."); }
}
}
std::vector<BoundsHit> BoundsHitBuffer::snapshot() const {
    return allocate("snapshotBoundsHits", [&] { return published_.count == 0 ? std::vector<BoundsHit>{} : std::vector<BoundsHit>(hits().begin(), hits().end()); });
}
BoundsSnapshot RuntimeBounds::snapshot() const {
    return allocate("snapshotBounds", [&] {
        BoundsSnapshot result; result.frame_sequence = published_.sequence; result.aabb = published_.aabb;
        if (published_.count != 0) result.polygons.assign(polygons().begin(), polygons().end());
        return result;
    });
}
const BoundsPolygon* RuntimeBounds::polygon_for_attachment(std::string_view id) const {
    if (id.empty()) throw Error(ErrorCode::invalid_argument, "polygonForAttachment", "Attachment ID is required.", "attachmentId");
    for (std::size_t i = published_.count; i > 0; --i) if (published_.pool[i - 1].attachment_id.compare(id) == 0) return &published_.pool[i - 1];
    return nullptr;
}
const BoundsHit* RuntimeBounds::contains_point(Point point) const {
    finite(point, "containsPoint");
    for (std::size_t i = published_.count; i > 0; --i) if (geometry::bounds_polygon_contains(published_.pool[i - 1].world_vertices_xy, point)) return &published_.pool[i - 1];
    return nullptr;
}
const BoundsHit* RuntimeBounds::intersects_segment(Point start, Point end) const {
    finite(start, "intersectsSegment"); finite(end, "intersectsSegment");
    for (std::size_t i = published_.count; i > 0; --i) if (geometry::bounds_polygon_segment(published_.pool[i - 1].world_vertices_xy, start, end)) return &published_.pool[i - 1];
    return nullptr;
}
void RuntimeBounds::write_hits(Point start, Point end, bool segment, BoundsHitBuffer& output, const char* op) const {
    finite(start, op); finite(end, op);
    allocate(op, [&] {
        auto& staged = output.staging_; staged.count = 0;
        for (std::size_t i = published_.count; i > 0; --i) {
            const auto& polygon = published_.pool[i - 1];
            const bool hit = segment ? geometry::bounds_polygon_segment(polygon.world_vertices_xy, start, end) : geometry::bounds_polygon_contains(polygon.world_vertices_xy, start);
            if (!hit) continue;
            if (staged.pool.size() == staged.count) staged.pool.emplace_back();
            auto& target = staged.pool[staged.count]; target.slot_id = polygon.slot_id; target.attachment_id = polygon.attachment_id; target.draw_index = polygon.draw_index;
            ++staged.count;
        }
        using std::swap; swap(output.published_, staged);
    });
}
void RuntimeBounds::write_point_hits(Point point, BoundsHitBuffer& output) const { write_hits(point, point, false, output, "writePointHits"); }
void RuntimeBounds::write_segment_hits(Point start, Point end, BoundsHitBuffer& output) const { write_hits(start, end, true, output, "writeSegmentHits"); }
bool RuntimeBounds::aabb_contains_point(Point point) const {
    finite(point, "aabbContainsPoint"); const auto& a = published_.aabb;
    return !a.empty && point.x >= a.min_x && point.x <= a.max_x && point.y >= a.min_y && point.y <= a.max_y;
}
bool RuntimeBounds::aabb_intersects_segment(Point start, Point end) const {
    finite(start, "aabbIntersectsSegment"); finite(end, "aabbIntersectsSegment"); return geometry::bounds_aabb_segment(published_.aabb, start, end);
}
bool RuntimeBounds::aabb_intersects_bounds(const RuntimeBounds& other) const noexcept {
    const auto& a = published_.aabb; const auto& b = other.published_.aabb;
    return !a.empty && !b.empty && a.min_x <= b.max_x && a.max_x >= b.min_x && a.min_y <= b.max_y && a.max_y >= b.min_y;
}
bool RuntimeBounds::intersects_bounds(const RuntimeBounds& other) const {
    if (!aabb_intersects_bounds(other)) return false;
    for (const auto& a : polygons()) for (const auto& b : other.polygons())
        if (geometry::bounds_polygons_intersect(a.world_vertices_xy, b.world_vertices_xy)) return true;
    return false;
}
}
