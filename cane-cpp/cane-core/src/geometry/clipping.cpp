#include "clipping.hpp"
#include "cane/error.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

namespace cane::geometry {
namespace {
[[noreturn]] void limit() { throw Error(ErrorCode::resource_limit, "apply", "Clipped attachment exceeds the v1 geometry budget."); }
float cross(const Vertex& a, const Vertex& b, const Vertex& p) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }
float area(const Polygon& p) {
    float sum = 0;
    for (std::size_t i = 0; i < p.size(); ++i) { const auto& a = p[i]; const auto& b = p[(i + 1) % p.size()]; sum += a.x * b.y - b.x * a.y; }
    return sum * .5f;
}
bool valid(const Polygon& p) { const auto a = area(p); return p.size() >= 3 && std::isfinite(a) && std::abs(a) > clip_epsilon; }
bool equal(const Vertex& a, const Vertex& b, float epsilon, bool uv) {
    return std::abs(a.x - b.x) <= epsilon && std::abs(a.y - b.y) <= epsilon
        && (!uv || (std::abs(a.u - b.u) <= epsilon && std::abs(a.v - b.v) <= epsilon));
}
void push(Polygon& p, const Vertex& v) { if (p.size() >= max_render_attachment_vertices_v1) limit(); p.push_back(v); }
Vertex lerp(const Vertex& a, const Vertex& b, float t) {
    const Vertex result{a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t};
    if (!std::isfinite(result.x) || !std::isfinite(result.y) || !std::isfinite(result.u) || !std::isfinite(result.v))
        throw Error(ErrorCode::non_finite, "apply", "Clipping intersection is non-finite.");
    return result;
}
template<class Distance> void plane(const Polygon& input, Polygon& output, Distance distance, float epsilon, bool uv) {
    output.clear(); if (input.empty()) return;
    auto previous = input.back(); float previous_distance = distance(previous); bool previous_inside = previous_distance >= -epsilon;
    const auto append = [&](const Vertex& v) { if (output.empty() || !equal(output.back(), v, epsilon, uv)) push(output, v); };
    for (const auto& current : input) {
        const float current_distance = distance(current); const bool inside = current_distance >= -epsilon;
        if (!std::isfinite(previous_distance) || !std::isfinite(current_distance)) throw Error(ErrorCode::non_finite, "apply", "Clipping half-plane is non-finite.");
        if (inside != previous_inside) {
            const float denominator = previous_distance - current_distance;
            if (!std::isfinite(denominator)) throw Error(ErrorCode::non_finite, "apply", "Clipping denominator is non-finite.");
            if (std::abs(denominator) > matrix_epsilon) append(lerp(previous, current, std::clamp(previous_distance / denominator, 0.0f, 1.0f)));
        }
        if (inside) append(current);
        previous = current; previous_distance = current_distance; previous_inside = inside;
    }
    if (output.size() > 1 && equal(output.front(), output.back(), epsilon, uv)) output.pop_back();
}
Polygon& pool_item(std::vector<Polygon>& pool, std::size_t index) {
    if (index >= max_render_attachment_vertices_v1) limit();
    if (index == pool.size()) pool.emplace_back();
    return pool[index];
}
void append_piece(PreparedClip& output, const Polygon& piece) { pool_item(output.pieces, output.piece_count++) = piece; }
void triangle(const GeometryBuffer& source, std::size_t offset, Polygon& output) {
    output.clear();
    for (std::size_t i = 0; i < 3; ++i) output.push_back(source.vertices.at(source.indices.at(offset + i)));
}
void intersect(Polygon& a, Polygon& b, const Polygon& clip) {
    for (std::size_t i = 0; i < clip.size(); ++i) {
        const auto& start = clip[i]; const auto& end = clip[(i + 1) % clip.size()];
        plane(a, b, [&](const Vertex& p) { return cross(start, end, p); }, clip_epsilon, false); a.swap(b);
        if (!valid(a)) { a.clear(); return; }
    }
}
}
void GeometryBuffer::append(const Polygon& polygon) {
    if (polygon.size() < 3) return;
    if (polygon.size() > max_render_attachment_vertices_v1 || vertices.size() > max_render_attachment_vertices_v1 - polygon.size()) limit();
    const auto triangles = polygon.size() - 2;
    if (triangles > (indices.max_size() - indices.size()) / 3) limit();
    const auto offset = static_cast<std::uint32_t>(vertices.size()); vertices.insert(vertices.end(), polygon.begin(), polygon.end());
    for (std::uint32_t i = 1; i + 1 < polygon.size(); ++i) { indices.push_back(offset); indices.push_back(offset + i); indices.push_back(offset + i + 1); }
}
void prepare_clip(const std::vector<float>& xy, bool convex, bool inverse, std::optional<std::size_t> end_slot, PreparedClip& output, ClipWorkspace& scratch) {
    output.clear(); auto& points = scratch.points; points.clear();
    if (xy.size() % 2 != 0) throw Error(ErrorCode::validation_failed, "apply", "Clipping coordinate count must be even.");
    if (xy.size() / 2 > max_render_attachment_vertices_v1) limit();
    for (std::size_t i = 0; i < xy.size(); i += 2) {
        if (!std::isfinite(xy[i]) || !std::isfinite(xy[i + 1])) return; // A sampled invalid clip replaces the previous active clip.
        points.push_back({xy[i], xy[i + 1], 0, 0});
    }
    const auto signed_area = area(points); if (!valid(points)) return;
    if (signed_area < 0) std::reverse(points.begin(), points.end());
    bool is_convex = true;
    for (std::size_t i = 0; i < points.size(); ++i) if (cross(points[i], points[(i + 1) % points.size()], points[(i + 2) % points.size()]) < -clip_epsilon) { is_convex = false; break; }
    if (is_convex) append_piece(output, points);
    else if (convex) {
        std::sort(points.begin(), points.end(), [](const Vertex& a, const Vertex& b) { return a.x == b.x ? a.y < b.y : a.x < b.x; });
        points.erase(std::unique(points.begin(), points.end(), [](const Vertex& a, const Vertex& b) { return a.x == b.x && a.y == b.y; }), points.end());
        auto& hull = scratch.hull; hull.clear();
        for (const auto& p : points) { while (hull.size() >= 2 && cross(hull[hull.size() - 2], hull.back(), p) <= clip_epsilon) hull.pop_back(); hull.push_back(p); }
        const auto lower = hull.size();
        for (std::size_t i = points.size() - 1; i-- > 0;) {
            const auto& p = points[i]; while (hull.size() > lower && cross(hull[hull.size() - 2], hull.back(), p) <= clip_epsilon) hull.pop_back(); hull.push_back(p);
        }
        if (!hull.empty()) hull.pop_back();
        if (!valid(hull)) return;
        append_piece(output, hull);
    } else {
        auto& remaining = scratch.ear_indices; remaining.resize(points.size()); std::iota(remaining.begin(), remaining.end(), std::size_t{0});
        while (remaining.size() > 3) {
            bool found = false;
            for (std::size_t i = 0; i < remaining.size(); ++i) {
                const auto prev = remaining[(i + remaining.size() - 1) % remaining.size()], here = remaining[i], next = remaining[(i + 1) % remaining.size()];
                const auto& a = points[prev]; const auto& b = points[here]; const auto& c = points[next];
                if (cross(a, b, c) <= clip_epsilon) continue;
                bool contains = false;
                for (const auto index : remaining) {
                    if (index == prev || index == here || index == next) continue;
                    const auto& p = points[index];
                    if (cross(a, b, p) >= -clip_epsilon && cross(b, c, p) >= -clip_epsilon && cross(c, a, p) >= -clip_epsilon) { contains = true; break; }
                }
                if (contains) continue;
                auto& piece = pool_item(output.pieces, output.piece_count++); piece.assign({a, b, c});
                remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(i)); found = true; break;
            }
            if (!found) { output.clear(); return; }
        }
        auto& piece = pool_item(output.pieces, output.piece_count++); piece.clear(); for (const auto i : remaining) piece.push_back(points[i]);
    }
    output.active = true; output.inverse = inverse; output.end_slot = end_slot;
}
void apply_clip(const GeometryBuffer& source, const PreparedClip& clip, GeometryBuffer& output, ClipWorkspace& scratch) {
    output.clear(); auto& a = scratch.a; auto& b = scratch.b;
    for (std::size_t t = 0; t < source.indices.size(); t += 3) {
        if (!clip.inverse) {
            for (std::size_t i = 0; i < clip.piece_count; ++i) { triangle(source, t, a); intersect(a, b, clip.pieces[i]); if (valid(a)) output.append(a); }
        } else {
            triangle(source, t, pool_item(scratch.fragments, 0)); std::size_t count = 1;
            for (std::size_t piece = 0; piece < clip.piece_count && count != 0; ++piece) {
                std::size_t next_count = 0, vertices = 0; const auto& polygon = clip.pieces[piece];
                for (std::size_t f = 0; f < count; ++f) {
                    a = scratch.fragments[f];
                    for (std::size_t edge = 0; edge < polygon.size(); ++edge) {
                        const auto& start = polygon[edge]; const auto& end = polygon[(edge + 1) % polygon.size()];
                        plane(a, b, [&](const Vertex& p) { return -cross(start, end, p); }, clip_epsilon, false);
                        if (valid(b)) {
                            if (vertices > max_render_attachment_vertices_v1 - b.size()) limit();
                            vertices += b.size(); pool_item(scratch.next_fragments, next_count++) = b;
                        }
                        plane(a, b, [&](const Vertex& p) { return cross(start, end, p); }, clip_epsilon, false); a.swap(b);
                        if (!valid(a)) break;
                    }
                }
                scratch.fragments.swap(scratch.next_fragments); count = next_count;
            }
            for (std::size_t f = 0; f < count; ++f) if (valid(scratch.fragments[f])) output.append(scratch.fragments[f]);
        }
    }
}
bool trim_atlas(const GeometryBuffer& source, float min_u, float max_u, float min_v, float max_v, GeometryBuffer& output, ClipWorkspace& scratch) {
    bool inside = true;
    for (const auto& v : source.vertices) if (v.u < min_u - atlas_source_trim_epsilon || v.u > max_u + atlas_source_trim_epsilon
        || v.v < min_v - atlas_source_trim_epsilon || v.v > max_v + atlas_source_trim_epsilon) { inside = false; break; }
    if (inside) return false;
    output.clear(); auto& a = scratch.a; auto& b = scratch.b;
    for (std::size_t i = 0; i < source.indices.size(); i += 3) {
        triangle(source, i, a);
        plane(a, b, [&](const Vertex& v) { return v.u - min_u; }, atlas_source_trim_epsilon, true); a.swap(b);
        plane(a, b, [&](const Vertex& v) { return max_u - v.u; }, atlas_source_trim_epsilon, true); a.swap(b);
        plane(a, b, [&](const Vertex& v) { return v.v - min_v; }, atlas_source_trim_epsilon, true); a.swap(b);
        plane(a, b, [&](const Vertex& v) { return max_v - v.v; }, atlas_source_trim_epsilon, true); a.swap(b);
        output.append(a); // Atlas trim retains finite zero-area triangles, unlike world clip fragments.
    }
    return true;
}
}
