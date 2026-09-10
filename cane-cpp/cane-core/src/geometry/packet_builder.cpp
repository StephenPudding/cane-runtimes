#include "packet_builder.hpp"
#include "cane/error.hpp"
#include <cmath>
#include <limits>

namespace cane::geometry {
namespace {
void texture(TextureDescriptor& output, const RuntimeData& data, const RuntimeImageDefinition& image) {
    if (!image.atlas_index) {
        if (!image.path || image.width == 0 || image.height == 0) throw Error(ErrorCode::missing_resource, "apply", "Direct texture path or dimensions are unavailable.", "imageId", image.image_id);
        auto* direct = std::get_if<DirectTexture>(&output);
        if (!direct) direct = &output.emplace<DirectTexture>();
        direct->image_id = image.image_id; direct->path = *image.path;
        direct->width = image.width; direct->height = image.height;
        direct->color_space = ColorSpace::srgb; direct->alpha_mode = AlphaMode::straight; return;
    }
    const auto& atlas = data.atlases().at(*image.atlas_index); const auto& region = atlas.regions().at(*image.region_index); const auto& page = atlas.pages().at(region.page_index);
    auto* value = std::get_if<AtlasTexture>(&output);
    if (!value) value = &output.emplace<AtlasTexture>();
    value->image_id = image.image_id; value->atlas_id = atlas.atlas_id(); value->region_id = region.region_id;
    value->page_id = page.page_id; value->page_path = page.image_path; value->width = page.width; value->height = page.height;
    value->color_space = atlas.color_space(); value->alpha_mode = atlas.alpha_mode();
    value->min_filter = page.min_filter; value->mag_filter = page.mag_filter; value->wrap_u = page.wrap_u; value->wrap_v = page.wrap_v;
}
Point page_uv(const AtlasRegion& region, float u, float v) {
    const double x = (static_cast<double>(u) * region.source_width - region.source_x) / region.logical_width();
    const double y = (static_cast<double>(v) * region.source_height - region.source_y) / region.logical_height();
    const auto interpolate = [&](float tl, float tr, float br, float bl) {
        const double top = tl + (static_cast<double>(tr) - tl) * x, bottom = bl + (static_cast<double>(br) - bl) * x;
        return static_cast<float>(top + (bottom - top) * y);
    };
    const auto& c = region.uvs; return {interpolate(c[0].x, c[1].x, c[2].x, c[3].x), interpolate(c[0].y, c[1].y, c[2].y, c[3].y)};
}
RenderBlendMode blend(detail::BlendMode mode) {
    switch (mode) {
        case detail::BlendMode::normal: return RenderBlendMode::normal;
        case detail::BlendMode::add: return RenderBlendMode::add;
        case detail::BlendMode::multiply: return RenderBlendMode::multiply;
        case detail::BlendMode::screen: return RenderBlendMode::screen;
    }
    throw Error(ErrorCode::invalid_state, "apply", "Unknown compiled blend mode.");
}
bool finite(const Vertex& v) { return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.u) && std::isfinite(v.v); }
Affine diagnostic_affine(const Affine& affine, const Polygon& vertices) {
    const auto inverse = affine.inverse(); if (!inverse) return {};
    for (const auto& v : vertices) { const auto local = inverse->transform({v.x, v.y}); if (!std::isfinite(local.x) || !std::isfinite(local.y)) return {}; }
    return affine;
}
}
bool PacketBuilder::draw(const animation::Pose& pose, std::size_t ai, std::uint32_t draw_index, std::int64_t source_z_index, RenderAttachment& result) {
    const auto& data = pose.data(); const auto& definition = pose.model().attachments[ai]; const auto& slot = pose.model().slots[definition.slot];
    const auto& id = data.catalog(RuntimeCatalogKind::attachment)[ai].id; const auto selected = pose.selected_image(ai);
    if (!selected) throw Error(ErrorCode::missing_resource, "apply", "Renderable attachment has no selected image.", "imageId", id);
    const auto& image = data.images().at(*selected);
    const AtlasRegion* region = image.atlas_index ? &data.atlases().at(*image.atlas_index).regions().at(*image.region_index) : nullptr;
    const auto source_affine = pose.attachment_affine(ai);
    const bool region_quad = definition.kind == detail::AttachmentKind::region && !clip_.active;
    auto* geometry = &first_; auto* spare = &second_; geometry->clear();
    if (definition.kind == detail::AttachmentKind::region) {
        float left = -static_cast<float>(image.width) * .5f, top = static_cast<float>(image.height) * .5f;
        float right = -left, bottom = -top;
        if (region && region_quad) {
            left += static_cast<float>(region->source_x); right = left + static_cast<float>(region->logical_width());
            top -= static_cast<float>(region->source_y); bottom = top - static_cast<float>(region->logical_height());
        }
        const auto append = [&](float x, float y, float u, float v) { const auto p = source_affine.transform({x, y}); geometry->vertices.push_back({p.x, p.y, u, v}); };
        append(left, top, 0, 0); append(right, top, 1, 0); append(right, bottom, 1, 1); append(left, bottom, 0, 1);
        geometry->indices.assign({0, 1, 2, 0, 2, 3});
    } else {
        pose.source_vertices(ai, source_xy_); const auto& source = pose.model().attachments[definition.geometry_owner].geometry;
        geometry->vertices.resize(source_xy_.size() / 2);
        for (std::size_t i = 0; i < geometry->vertices.size(); ++i) geometry->vertices[i] = {source_xy_[2 * i], source_xy_[2 * i + 1], source.uvs[2 * i], source.uvs[2 * i + 1]};
        geometry->indices = source.indices;
    }
    // Validate before half-plane classification; NaN must not accidentally classify a visible draw out.
    for (const auto& v : geometry->vertices) if (!finite(v)) throw Error(ErrorCode::non_finite, "apply", "Source render geometry is non-finite.", "vertices", id);
    if (clip_.active) { apply_clip(*geometry, clip_, *spare, scratch_); std::swap(geometry, spare); }
    if (region && !region_quad) {
        const float width = static_cast<float>(region->source_width), height = static_cast<float>(region->source_height);
        if (trim_atlas(*geometry, static_cast<float>(region->source_x) / width, static_cast<float>(region->source_x + region->logical_width()) / width,
            static_cast<float>(region->source_y) / height, static_cast<float>(region->source_y + region->logical_height()) / height, *spare, scratch_)) std::swap(geometry, spare);
    }
    if (geometry->vertices.size() > max_render_attachment_vertices_v1) throw Error(ErrorCode::resource_limit, "apply", "Rendered attachment exceeds the v1 vertex limit.");
    if (geometry->indices.empty()) return false;
    result.draw_index = draw_index; result.source_z_index = source_z_index;
    result.slot_id = data.catalog(RuntimeCatalogKind::slot)[definition.slot].id; result.attachment_id = id; result.image_id = image.image_id;
    result.geometry_kind = region_quad ? GeometryKind::region_quad : GeometryKind::mesh_triangles;
    texture(result.texture, data, image); result.blend = blend(slot.blend); const auto tint = pose.attachment_tint(ai); result.tint = {tint.light, tint.dark, tint.alpha};
    if (!std::isfinite(result.tint.alpha)) throw Error(ErrorCode::non_finite, "apply", "Final alpha is non-finite.", "alpha", id);
    result.world_vertices_xy.resize(geometry->vertices.size() * 2); result.uvs.resize(result.world_vertices_xy.size());
    for (std::size_t i = 0; i < geometry->vertices.size(); ++i) {
        const auto& v = geometry->vertices[i]; const auto uv = region ? (region_quad ? region->uvs.at(i) : page_uv(*region, v.u, v.v)) : Point{v.u, v.v};
        if (!finite(v) || !std::isfinite(uv.x) || !std::isfinite(uv.y)) throw Error(ErrorCode::non_finite, "apply", "Final render geometry is non-finite.", "vertices", id);
        result.world_vertices_xy[2 * i] = v.x; result.world_vertices_xy[2 * i + 1] = v.y; result.uvs[2 * i] = uv.x; result.uvs[2 * i + 1] = uv.y;
    }
    result.indices = geometry->indices; result.authored_triangle_facing.resize(result.indices.size() / 3);
    for (std::size_t i = 0; i < result.indices.size(); i += 3) {
        const auto& a = geometry->vertices.at(result.indices[i]); const auto& b = geometry->vertices.at(result.indices[i + 1]); const auto& c = geometry->vertices.at(result.indices[i + 2]);
        const float signed_area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (!std::isfinite(signed_area)) throw Error(ErrorCode::non_finite, "apply", "Final triangle area is non-finite.", "indices", id);
        result.authored_triangle_facing[i / 3] = signed_area < 0 ? TriangleFacing::toward_viewer : signed_area > 0 ? TriangleFacing::away_from_viewer : TriangleFacing::edge_on;
        if (signed_area < 0) std::swap(result.indices[i + 1], result.indices[i + 2]);
    }
    result.source_affine = diagnostic_affine(source_affine, geometry->vertices);
    return true;
}
void PacketBuilder::build_into(const animation::Pose& pose, std::vector<RenderAttachment>& attachments) {
    std::size_t draw_count = 0; clip_.clear();
    for (std::size_t ordinal = 0; ordinal < pose.order.size(); ++ordinal) {
        const auto slot = pose.order[ordinal]; const auto& definition = pose.model().slots[slot]; const auto selected = pose.slots[slot].attachment;
        if (selected && pose.active_bones[definition.bone]) {
            const auto& attachment = pose.model().attachments[*selected];
            if (attachment.kind == detail::AttachmentKind::clipping) {
                try { pose.source_vertices(*selected, source_xy_); prepare_clip(source_xy_, attachment.convex, attachment.inverse, attachment.end_slot, clip_, scratch_); }
                catch (const Error& error) { if (error.code != ErrorCode::non_finite) throw; clip_.clear(); }
            } else if (attachment.kind == detail::AttachmentKind::region || attachment.kind == detail::AttachmentKind::mesh) {
                if (draw_count > std::numeric_limits<std::uint32_t>::max() || ordinal > static_cast<std::size_t>(std::numeric_limits<std::int64_t>::max()))
                    throw Error(ErrorCode::resource_limit, "apply", "Render draw index exceeds its representable range.");
                if (draw_count == attachments.size()) attachments.emplace_back();
                if (draw(pose, *selected, static_cast<std::uint32_t>(draw_count), pose.order_sampled ? static_cast<std::int64_t>(ordinal) : definition.z_index, attachments[draw_count])) ++draw_count;
            }
        }
        if (clip_.active && clip_.end_slot == slot) clip_.clear();
    }
    attachments.resize(draw_count);
}
std::vector<RenderAttachment> PacketBuilder::build_geometry(const animation::Pose& pose) {
    std::vector<RenderAttachment> attachments; build_into(pose, attachments); return attachments;
}
std::shared_ptr<std::vector<RenderAttachment>> PacketBuilder::prepare_geometry(const animation::Pose& pose) {
    std::shared_ptr<std::vector<RenderAttachment>> available;
    for (auto& cached : storage_) if (!cached || cached.use_count() == 1) {
        if (!cached) cached = std::make_shared<std::vector<RenderAttachment>>();
        available = cached; break;
    }
    if (!available) {
        available = std::make_shared<std::vector<RenderAttachment>>();
        storage_[replacement_] = available; replacement_ = (replacement_ + 1) % storage_.size();
    }
    build_into(pose, *available); return available;
}
RenderPacket PacketBuilder::build(const animation::Pose& pose) { return RenderPacket(prepare_geometry(pose)); }
}
