#pragma once
#include "math.hpp"
#include "render_packet.hpp"
#include "geometry_modifiers.hpp"
#include <cstdint>
#include <memory>
#include <string_view>

namespace cane {
namespace detail { struct RuntimeFrameState; struct RuntimeFrameAccess; }
struct BonePose {
    std::string bone_id;
    Affine matrix;
    BoneLocal local;
    TransformMode transform_mode = TransformMode::normal;
    bool active = true;
};
struct EvaluationStats {
    std::uint64_t animation_samples = 0, constraint_geometry_solves = 0, frames_published = 0;
};

// Copies retain one immutable, owned publication. No frame aliases mutable player scratch.
class RuntimeFrame {
    std::shared_ptr<const detail::RuntimeFrameState> state_;
    explicit RuntimeFrame(std::shared_ptr<const detail::RuntimeFrameState> state) : state_(std::move(state)) {}
    friend struct detail::RuntimeFrameAccess;
public:
    [[nodiscard]] std::uint64_t sequence() const noexcept;
    [[nodiscard]] float time_seconds() const noexcept;
    [[nodiscard]] const std::vector<BonePose>& bones() const noexcept;
    [[nodiscard]] const BonePose& bone(std::string_view bone_id) const;
    [[nodiscard]] const std::vector<std::string>& configured_skin_ids() const noexcept;
    [[nodiscard]] const std::vector<std::string>& sampled_skin_ids() const noexcept;
    [[nodiscard]] const RenderPacket& render_packet() const noexcept;
    [[nodiscard]] EvaluationStats evaluation_stats() const noexcept;
    [[nodiscard]] GeometryModifierStats geometry_modifier_stats() const noexcept;
};
}
