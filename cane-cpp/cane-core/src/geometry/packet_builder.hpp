#pragma once
#include "animation/pose.hpp"
#include "clipping.hpp"

namespace cane::geometry {
// Per-player scratch. This consumes one evaluated pose; it never samples or solves it.
class PacketBuilder {
    GeometryBuffer first_, second_;
    ClipWorkspace scratch_;
    PreparedClip clip_;
    std::vector<float> source_xy_;
    // Two recent buffers are cached. Shared published owners prevent a buffer from being
    // borrowed; cache eviction releases only our owner and cannot invalidate an old packet.
    std::array<std::shared_ptr<std::vector<RenderAttachment>>, 2> storage_;
    std::size_t replacement_ = 0;
    [[nodiscard]] bool draw(const animation::Pose& pose, std::size_t attachment,
        std::uint32_t draw_index, std::int64_t source_z_index, RenderAttachment& result);
    void build_into(const animation::Pose& pose, std::vector<RenderAttachment>& attachments);
public:
    // Unpublished owned geometry for Core stages. No engine or public frame can observe it.
    [[nodiscard]] std::vector<RenderAttachment> build_geometry(const animation::Pose& pose);
    // Core-only unpublished lease. The modifier stage seals it as const before publication.
    [[nodiscard]] std::shared_ptr<std::vector<RenderAttachment>> prepare_geometry(const animation::Pose& pose);
    [[nodiscard]] RenderPacket build(const animation::Pose& pose);
};
}
