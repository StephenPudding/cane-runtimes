#include "state.hpp"
#include "constraint_parameters.hpp"
#include "runtime_data_internal.hpp"
#include "geometry/modifiers.hpp"
#include <limits>

namespace cane::detail {
HostState::HostState(const RuntimeData& data) {
    if (const auto skin = RuntimeDataAccess::get(data).model.default_skin) skins.push_back(*skin);
}
PlayerState::PlayerState(const RuntimeData& data)
    : live(data), baseline(data), physics(data.catalog(RuntimeCatalogKind::constraint).size()), host(data) {}
RuntimePlayerImpl::RuntimePlayerImpl(RuntimeData data, std::optional<HostState> host, std::optional<animation::Playback> configuration)
    : data_(std::move(data)), source_data_(data_), constraints_(data_.bones().size()), state(std::make_unique<PlayerState>(data_)) {
    if (host) state->host = std::move(*host);
    if (configuration) { state->live = std::move(*configuration); state->baseline = state->live; }
    constraints::PhysicsBudget budget;
    publish(*state, evaluate(*state, budget, {}), 1);
}
RuntimePlayerImpl::RuntimePlayerImpl(RuntimeData effective, RuntimeData source, std::unique_ptr<PlayerState> candidate)
    : data_(std::move(effective)), source_data_(std::move(source)), constraints_(data_.bones().size()), state(std::move(candidate)) {}
void require_finite(float value, const char* op, const char* field) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, op, "Runtime scalar must be finite.", field);
}
void require_nonnegative(float value, const char* op, const char* field) {
    require_finite(value, op, field);
    if (value < 0) throw Error(ErrorCode::invalid_argument, op, "Runtime scalar must be non-negative.", field);
}
BoneLocal bone_local(const RegionLocal& value) noexcept { return {value.x, value.y, value.rotation_degrees, value.scale_x, value.scale_y, 0, 0}; }
void validate_local(const BoneLocal& value, const char* op, const char* field) {
    for (const float v : {value.x, value.y, value.rotation_degrees, value.scale_x, value.scale_y, value.shear_x_degrees, value.shear_y_degrees}) require_finite(v, op, field);
}
animation::Sampling checked_sampling(const SamplingOptions& value, const char* op) {
    if (value.frame_step_seconds) {
        require_finite(*value.frame_step_seconds, op, "frameStepSeconds");
        if (*value.frame_step_seconds <= 0) throw Error(ErrorCode::invalid_argument, op, "Frame step must be positive.", "frameStepSeconds");
    }
    return {value.frame_step_seconds, value.stepped};
}
std::uint64_t RuntimePlayerImpl::next_sequence(const char* op) const {
    require_idle(op);
    const auto previous = frame().sequence();
    if (previous == std::numeric_limits<std::uint64_t>::max()) throw Error(ErrorCode::resource_limit, op, "Frame sequence is exhausted.", "frameSequence");
    return previous + 1;
}
std::size_t RuntimePlayerImpl::index(RuntimeCatalogKind kind, std::string_view id, const char* op, const char* field) const {
    const auto& catalog = RuntimeDataAccess::get(data()).index.catalogs[static_cast<std::size_t>(kind)];
    const auto found = catalog.find(std::string(id));
    if (found == catalog.end()) throw Error(ErrorCode::not_found, op, "Runtime catalog entry does not exist.", field ? std::optional<std::string>(field) : std::nullopt, std::string(id));
    return found->second;
}
void RuntimePlayerImpl::require_idle(const char* op) const {
    if (callback_active) throw Error(ErrorCode::invalid_state, op, "A geometry callback cannot mutate, move or clone the player being evaluated.");
}
Evaluation RuntimePlayerImpl::evaluate(PlayerState& candidate, constraints::PhysicsBudget& budget, const animation::Sampling& sampling,
    const PoseModifiers* modifiers, const char* op, const GeometryModifiers* geometry, std::optional<std::uint64_t> sequence, std::optional<float> physics_delta) {
    require_idle(op);
    if (!sequence) sequence = candidate.frame ? next_sequence(op) : 1;
    animation::Pose pose(candidate.live.data()); const auto& host = candidate.host;
    EvaluationStats stats;
    pose.reset(host.skins); ++stats.animation_samples; candidate.live.apply(pose, mixer_, sampling); pose.resolve_attachments();
    for (const auto& item : host.bones) {
        pose.locals[item.first] = item.second.local;
        if (item.second.transform_mode) pose.modes[item.first] = *item.second.transform_mode;
    }
    for (const auto& item : host.regions) pose.regions[item.first] = bone_local(item.second);
    if (host.order) { pose.order = *host.order; pose.order_sampled = true; }
    for (const auto& item : host.attachments) pose.slots[item.first].key = item.second;
    for (const auto& item : host.tints) {
        auto& slot = pose.slots[item.first]; slot.color = item.second.light; slot.dark = item.second.dark; slot.alpha = item.second.alpha;
    }
    pose.resolve_attachments();
    for (const auto& item : host.deforms) { auto& deform = pose.deforms.at(item.first); deform.values = item.second; deform.enabled = true; }
    for (const auto& item : host.constraints) apply_constraint_override(pose.constraints.at(item.first), item.second, "apply");
    if (modifiers) apply_pose_modifiers(pose, *modifiers, op);
    pose.update_world(host.root);
    constraints::PhysicsClockSample clock;
    const auto primary = candidate.live.tracks().find(0);
    if (primary == candidate.live.tracks().end()) clock.raw_time = candidate.live.time();
    else {
        const auto& track = primary->second; const auto& entry = track.chain.back();
        clock.raw_time = entry.time; clock.range_start = entry.start; clock.duration = entry.duration(); clock.looping = entry.looping;
        const float progress = track.chain.size() == 1 || entry.mix_duration == 0 ? 1 : std::clamp(entry.mix_time / entry.mix_duration, 0.0f, 1.0f);
        clock.alpha = entry.alpha * progress;
        if (entry.clip) clock.animation = static_cast<std::size_t>(entry.clip - RuntimeDataAccess::get(pose.data()).clips.data());
    }
    clock.sampled_time = sampling.time(clock.raw_time);
    constraints::PhysicsStep step; step.delta_seconds = candidate.physics.advance(pose, clock);
    if (physics_delta) step.delta_seconds = *physics_delta;
    step.root_scale_x = host.root_local.scale_x; step.root_scale_y = host.root_local.scale_y;
    step.environment = {host.environment.wind_x, host.environment.wind_y, host.environment.gravity_x, host.environment.gravity_y};
    constraints::Context context{pose, host.root, constraints_};
    ++stats.constraint_geometry_solves;
    constraints::solve_constraints(context, candidate.physics, step, budget, sampling);
    const float time = candidate.live.time();
    GeometryModifierStats geometry_stats;
    auto packet = geometry::ModifierStage::apply(packets_.prepare_geometry(pose), host.geometry, geometry, *sequence, time, callback_active, geometry_stats);
    return {std::move(pose), std::move(packet), time, stats, geometry_stats};
}
void RuntimePlayerImpl::publish(PlayerState& candidate, Evaluation result, std::uint64_t sequence) {
    ++result.stats.frames_published;
    candidate.frame = RuntimeFrameAccess::own(std::move(result), sequence, candidate.host.skins);
}
}
