#pragma once
#include "cane/runtime_player.hpp"
#include "animation/playback.hpp"
#include "constraints/physics.hpp"
#include "constraints/solvers.hpp"
#include "geometry/packet_builder.hpp"
#include "operation.hpp"
#include <functional>

namespace cane::detail {
struct EventBatchAccess {
    [[nodiscard]] static EventBatch own(std::vector<RuntimeEvent> events) { return EventBatch(std::move(events)); }
    [[nodiscard]] static EventBatch append(const EventBatch& previous, const EventBatch& next);
};
struct Evaluation {
    animation::Pose pose;
    RenderPacket packet;
    float time = 0;
    EvaluationStats stats;
    GeometryModifierStats geometry_stats;
};
struct RuntimeFrameState {
    Evaluation evaluated;
    std::uint64_t sequence;
    std::vector<BonePose> bones;
    std::vector<std::string> configured_skins, sampled_skins;
    RuntimeFrameState(Evaluation result, std::uint64_t seq, const std::vector<std::size_t>& skins);
};
struct RuntimeFrameAccess {
    [[nodiscard]] static RuntimeFrame own(Evaluation result, std::uint64_t sequence, const std::vector<std::size_t>& skins) {
        return RuntimeFrame(std::make_shared<const RuntimeFrameState>(std::move(result), sequence, skins));
    }
    [[nodiscard]] static const animation::Pose& pose(const RuntimeFrame& frame) noexcept { return frame.state_->evaluated.pose; }
};
struct HostState {
    RegionLocal root_local;
    Affine root;
    PhysicsEnvironment environment;
    std::vector<std::size_t> skins;
    std::map<std::size_t, BoneOverride> bones;
    std::map<std::size_t, RegionLocal> regions;
    std::optional<std::vector<std::size_t>> order;
    std::map<std::size_t, std::optional<std::string>> attachments;
    std::map<std::size_t, FinalTint> tints;
    std::map<std::size_t, ConstraintOverride> constraints;
    // Resolved deform-owner identity; weighted entries contain canonical influence offsets.
    std::map<std::size_t, std::vector<float>> deforms;
    GeometryModifiers geometry;
    explicit HostState(const RuntimeData& data);
};
struct PlayerState {
    animation::Playback live, baseline;
    constraints::PhysicsStore physics;
    HostState host;
    // Ordinary frame transactions share this immutable overlay; catalog copies are limited
    // to explicit resource changes and allocating snapshot queries.
    std::shared_ptr<const RuntimeResourceSnapshot> resources = std::make_shared<const RuntimeResourceSnapshot>();
    std::optional<RuntimeFrame> frame;
    EventBatch pending;
    explicit PlayerState(const RuntimeData& data);
};

// The observable state is replaced by one noexcept pointer swap. Scratch is private and may
// change during a failed candidate evaluation; it never backs a retained frame or notification.
class RuntimePlayerImpl {
    RuntimeData data_;
    RuntimeData source_data_;
    animation::PlaybackWorkspace mixer_;
    constraints::Workspace constraints_;
    geometry::PacketBuilder packets_;
public:
    std::unique_ptr<PlayerState> state;
    bool callback_active = false;
    explicit RuntimePlayerImpl(RuntimeData data, std::optional<HostState> host = {},
                               std::optional<animation::Playback> configuration = {});
    RuntimePlayerImpl(RuntimeData effective, RuntimeData source, std::unique_ptr<PlayerState> candidate);
    [[nodiscard]] const RuntimeData& data() const noexcept { return data_; }
    [[nodiscard]] const RuntimeData& source_data() const noexcept { return source_data_; }
    [[nodiscard]] RuntimeFrame frame() const { return *state->frame; }
    void require_idle(const char* operation) const;
    [[nodiscard]] std::uint64_t next_sequence(const char* operation) const;
    [[nodiscard]] std::size_t index(RuntimeCatalogKind kind, std::string_view id, const char* operation, const char* field) const;
    [[nodiscard]] Evaluation evaluate(PlayerState& candidate, constraints::PhysicsBudget& budget, const animation::Sampling& sampling,
        const PoseModifiers* modifiers = nullptr, const char* operation = "apply", const GeometryModifiers* geometry = nullptr,
        std::optional<std::uint64_t> sequence = {}, std::optional<float> physics_delta = {});
    void publish(PlayerState& candidate, Evaluation result, std::uint64_t sequence);
    using Mutation = std::function<void(PlayerState&, animation::EventSink&, animation::EventSink&)>;
    void configure(const char* operation, const Mutation& mutation, bool publish_frame = true);
    [[nodiscard]] RuntimeStep step(float delta, bool apply, const SamplingOptions& sampling, const char* operation, const PoseModifiers* modifiers = nullptr,
        const GeometryModifiers* geometry = nullptr);
    [[nodiscard]] RuntimeStep sample(float time, float fixed_step, const SamplingOptions& sampling, const char* operation);
};

// A detached implementation may run callbacks that capture the original player. Keep that
// player read-only until evaluation finishes, and release this guard before swapping it out.
class PlayerCallbackGuard {
    bool& active_;
public:
    explicit PlayerCallbackGuard(RuntimePlayerImpl& player) : active_(player.callback_active) { active_ = true; }
    ~PlayerCallbackGuard() { active_ = false; }
    PlayerCallbackGuard(const PlayerCallbackGuard&) = delete;
    PlayerCallbackGuard& operator=(const PlayerCallbackGuard&) = delete;
};

void apply_pose_modifiers(animation::Pose& pose, const PoseModifiers& modifiers, const char* operation);
[[nodiscard]] HostState reconcile_host(const HostState& host, const RuntimeData& previous, const RuntimeData& next, const char* operation);

[[nodiscard]] animation::Sampling checked_sampling(const SamplingOptions& value, const char* operation);
void require_finite(float value, const char* operation, const char* field);
void require_nonnegative(float value, const char* operation, const char* field);
[[nodiscard]] BoneLocal bone_local(const RegionLocal& value) noexcept;
void validate_local(const BoneLocal& value, const char* operation, const char* field);
}
