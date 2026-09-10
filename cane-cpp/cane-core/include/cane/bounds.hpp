#pragma once
#include "math.hpp"
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace cane {
namespace detail { struct BoundsAccess; }
struct BoundsOptions {
    bool include_render_geometry = true, include_bounding_boxes = true, include_transparent = false;
};
struct BoundsAabb {
    bool empty = true;
    float min_x = 0, min_y = 0, max_x = 0, max_y = 0, width = 0, height = 0;
};
struct BoundsHit {
    std::string slot_id, attachment_id;
    std::uint32_t draw_index = 0;
};
struct BoundsPolygon : BoundsHit { std::vector<float> world_vertices_xy; };
struct BoundsSnapshot {
    std::uint64_t frame_sequence = 0;
    BoundsAabb aabb;
    std::vector<BoundsPolygon> polygons;
};

// Borrowed read-only view. The owning retained buffer defines its lifetime.
template<class T> class BoundsView {
    const T* data_;
    std::size_t size_;
public:
    BoundsView(const T* data, std::size_t size) noexcept : data_(data), size_(size) {}
    [[nodiscard]] const T* data() const noexcept { return data_; }
    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0; }
    [[nodiscard]] const T& operator[](std::size_t index) const noexcept { return data_[index]; }
    [[nodiscard]] const T* begin() const noexcept { return data_; }
    [[nodiscard]] const T* end() const noexcept { return size_ == 0 ? data_ : data_ + size_; }
};

class BoundsHitBuffer {
    struct Storage { std::vector<BoundsHit> pool; std::size_t count = 0; };
    Storage published_, staging_;
    friend class RuntimeBounds;
public:
    BoundsHitBuffer() = default;
    BoundsHitBuffer(const BoundsHitBuffer&) = default;
    BoundsHitBuffer& operator=(const BoundsHitBuffer& other) { if (this != &other) { BoundsHitBuffer copy(other); swap(copy); } return *this; }
    BoundsHitBuffer(BoundsHitBuffer&& other) noexcept { swap(other); }
    BoundsHitBuffer& operator=(BoundsHitBuffer&& other) noexcept { swap(other); return *this; }
    void swap(BoundsHitBuffer& other) noexcept { using std::swap; swap(published_, other.published_); swap(staging_, other.staging_); }
    [[nodiscard]] BoundsView<BoundsHit> hits() const noexcept { return {published_.pool.data(), published_.count}; }
    [[nodiscard]] std::vector<BoundsHit> snapshot() const;
};

// Repeated writes retain polygon/vertex capacity. Views and hit pointers expire on the
// next successful write_bounds into this object; snapshot() creates an independent copy.
class RuntimeBounds {
    struct Storage {
        std::uint64_t sequence = 0;
        BoundsAabb aabb;
        std::vector<BoundsPolygon> pool;
        std::size_t count = 0;
    };
    Storage published_, staging_;
    friend struct detail::BoundsAccess;
    void write_hits(Point start, Point end, bool segment, BoundsHitBuffer& output, const char* operation) const;
public:
    RuntimeBounds() = default;
    RuntimeBounds(const RuntimeBounds&) = default;
    RuntimeBounds& operator=(const RuntimeBounds& other) { if (this != &other) { RuntimeBounds copy(other); swap(copy); } return *this; }
    RuntimeBounds(RuntimeBounds&& other) noexcept { swap(other); }
    RuntimeBounds& operator=(RuntimeBounds&& other) noexcept { swap(other); return *this; }
    void swap(RuntimeBounds& other) noexcept { using std::swap; swap(published_, other.published_); swap(staging_, other.staging_); }
    [[nodiscard]] std::uint64_t frame_sequence() const noexcept { return published_.sequence; }
    [[nodiscard]] BoundsAabb aabb() const noexcept { return published_.aabb; }
    [[nodiscard]] BoundsView<BoundsPolygon> polygons() const noexcept { return {published_.pool.data(), published_.count}; }
    [[nodiscard]] BoundsSnapshot snapshot() const;
    [[nodiscard]] const BoundsPolygon* polygon_for_attachment(std::string_view attachment_id) const;
    [[nodiscard]] const BoundsHit* contains_point(Point point) const;
    [[nodiscard]] const BoundsHit* intersects_segment(Point start, Point end) const;
    void write_point_hits(Point point, BoundsHitBuffer& output) const;
    void write_segment_hits(Point start, Point end, BoundsHitBuffer& output) const;
    [[nodiscard]] bool aabb_contains_point(Point point) const;
    [[nodiscard]] bool aabb_intersects_segment(Point start, Point end) const;
    [[nodiscard]] bool aabb_intersects_bounds(const RuntimeBounds& other) const noexcept;
    [[nodiscard]] bool intersects_bounds(const RuntimeBounds& other) const;
};
}
