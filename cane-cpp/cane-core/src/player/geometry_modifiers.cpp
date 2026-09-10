#include "state.hpp"
#include "geometry/modifiers.hpp"

namespace cane {
void RuntimePlayer::set_geometry_modifiers(const GeometryModifiers& modifiers) {
    constexpr auto op = "setGeometryModifiers";
    detail::operation(op, [&] {
        auto& p = impl(); p.require_idle(op); GeometryModifiers copy = modifiers;
        geometry::validate_modifiers(p.data(), copy, op);
        p.configure(op, [&](auto& state, auto&, auto&) { state.host.geometry = copy; });
    });
}
void RuntimePlayer::clear_geometry_modifiers() {
    impl().configure("clearGeometryModifiers", [](auto& state, auto&, auto&) { state.host.geometry.operations.clear(); });
}
GeometryModifiers RuntimePlayer::query_geometry_modifiers() const {
    return detail::operation("queryGeometryModifiers", [&] { return impl().state->host.geometry; });
}
GeometryModifierStats RuntimePlayer::last_geometry_modifier_stats() const { return frame().geometry_modifier_stats(); }
RuntimeFrame RuntimePlayer::apply_frame_modifiers(const PoseModifiers* pose_modifiers, const GeometryModifiers* geometry_modifiers,
    const SamplingOptions& options, const char* op) {
    return detail::operation(op, [&] {
        auto& p = impl(); p.require_idle(op); const auto sampling = detail::checked_sampling(options, op);
        std::optional<GeometryModifiers> geometry; if (geometry_modifiers) geometry = *geometry_modifiers;
        std::optional<PoseModifiers> pose; if (pose_modifiers) pose = *pose_modifiers;
        if (geometry) geometry::validate_modifiers(p.data(), *geometry, op);
        const auto sequence = p.next_sequence(op);
        auto candidate = std::make_unique<detail::PlayerState>(*p.state); constraints::PhysicsBudget budget;
        p.publish(*candidate, p.evaluate(*candidate, budget, sampling, pose ? &*pose : nullptr, op, geometry ? &*geometry : nullptr, sequence), sequence);
        p.state.swap(candidate); return p.frame();
    });
}
RuntimeStep RuntimePlayer::advance_frame_modifiers(float delta, const PoseModifiers* pose_modifiers, const GeometryModifiers* geometry_modifiers,
    const SamplingOptions& options, const char* op) {
    return detail::operation(op, [&] {
        auto& p = impl(); p.require_idle(op);
        std::optional<GeometryModifiers> geometry; if (geometry_modifiers) geometry = *geometry_modifiers;
        std::optional<PoseModifiers> pose; if (pose_modifiers) pose = *pose_modifiers;
        if (geometry) geometry::validate_modifiers(p.data(), *geometry, op);
        return p.step(delta, true, options, op, pose ? &*pose : nullptr, geometry ? &*geometry : nullptr);
    });
}
RuntimeFrame RuntimePlayer::apply_with_geometry_modifiers(const GeometryModifiers& modifiers, const SamplingOptions& options) {
    return apply_frame_modifiers(nullptr, &modifiers, options, "applyWithGeometryModifiers");
}
RuntimeStep RuntimePlayer::advance_with_geometry_modifiers(float delta, const GeometryModifiers& modifiers, const SamplingOptions& options) {
    return advance_frame_modifiers(delta, nullptr, &modifiers, options, "advanceWithGeometryModifiers");
}
RuntimeFrame RuntimePlayer::apply_with_frame_modifiers(const PoseModifiers& pose, const GeometryModifiers& geometry, const SamplingOptions& options) {
    return apply_frame_modifiers(&pose, &geometry, options, "applyWithFrameModifiers");
}
RuntimeStep RuntimePlayer::advance_with_frame_modifiers(float delta, const PoseModifiers& pose, const GeometryModifiers& geometry, const SamplingOptions& options) {
    return advance_frame_modifiers(delta, &pose, &geometry, options, "advanceWithFrameModifiers");
}
}
