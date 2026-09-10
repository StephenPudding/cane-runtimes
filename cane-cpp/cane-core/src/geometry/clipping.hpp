#pragma once
#include "cane/render_packet.hpp"

namespace cane::geometry {
inline constexpr float clip_epsilon = 0.00001f;
inline constexpr float atlas_source_trim_epsilon = 0.000001f;
struct Vertex { float x = 0, y = 0, u = 0, v = 0; };
using Polygon = std::vector<Vertex>;
struct GeometryBuffer {
    Polygon vertices;
    std::vector<std::uint32_t> indices;
    void clear() noexcept { vertices.clear(); indices.clear(); }
    void append(const Polygon& polygon);
};
struct PreparedClip {
    std::vector<Polygon> pieces; // Retained polygon capacities; only [0, piece_count) is active.
    std::size_t piece_count = 0;
    std::optional<std::size_t> end_slot;
    bool inverse = false, active = false;
    void clear() noexcept { active = false; piece_count = 0; end_slot.reset(); }
};
struct ClipWorkspace {
    Polygon points, hull, a, b;
    std::vector<std::size_t> ear_indices;
    std::vector<Polygon> fragments, next_fragments;
};
void prepare_clip(const std::vector<float>& world_xy, bool convex, bool inverse,
    std::optional<std::size_t> end_slot, PreparedClip& output, ClipWorkspace& scratch);
void apply_clip(const GeometryBuffer& source, const PreparedClip& clip, GeometryBuffer& output, ClipWorkspace& scratch);
// True means a new buffer was produced; false leaves the source topology and output untouched.
[[nodiscard]] bool trim_atlas(const GeometryBuffer& source, float min_u, float max_u, float min_v,
    float max_v, GeometryBuffer& output, ClipWorkspace& scratch);
}
