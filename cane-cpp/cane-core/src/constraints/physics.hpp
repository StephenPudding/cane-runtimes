#pragma once
#include "animation/pose.hpp"

namespace cane::constraints {
struct Context;
struct PhysicsEnvironment {
    float wind_x = 1, wind_y = 0, gravity_x = 0, gravity_y = 1;
    [[nodiscard]] bool finite() const noexcept;
};
struct PhysicsStep {
    float delta_seconds = 0, root_scale_x = 1, root_scale_y = 1;
    PhysicsEnvironment environment;
};
struct PhysicsState {
    bool reset = true;
    float ux = 0, uy = 0, cx = 0, cy = 0, tip_x = 0, tip_y = 0;
    float x_offset = 0, y_offset = 0, x_lag = 0, y_lag = 0, x_velocity = 0, y_velocity = 0;
    float rotate_offset = 0, rotate_lag = 0, rotate_velocity = 0, scale_offset = 0, scale_lag = 0, scale_velocity = 0, remaining = 0;
    [[nodiscard]] bool finite() const noexcept;
};
class PhysicsBudget {
    std::uint32_t remaining_ = 1000000;
public:
    [[nodiscard]] std::uint32_t remaining() const noexcept { return remaining_; }
    void consume();
};
enum class PhysicsHostMotion { move, teleport, preserve_inertia, clear_inertia };
struct PhysicsClockSample {
    std::optional<std::size_t> animation;
    // Raw time drives reset edges; sampled time can be quantized for integration.
    float raw_time = 0, sampled_time = 0, range_start = 0, duration = 0, alpha = 1;
    bool looping = false;
};

// One store per player/transaction candidate. Absent history differs from a reset
// live history. The immutable RuntimeData never owns mutable solver state.
class PhysicsStore {
    std::vector<std::optional<PhysicsState>> states_, transported_;
    std::optional<std::size_t> animation_;
    std::optional<float> raw_time_, sampled_time_;
public:
    explicit PhysicsStore(std::size_t constraint_count) : states_(constraint_count), transported_(constraint_count) {}
    [[nodiscard]] const std::optional<PhysicsState>& state(std::size_t constraint) const { return states_.at(constraint); }
    void commit(std::size_t constraint, const PhysicsState& state) { states_.at(constraint) = state; }
    bool reset(std::optional<std::size_t> constraint = {});
    [[nodiscard]] PhysicsStore reconcile(const RuntimeData& previous, const RuntimeData& next) const;
    [[nodiscard]] float advance(const animation::Pose& pose, const PhysicsClockSample& clock);
    void host_motion(const animation::Pose& pose, const Affine& previous, const Affine& next, PhysicsHostMotion mode, std::optional<std::size_t> constraint = {});
};
void solve_physics(Context& context, std::size_t constraint, PhysicsStore& store, const PhysicsStep& step, PhysicsBudget& budget);
// One declaration-order pass. The caller owns the transaction and one shared
// budget, including any baseline/replay evaluations in the same public operation.
void solve_constraints(Context& context, PhysicsStore& physics, const PhysicsStep& step, PhysicsBudget& budget, const animation::Sampling& sampling = {});
}
