#include "state.hpp"
#include <limits>

namespace cane::detail {
struct BoundsAccess {
    static void include(BoundsAabb& aabb, const std::vector<float>& vertices) {
        if (vertices.size() % 2 != 0) throw Error(ErrorCode::invalid_state, "writeBounds", "Bounds vertices must contain XY pairs.", "vertices");
        for (std::size_t i = 0; i < vertices.size(); i += 2) {
            const auto x = vertices[i], y = vertices[i + 1];
            require_finite(x, "writeBounds", "vertices"); require_finite(y, "writeBounds", "vertices");
            if (aabb.empty) { aabb.min_x = aabb.max_x = x; aabb.min_y = aabb.max_y = y; aabb.empty = false; }
            else { aabb.min_x = std::min(aabb.min_x, x); aabb.max_x = std::max(aabb.max_x, x); aabb.min_y = std::min(aabb.min_y, y); aabb.max_y = std::max(aabb.max_y, y); }
        }
    }
    static void write(const RuntimeFrame& frame, RuntimeBounds& output, const BoundsOptions& options) {
        auto& next = output.staging_; next.sequence = frame.sequence(); next.aabb = {}; next.count = 0;
        if (options.include_render_geometry) for (const auto& draw : frame.render_packet().attachments())
            if (options.include_transparent || draw.tint.alpha > 0) include(next.aabb, draw.world_vertices_xy);
        if (options.include_bounding_boxes) {
            const auto& pose = RuntimeFrameAccess::pose(frame); const auto& model = pose.model(); const auto& data = pose.data();
            for (std::size_t draw = 0; draw < pose.order.size(); ++draw) {
                const auto slot_index = pose.order[draw]; const auto attachment = pose.slots[slot_index].attachment;
                if (!attachment || model.attachments[*attachment].kind != AttachmentKind::bounding_box) continue;
                if (draw > std::numeric_limits<std::uint32_t>::max()) throw Error(ErrorCode::resource_limit, "writeBounds", "Bounds Slot draw index exceeds u32.", "drawIndex");
                if (next.pool.size() == next.count) next.pool.emplace_back();
                auto& polygon = next.pool[next.count]; polygon.slot_id = data.catalog(RuntimeCatalogKind::slot)[slot_index].id;
                polygon.attachment_id = data.catalog(RuntimeCatalogKind::attachment)[*attachment].id; polygon.draw_index = static_cast<std::uint32_t>(draw);
                pose.source_vertices(*attachment, polygon.world_vertices_xy);
                if (polygon.world_vertices_xy.size() < 6) throw Error(ErrorCode::invalid_state, "writeBounds", "Bounding Box must contain at least three points.", "vertices", polygon.attachment_id);
                include(next.aabb, polygon.world_vertices_xy); ++next.count;
            }
        }
        next.aabb.width = next.aabb.max_x - next.aabb.min_x; next.aabb.height = next.aabb.max_y - next.aabb.min_y;
        require_finite(next.aabb.width, "writeBounds", "aabb.width"); require_finite(next.aabb.height, "writeBounds", "aabb.height");
        using std::swap; swap(output.published_, next);
    }
};
}
namespace cane {
void RuntimePlayer::write_bounds(RuntimeBounds& output, const BoundsOptions& options) const {
    detail::operation("writeBounds", [&] { detail::BoundsAccess::write(*impl().state->frame, output, options); });
}
BoundsSnapshot RuntimePlayer::query_bounds(const BoundsOptions& options) const {
    return detail::operation("queryBounds", [&] { RuntimeBounds output; write_bounds(output, options); return output.snapshot(); });
}
}
