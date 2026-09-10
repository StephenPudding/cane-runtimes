#pragma once
#include "atlas.hpp"
#include <optional>
#include <variant>

namespace cane {
namespace geometry { class PacketBuilder; class ModifierStage; }
inline constexpr std::size_t max_render_attachment_vertices_v1 = 65536;
enum class GeometryKind { region_quad, mesh_triangles };
enum class RenderBlendMode { normal, add, multiply, screen };
enum class TriangleFacing { toward_viewer, away_from_viewer, edge_on };
enum class FrontFace { counter_clockwise };
enum class CoordinateSystem { x_right_y_up };
enum class UvOrigin { top_left };

struct DirectTexture {
    std::string image_id, path;
    std::uint32_t width = 0, height = 0;
    ColorSpace color_space = ColorSpace::srgb;
    AlphaMode alpha_mode = AlphaMode::straight;
};
struct AtlasTexture {
    std::string image_id, atlas_id, region_id, page_id, page_path;
    std::uint32_t width = 0, height = 0;
    ColorSpace color_space = ColorSpace::srgb;
    AlphaMode alpha_mode = AlphaMode::straight;
    TextureFilter min_filter = TextureFilter::linear, mag_filter = TextureFilter::linear;
    TextureWrap wrap_u = TextureWrap::clamp, wrap_v = TextureWrap::clamp;
};
using TextureDescriptor = std::variant<DirectTexture, AtlasTexture>;
struct FinalTint {
    std::array<std::uint8_t, 3> light{255, 255, 255};
    std::optional<std::array<std::uint8_t, 3>> dark;
    float alpha = 1;
    [[nodiscard]] bool two_color() const noexcept { return dark.has_value(); }
};
struct RenderAttachment {
    std::uint32_t draw_index = 0;
    std::int64_t source_z_index = 0;
    std::string slot_id, attachment_id, image_id;
    GeometryKind geometry_kind = GeometryKind::region_quad;
    TextureDescriptor texture;
    RenderBlendMode blend = RenderBlendMode::normal;
    FinalTint tint;
    Affine source_affine; // Diagnostic only. World vertices are final, including clipping and trim.
    std::vector<float> world_vertices_xy, uvs;
    std::vector<std::uint32_t> indices;
    std::vector<TriangleFacing> authored_triangle_facing;
    static constexpr FrontFace front_face = FrontFace::counter_clockwise;
};

// Independently owned immutable publication. Storage can be reused only after every published
// owner has released it; retaining a packet or frame prevents later writes to its buffers.
class RenderPacket {
    std::shared_ptr<const std::vector<RenderAttachment>> attachments_;
    explicit RenderPacket(std::vector<RenderAttachment> attachments)
        : attachments_(std::make_shared<const std::vector<RenderAttachment>>(std::move(attachments))) {}
    explicit RenderPacket(std::shared_ptr<const std::vector<RenderAttachment>> attachments)
        : attachments_(std::move(attachments)) {}
    friend class geometry::PacketBuilder;
    friend class geometry::ModifierStage;
public:
    RenderPacket() : RenderPacket(std::vector<RenderAttachment>{}) {}
    [[nodiscard]] const std::vector<RenderAttachment>& attachments() const noexcept { return *attachments_; }
    static constexpr CoordinateSystem coordinate_system = CoordinateSystem::x_right_y_up;
    static constexpr UvOrigin uv_origin = UvOrigin::top_left;
    static constexpr ColorSpace tint_color_space = ColorSpace::srgb;
    static constexpr AlphaMode tint_alpha_mode = AlphaMode::straight;
};
}
