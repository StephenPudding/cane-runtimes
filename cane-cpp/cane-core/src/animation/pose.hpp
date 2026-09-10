#pragma once
#include "cane/runtime_data.hpp"
#include "model.hpp"
#include "constraints/diagnostics.hpp"

namespace cane::animation {
struct Sampling {
    std::optional<float> frame_step_seconds;
    bool stepped = false;
    [[nodiscard]] float time(float resolved_time) const { return frame_step_seconds ? fixed_frame_time(resolved_time, *frame_step_seconds) : resolved_time; }
};
struct Layer {
    const Clip& clip;
    float time = 0, alpha = 1;
    bool additive = false, attachments = true, draw_order = true, stepped = false;
    // Mixer-owned property fades can be supplied without constructing strings or allocating callbacks.
    const void* weight_context = nullptr;
    float (*property_alpha)(const void*, PropertyKey) = nullptr;
    [[nodiscard]] float weight(PropertyDomain domain, std::size_t target = 0, std::size_t component = 0) const;
};
struct SlotPose {
    std::optional<std::string> key;
    std::optional<std::size_t> attachment;
    detail::Rgb color{255, 255, 255};
    std::optional<detail::Rgb> dark;
    float alpha = 1;
};
struct DeformPose { std::vector<float> values; bool enabled = false; };
struct Tint { detail::Rgb light; std::optional<detail::Rgb> dark; float alpha = 1; };

// Private mutable evaluation workspace, never a published frame. Solvers update the same world
// matrices used by source geometry. Clock/mixer/transactional publication live above this stage.
class Pose {
    RuntimeData data_;
    std::vector<float> sampled_deform_, canonical_deform_;
    std::vector<bool> skin_active_, order_members_;
    void apply_deform(const AttachmentTimeline& timeline, const Layer& layer);
public:
    std::vector<BoneLocal> locals, regions;
    std::vector<TransformMode> modes;
    std::vector<Affine> world;
    std::vector<SlotPose> slots;
    std::vector<detail::ConstraintParameters> constraints;
    std::vector<cane::constraints::Diagnostic> diagnostics;
    std::vector<DeformPose> deforms;
    std::vector<std::uint32_t> sequence_indices;
    std::vector<std::size_t> skins, order;
    std::vector<bool> active_bones, active_constraints;
    bool order_sampled = false;

    explicit Pose(RuntimeData data);
    [[nodiscard]] const RuntimeData& data() const noexcept { return data_; }
    [[nodiscard]] const detail::RuntimeModel& model() const noexcept;
    void reset(const std::vector<std::size_t>& active_skins);
    void apply(const Layer& layer);
    void resolve_attachments();
    void update_world(const Affine& root = {});
    [[nodiscard]] std::optional<std::size_t> selected_image(std::size_t attachment) const;
    [[nodiscard]] Affine attachment_affine(std::size_t attachment) const;
    [[nodiscard]] Tint attachment_tint(std::size_t attachment) const;
    void source_vertices(std::size_t attachment, std::vector<float>& output) const;
    // Explicit canonical deform; null projects setup points through the current solved bones.
    void source_vertices(std::size_t attachment, std::vector<float>& output, const std::vector<float>* canonical_deform) const;
};
}
