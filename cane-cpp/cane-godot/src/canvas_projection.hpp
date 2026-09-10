#pragma once
#include "skeleton_data.hpp"
#include <cane/pose_queries.hpp>
#include <godot_cpp/classes/shader.hpp>
#include <godot_cpp/classes/shader_material.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/rid.hpp>
#include <array>

namespace cane_godot {
struct ProjectionStats {
    std::int64_t attachments = 0, draws = 0, vertices = 0, triangles = 0, backbuffer_copies = 0, packet_uploads = 0;
    std::int64_t material_parameter_writes = 0, material_shader_changes = 0;
    std::int64_t unbatched_draws = 0, layout_uploads = 0;
};
struct SlotMount { godot::RID anchor; std::uint32_t slot_order; bool before; std::int64_t sibling_order; };

class CanvasProjection {
    struct MaterialState {
        bool initialized = false;
        godot::RID texture;
        cane::RenderBlendMode blend = cane::RenderBlendMode::normal;
        cane::ColorSpace color_space = cane::ColorSpace::srgb;
        cane::AlphaMode alpha_mode = cane::AlphaMode::straight;
        cane::FinalTint tint;
        cane::TextureFilter min_filter = cane::TextureFilter::linear, mag_filter = cane::TextureFilter::linear;
        cane::TextureWrap wrap_u = cane::TextureWrap::clamp, wrap_v = cane::TextureWrap::clamp;
    };
    struct Draw {
        godot::RID item;
        std::string slot_id;
        godot::Ref<godot::ShaderMaterial> material;
        godot::PackedVector2Array points, uvs;
        godot::PackedInt32Array indices;
        MaterialState material_state;
    };
    struct Batch {
        std::size_t first = 0, end = 0, triangle = 0, vertices = 0, indices = 0;
        bool special = false;
        MaterialState material;
        godot::Ref<godot::Texture2D> texture;
    };
    std::vector<Draw> draws_;
    std::vector<Batch> batches_;
    std::vector<std::size_t> slot_breaks_;
    godot::RID root_;
    std::array<godot::Ref<godot::Shader>, 8> shaders_;
    ProjectionStats stats_;
    godot::Ref<godot::Shader> shader(cane::RenderBlendMode blend, cane::ColorSpace color_space);
    void update_material(Draw& draw, const MaterialState& next, const godot::Ref<godot::Texture2D>& texture, ProjectionStats& stats);
    static bool same_material(const MaterialState& a, const MaterialState& b);
    void plan_batches(const cane::RenderPacket& packet, const LoadedAsset& resources, const std::vector<std::size_t>& slot_breaks, ProjectionStats& stats);
public:
    CanvasProjection() = default;
    ~CanvasProjection();
    CanvasProjection(const CanvasProjection&) = delete;
    CanvasProjection& operator=(const CanvasProjection&) = delete;
    void publish(godot::RID parent, const cane::RenderPacket& packet, const LoadedAsset& resources,
        const std::vector<std::size_t>& slot_breaks = {}, bool visible = true, bool new_publication = true);
    bool layout_matches(const std::vector<std::size_t>& slot_breaks) const { return slot_breaks_ == slot_breaks; }
    // A prepared hidden projection replaces the visible projection without allocation.
    void commit(CanvasProjection& prepared) noexcept;
    void reuse_shaders(const CanvasProjection& previous) { shaders_ = previous.shaders_; }
    void clear();
    // Host anchors are not owned here. Hidden Slots still participate in Core order.
    void arrange_slots(const std::vector<cane::SlotState>& slots, std::vector<SlotMount> mounts);
    ProjectionStats stats() const { return stats_; }
};
}
