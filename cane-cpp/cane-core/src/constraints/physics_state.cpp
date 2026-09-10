#include "physics.hpp"
#include "runtime_data_internal.hpp"

namespace cane::constraints {
bool PhysicsEnvironment::finite() const noexcept { return std::isfinite(wind_x) && std::isfinite(wind_y) && std::isfinite(gravity_x) && std::isfinite(gravity_y); }
bool PhysicsState::finite() const noexcept {
    for (const auto value : {ux, uy, cx, cy, tip_x, tip_y, x_offset, y_offset, x_lag, y_lag, x_velocity, y_velocity,
                            rotate_offset, rotate_lag, rotate_velocity, scale_offset, scale_lag, scale_velocity, remaining}) if (!std::isfinite(value)) return false;
    return true;
}
void PhysicsBudget::consume() {
    if (remaining_ == 0) throw Error(ErrorCode::resource_limit, "apply", "Physics fixed-step budget is exhausted.");
    --remaining_;
}
bool PhysicsStore::reset(std::optional<std::size_t> constraint) {
    if (constraint) { auto& value = states_.at(*constraint); const auto had = value.has_value(); if (had) value = PhysicsState{}; return had; }
    bool had = false; for (auto& value : states_) { had = had || value.has_value(); value.reset(); }
    animation_.reset(); raw_time_.reset(); sampled_time_.reset(); return had;
}
PhysicsStore PhysicsStore::reconcile(const RuntimeData& previous, const RuntimeData& effective) const {
    const auto& old = detail::RuntimeDataAccess::get(previous); const auto& next = detail::RuntimeDataAccess::get(effective);
    PhysicsStore result(next.model.constraints.size());
    if (animation_) {
        const auto at = next.index.catalogs[10].find(old.clips.at(*animation_).id);
        if (at == next.index.catalogs[10].end()) return result;
        result.animation_ = at->second;
    }
    result.raw_time_ = raw_time_; result.sampled_time_ = sampled_time_;
    for (std::size_t i = 0; i < old.model.constraints.size(); ++i) {
        const auto& before = old.model.constraints[i];
        if (before.kind != animation::ConstraintKind::physics) continue;
        const auto at = next.index.catalogs[7].find(old.catalogs[7][i].id);
        if (at == next.index.catalogs[7].end()) continue;
        const auto& after = next.model.constraints[at->second];
        if (after.kind != animation::ConstraintKind::physics) continue;
        const auto old_bone = std::get<detail::PhysicsDefinition>(before.definition).bone;
        const auto new_bone = std::get<detail::PhysicsDefinition>(after.definition).bone;
        if (old.bones[old_bone].id == next.bones[new_bone].id) result.states_[at->second] = states_[i];
    }
    return result;
}
float PhysicsStore::advance(const animation::Pose& pose, const PhysicsClockSample& clock) {
    for (const auto value : {clock.raw_time, clock.sampled_time, clock.range_start, clock.duration, clock.alpha})
        if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "apply", "Physics clock sample must be finite.");
    const auto& clips = detail::RuntimeDataAccess::get(pose.data()).clips;
    if (clock.animation && *clock.animation >= clips.size()) throw Error(ErrorCode::invalid_argument, "apply", "Physics primary animation is outside its catalog.");
    const auto changed = animation_ != clock.animation || (raw_time_ && clock.raw_time < *raw_time_);
    const auto previous_raw = changed ? std::optional<float>{} : raw_time_;
    const auto previous_sampled = changed ? std::optional<float>{} : sampled_time_;
    const auto delta = std::max(previous_sampled ? clock.sampled_time - *previous_sampled : clock.sampled_time, 0.0f);
    if (!std::isfinite(delta)) throw Error(ErrorCode::non_finite, "apply", "Physics elapsed time overflowed.");
    if (changed) (void)reset();
    animation_ = clock.animation; raw_time_ = clock.raw_time; sampled_time_ = clock.sampled_time;
    if (!clock.animation || !previous_raw || clock.raw_time <= *previous_raw || clock.alpha < .5f) return delta;
    const auto& model = pose.model();
    for (const auto& timeline : clips[*clock.animation].constraints) {
        if (timeline.kind != animation::ConstraintKind::physics) continue;
        bool crossed = false;
        for (const auto& trigger : timeline.reset_triggers) {
            const auto key = trigger.time - clock.range_start;
            if (clock.looping && clock.duration > 0) {
                // A bounded quotient comparison tests any number of crossings;
                // no loop-count iteration or integer conversion is necessary.
                const auto from_cycle = std::floor((static_cast<double>(*previous_raw) - key) / clock.duration);
                const auto to_cycle = std::floor((static_cast<double>(clock.raw_time) - key) / clock.duration);
                crossed = from_cycle < to_cycle;
            } else crossed = key > *previous_raw && key <= clock.raw_time;
            if (crossed) break;
        }
        if (!crossed) continue;
        if (timeline.index) (void)reset(*timeline.index);
        else for (std::size_t i = 0; i < model.constraints.size(); ++i) {
            if (model.constraints[i].kind != animation::ConstraintKind::physics || !pose.active_constraints[i]) continue;
            const auto bone = std::get<detail::PhysicsDefinition>(model.constraints[i].definition).bone;
            if (pose.active_bones[bone]) (void)reset(i);
        }
    }
    return delta;
}
void PhysicsStore::host_motion(const animation::Pose& pose, const Affine& previous, const Affine& next, PhysicsHostMotion mode, std::optional<std::size_t> constraint) {
    if (constraint && (*constraint >= pose.model().constraints.size() || pose.model().constraints[*constraint].kind != animation::ConstraintKind::physics))
        throw Error(ErrorCode::invalid_argument, "setRootTransform", "Host motion target must be a Physics constraint.", "constraintId");
    if (mode == PhysicsHostMotion::move) return;
    if (mode == PhysicsHostMotion::teleport) {
        for (std::size_t i = 0; i < states_.size(); ++i) if ((!constraint || i == *constraint) && states_[i]) states_[i] = PhysicsState{};
        return;
    }
    if (mode != PhysicsHostMotion::preserve_inertia && mode != PhysicsHostMotion::clear_inertia)
        throw Error(ErrorCode::invalid_argument, "setRootTransform", "Unknown Physics host motion mode.", "physicsMode");
    const auto determinant = previous.determinant();
    if (determinant == 0 || !std::isfinite(determinant)) throw Error(ErrorCode::invalid_state, "setRootTransform", "Physics history transport requires an invertible previous root.", "rootTransform");
    const auto inverse = previous.inverse();
    if (!inverse) throw Error(ErrorCode::non_finite, "setRootTransform", "Previous root inverse is non-finite.", "rootTransform");
    const auto delta = next * *inverse;
    if (!delta.finite()) throw Error(ErrorCode::non_finite, "setRootTransform", "Physics root transport is non-finite.", "rootTransform");
    transported_ = states_;
    for (std::size_t i = 0; i < transported_.size(); ++i) {
        if ((constraint && i != *constraint) || !transported_[i]) continue;
        auto& s = *transported_[i];
        auto point = delta.transform({s.ux, s.uy}); s.ux = point.x; s.uy = point.y;
        point = delta.transform({s.cx, s.cy}); s.cx = point.x; s.cy = point.y;
        point = delta.transform_direction({s.tip_x, s.tip_y}); s.tip_x = point.x; s.tip_y = point.y;
        point = delta.transform_direction({s.x_offset, s.y_offset}); s.x_offset = point.x; s.y_offset = point.y;
        point = delta.transform_direction({s.x_lag, s.y_lag}); s.x_lag = point.x; s.y_lag = point.y;
        point = delta.transform_direction({s.x_velocity, s.y_velocity}); s.x_velocity = point.x; s.y_velocity = point.y;
        if (!s.finite()) throw Error(ErrorCode::non_finite, "setRootTransform", "Physics history transport overflowed.", "rootTransform", pose.data().catalog(RuntimeCatalogKind::constraint)[i].id);
        if (mode == PhysicsHostMotion::clear_inertia) { s.x_lag = s.y_lag = s.x_velocity = s.y_velocity = s.rotate_lag = s.rotate_velocity = s.scale_lag = s.scale_velocity = 0; }
    }
    states_.swap(transported_);
}
}
