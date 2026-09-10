#pragma once
#include "animation/clip.hpp"
#include <variant>

namespace cane::detail {
using Rgb = std::array<std::uint8_t, 3>;
enum class AttachmentKind { region, mesh, path, point, bounding_box, clipping };
enum class BlendMode { normal, add, multiply, screen };
struct SlotDefinition {
    std::size_t bone = 0;
    std::optional<std::string> attachment_key;
    std::int64_t z_index = 0;
    BlendMode blend = BlendMode::normal;
    Rgb color{255, 255, 255};
    std::optional<Rgb> dark;
    float alpha = 1;
};
struct Influence {
    std::size_t bone = 0;
    float weight = 0;
    Point setup_local;
    // Present only for the coordinate-less form, even when explicit coordinates have a bind entry.
    std::optional<Affine> bind_inverse;
};
struct VertexDefinition {
    std::vector<float> positions, uvs;
    std::vector<std::uint32_t> indices;
    std::vector<Influence> influences;
    // Weighted points use half-open ranges into influences, including zero-weight entries.
    std::vector<std::size_t> influence_starts;
    [[nodiscard]] bool weighted() const noexcept { return !influence_starts.empty(); }
    [[nodiscard]] std::size_t deform_components() const noexcept { return weighted() ? influences.size() * 2 : positions.size(); }
};
struct AttachmentDefinition {
    AttachmentKind kind = AttachmentKind::region;
    std::size_t slot = 0, geometry_owner = 0, deform_owner = 0;
    std::optional<std::size_t> image;
    BoneLocal local;
    Rgb color{255, 255, 255};
    float alpha = 1;
    VertexDefinition geometry;
    std::vector<std::size_t> sequence_images;
    std::uint32_t sequence_setup = 0;
    bool closed = false, constant_speed = true, convex = false, inverse = false;
    std::vector<float> lengths;
    std::optional<std::size_t> end_slot;
};
struct SkinMapping {
    std::size_t slot = 0;
    std::optional<std::string> placeholder;
    std::optional<std::size_t> attachment;
};
struct SkinDefinition { std::vector<SkinMapping> mappings; std::vector<std::size_t> bones, constraints; };
inline constexpr std::size_t scalar_parameter_count = static_cast<std::size_t>(animation::ConstraintProperty::bend_positive);
struct PhysicsParameters {
    float x = 0, y = 0, rotate = 0, scale_x = 0, shear_x = 0, limit = 5000;
    double fps = 60;
};
struct SliderParameters { float source_offset = 0, time_offset = 0, time_scale = 1, range_max = 0; };
struct ConstraintParameters {
    std::array<float, scalar_parameter_count> scalars{};
    std::array<bool, 3> booleans{true, false, false};
    bool explicit_ik_target = false;
    // Host-editable settings live alongside the sampled channels, never in shared definitions.
    std::array<float, 6> transform_offsets{};
    float path_rotation = 0;
    PhysicsParameters physics;
    SliderParameters slider;
    float& operator[](animation::ConstraintProperty property) { return scalars.at(static_cast<std::size_t>(property)); }
    float operator[](animation::ConstraintProperty property) const { return scalars.at(static_cast<std::size_t>(property)); }
};
enum class ScaleYMode { none, uniform, volume };
enum class MappedProperty { rotate, x, y, scale_x, scale_y, shear_y };
struct IkDefinition {
    std::vector<std::size_t> bones;
    std::optional<std::size_t> target;
    ScaleYMode uniform = ScaleYMode::none;
    std::uint32_t iterations = 1;
    float threshold = 0;
};
struct MappingTarget { MappedProperty property = MappedProperty::rotate; float offset = 0, max = 1, scale = 1; };
struct MappingSource { MappedProperty property = MappedProperty::rotate; float offset = 0; std::vector<MappingTarget> targets; };
struct TransformMapping { bool local_source = false, local_target = false, clamp = false; std::vector<MappingSource> properties; };
struct TransformDefinition {
    std::vector<std::size_t> bones;
    std::size_t target = 0;
    bool local = false, relative = false;
    std::optional<TransformMapping> mapping;
};
enum class PositionMode { fixed, percent };
enum class SpacingMode { length, fixed, percent, proportional };
enum class RotateMode { tangent, chain, chain_scale };
struct PathDefinition {
    std::vector<std::size_t> bones;
    std::size_t target_slot = 0;
    PositionMode position_mode = PositionMode::fixed;
    SpacingMode spacing_mode = SpacingMode::length;
    RotateMode rotate_mode = RotateMode::tangent;
};
struct PhysicsDefinition {
    std::size_t bone = 0;
    ScaleYMode scale_y = ScaleYMode::none;
    std::array<bool, scalar_parameter_count> globals{};
};
struct SliderDefinition {
    std::size_t animation = 0;
    std::optional<std::size_t> source_bone;
    MappedProperty source_property = MappedProperty::rotate;
    bool looping = false, additive = false, local = false;
};
struct ConstraintDefinition {
    animation::ConstraintKind kind = animation::ConstraintKind::ik;
    ConstraintParameters setup;
    std::variant<IkDefinition, TransformDefinition, PathDefinition, PhysicsDefinition, SliderDefinition> definition;
};
struct RuntimeModel {
    std::vector<SlotDefinition> slots;
    std::vector<AttachmentDefinition> attachments;
    std::vector<SkinDefinition> skins;
    std::vector<ConstraintDefinition> constraints;
    std::vector<std::vector<std::size_t>> bone_skins, constraint_skins;
    std::optional<std::size_t> default_skin;
    std::vector<std::size_t> setup_order;
};
}
