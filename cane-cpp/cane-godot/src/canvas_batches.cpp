#include "canvas_projection.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <algorithm>
#include <limits>

namespace cane_godot {
bool CanvasProjection::uses_srgb_canvas() {
    return godot::RenderingServer::get_singleton()->get_current_rendering_method() == "gl_compatibility";
}

bool CanvasProjection::overlaps(const Batch::Triangle& a, const Batch::Triangle& b) {
    // A separating axis also treats a shared edge as disjoint: rasterization owns
    // that edge once. No epsilon may hide a small but real self-overlap.
    const auto dot = [](godot::Vector2 p, godot::Vector2 axis) {
        return static_cast<double>(p.x) * axis.x + static_cast<double>(p.y) * axis.y;
    };
    for (const auto* triangle : {&a, &b}) {
        for (std::size_t i = 0; i < 3; ++i) {
            const auto edge = triangle->points[(i + 1) % 3] - triangle->points[i];
            if (edge == godot::Vector2()) continue;
            const godot::Vector2 axis(-edge.y, edge.x);
            double a_min = dot(a.points[0], axis), a_max = a_min;
            double b_min = dot(b.points[0], axis), b_max = b_min;
            for (std::size_t p = 1; p < 3; ++p) {
                const auto ap = dot(a.points[p], axis), bp = dot(b.points[p], axis);
                a_min = std::min(a_min, ap); a_max = std::max(a_max, ap);
                b_min = std::min(b_min, bp); b_max = std::max(b_max, bp);
            }
            if (a_max <= b_min || b_max <= a_min) return false;
        }
    }
    return true;
}

bool CanvasProjection::same_material(const MaterialState& a, const MaterialState& b) {
    return a.texture == b.texture && a.blend == b.blend && a.color_space == b.color_space && a.alpha_mode == b.alpha_mode
        && a.tint.light == b.tint.light && a.tint.dark == b.tint.dark && a.tint.alpha == b.tint.alpha
        && a.min_filter == b.min_filter && a.mag_filter == b.mag_filter && a.wrap_u == b.wrap_u && a.wrap_v == b.wrap_v;
}

void CanvasProjection::plan_batches(const cane::RenderPacket& packet, const LoadedAsset& resources,
    const std::vector<std::size_t>& slot_breaks, ProjectionStats& stats) {
    batches_.clear();
    const bool srgb_canvas = uses_srgb_canvas();
    const auto& attachments = packet.attachments();
    for (std::size_t ai = 0; ai < attachments.size(); ++ai) {
        const auto& attachment = attachments[ai];
        const auto key = texture_key(attachment.texture);
        const auto texture = resources.textures.find(key);
        const auto acquired = resources.texture_descriptors.find(key);
        require(texture != resources.textures.end() && acquired != resources.texture_descriptors.end(), "Final packet texture is not loaded.", "texture");
        require(texture->second.is_valid(), "Final packet texture was released.", "texture");
        MaterialState material;
        material.texture = texture->second->get_rid(); material.blend = attachment.blend; material.tint = attachment.tint;
        std::visit([&](const auto& descriptor) {
            require(descriptor.width == acquired->second.width && descriptor.height == acquired->second.height
                && static_cast<std::uint32_t>(texture->second->get_width()) == descriptor.width
                && static_cast<std::uint32_t>(texture->second->get_height()) == descriptor.height,
                "Final packet texture dimensions differ from the decoded resource.", "texture.dimensions");
            material.color_space = descriptor.color_space; material.alpha_mode = descriptor.alpha_mode;
        }, attachment.texture);
        const auto* direct = std::get_if<cane::DirectTexture>(&attachment.texture);
        const auto& path = direct ? direct->path : std::get<cane::AtlasTexture>(attachment.texture).page_path;
        require(path == acquired->second.path, "Final packet texture path differs from the acquired resource.", "texture.path");
        if (const auto* atlas = std::get_if<cane::AtlasTexture>(&attachment.texture)) {
            material.min_filter = atlas->min_filter; material.mag_filter = atlas->mag_filter;
            material.wrap_u = atlas->wrap_u; material.wrap_v = atlas->wrap_v;
        }
        if (attachment.indices.empty()) continue;
        if (srgb_canvas) {
            // Encoded destinations need explicit linear compositing. Bound the
            // overlap search and keep adjacent disjoint triangles in one upload/
            // screen copy. Overlapping geometry starts a fresh ordered group.
            stats.unbatched_draws += static_cast<std::int64_t>(attachment.indices.size() / 3);
            for (std::size_t ti = 0; ti < attachment.indices.size(); ti += 3) {
                Batch::Triangle triangle;
                for (std::size_t corner = 0; corner < 3; ++corner) {
                    const auto vi = attachment.indices[ti + corner];
                    triangle.points[corner] = {attachment.world_vertices_xy[vi * 2], -attachment.world_vertices_xy[vi * 2 + 1]};
                    triangle.uvs[corner] = {attachment.uvs[vi * 2], attachment.uvs[vi * 2 + 1]};
                }
                const bool boundary = ti == 0 && std::binary_search(slot_breaks.begin(), slot_breaks.end(), ai);
                bool append = !boundary && !batches_.empty() && same_material(batches_.back().material, material)
                    && batches_.back().canvas_triangles.size() < 64;
                if (append) for (const auto& previous : batches_.back().canvas_triangles) {
                    if (overlaps(previous, triangle)) { append = false; break; }
                }
                if (!append) {
                    Batch batch;
                    batch.first = ai; batch.special = true; batch.material = material; batch.texture = texture->second;
                    batches_.push_back(std::move(batch));
                }
                auto& batch = batches_.back();
                batch.end = ai + 1; batch.vertices += 3; batch.indices += 3;
                batch.canvas_triangles.push_back(triangle);
            }
            continue;
        }
        const bool special = attachment.blend == cane::RenderBlendMode::multiply || attachment.blend == cane::RenderBlendMode::screen;
        const auto vertices = attachment.world_vertices_xy.size() / 2;
        stats.unbatched_draws += static_cast<std::int64_t>(special ? attachment.indices.size() / 3 : 1);
        if (!special && !batches_.empty() && !std::binary_search(slot_breaks.begin(), slot_breaks.end(), ai)) {
            auto& previous = batches_.back();
            // Keep integer index rebasing bounded; do not weld, reorder or alter geometry.
            if (!previous.special && same_material(previous.material, material) && previous.vertices + vertices <= 65536
                && previous.indices + attachment.indices.size() <= static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max())) {
                previous.end = ai + 1; previous.vertices += vertices; previous.indices += attachment.indices.size();
                continue;
            }
        }
        const std::size_t count = special ? attachment.indices.size() / 3 : 1;
        for (std::size_t triangle = 0; triangle < count; ++triangle) {
            Batch batch;
            batch.first = ai; batch.end = ai + 1; batch.triangle = triangle; batch.special = special;
            batch.vertices = special ? 3 : vertices; batch.indices = special ? 3 : attachment.indices.size();
            batch.material = material; batch.texture = texture->second;
            batches_.push_back(std::move(batch));
        }
    }
    require(batches_.size() <= static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max()), "Canvas batch count exceeds engine limits.", "draw_index");
}

void CanvasProjection::publish(godot::RID parent, const cane::RenderPacket& packet, const LoadedAsset& resources,
    const std::vector<std::size_t>& slot_breaks, bool visible, bool new_publication) {
    auto* server = godot::RenderingServer::get_singleton(); require(server != nullptr, "RenderingServer is unavailable.");
    ProjectionStats stats; stats.attachments = static_cast<std::int64_t>(packet.attachments().size());
    // Validate every resource and finish the batch plan before touching visible CanvasItems.
    plan_batches(packet, resources, slot_breaks, stats);
    if (!root_.is_valid()) root_ = server->canvas_item_create();
    server->canvas_item_set_visible(root_, visible); server->canvas_item_set_parent(root_, parent);
    const auto& attachments = packet.attachments();
    for (std::size_t index = 0; index < batches_.size(); ++index) {
        const auto& batch = batches_[index];
        if (index == draws_.size()) {
            Draw draw; draw.material.instantiate(); draw.item = server->canvas_item_create();
            server->canvas_item_set_parent(draw.item, root_);
            server->canvas_item_set_material(draw.item, draw.material->get_rid());
            draws_.push_back(std::move(draw));
        }
        auto& draw = draws_[index];
        draw.slot_id = attachments[batch.first].slot_id;
        server->canvas_item_clear(draw.item);
        server->canvas_item_set_draw_index(draw.item, static_cast<std::int32_t>(index));
        // Linear backends copy Multiply/Screen per triangle. Compatibility copies
        // each disjoint group for all blend modes before decoding its destination.
        server->canvas_item_set_copy_to_backbuffer(draw.item, batch.special, godot::Rect2());
        update_material(draw, batch.material, batch.texture, stats);
        draw.points.resize(static_cast<std::int64_t>(batch.vertices)); draw.uvs.resize(static_cast<std::int64_t>(batch.vertices));
        draw.indices.resize(static_cast<std::int64_t>(batch.indices));
        auto* points = draw.points.ptrw(); auto* uvs = draw.uvs.ptrw(); auto* indices = draw.indices.ptrw();
        if (!batch.canvas_triangles.empty()) {
            std::size_t offset = 0;
            for (const auto& triangle : batch.canvas_triangles) for (std::size_t i = 0; i < 3; ++i) {
                points[offset] = triangle.points[i]; uvs[offset] = triangle.uvs[i];
                indices[offset] = static_cast<std::int32_t>(offset); ++offset;
            }
            ++stats.backbuffer_copies;
        } else if (batch.special) {
            const auto& attachment = attachments[batch.first];
            for (std::size_t i = 0; i < 3; ++i) {
                const auto source = attachment.indices[batch.triangle * 3 + i];
                points[i] = {attachment.world_vertices_xy[source * 2], -attachment.world_vertices_xy[source * 2 + 1]};
                uvs[i] = {attachment.uvs[source * 2], attachment.uvs[source * 2 + 1]}; indices[i] = static_cast<std::int32_t>(i);
            }
            ++stats.backbuffer_copies;
        } else {
            std::size_t vertex_offset = 0, index_offset = 0;
            for (std::size_t ai = batch.first; ai < batch.end; ++ai) {
                const auto& attachment = attachments[ai];
                if (attachment.indices.empty()) continue;
                const auto count = attachment.world_vertices_xy.size() / 2;
                for (std::size_t i = 0; i < count; ++i) {
                    points[vertex_offset+i] = {attachment.world_vertices_xy[i*2], -attachment.world_vertices_xy[i*2+1]};
                    uvs[vertex_offset+i] = {attachment.uvs[i*2], attachment.uvs[i*2+1]};
                }
                for (const auto source : attachment.indices) indices[index_offset++] = static_cast<std::int32_t>(vertex_offset+source);
                vertex_offset += count;
            }
        }
        godot::PackedColorArray colors; colors.push_back(godot::Color(1, 1, 1, 1));
        server->canvas_item_add_triangle_array(draw.item, draw.indices, draw.points, colors, draw.uvs);
        stats.vertices += static_cast<std::int64_t>(batch.vertices); stats.triangles += static_cast<std::int64_t>(batch.indices / 3);
    }
    while (draws_.size() > batches_.size()) { server->free_rid(draws_.back().item); draws_.pop_back(); }
    stats.draws = static_cast<std::int64_t>(batches_.size());
    stats.packet_uploads = stats_.packet_uploads + (new_publication ? 1 : 0);
    stats.layout_uploads = stats_.layout_uploads + (new_publication ? 0 : 1);
    stats_ = stats; slot_breaks_ = slot_breaks;
}
}
