#include "physics.hpp"
#include "solvers.hpp"
#include <limits>

namespace cane::constraints {
namespace {
float sine(float angle) { return static_cast<float>(std::sin(static_cast<double>(angle))); }
float cosine(float angle) { return static_cast<float>(std::cos(static_cast<double>(angle))); }
float atan2(float y, float x) { return static_cast<float>(std::atan2(static_cast<double>(y), x)); }
float wrap_radians(float angle) {
    auto value = std::fmod(angle + pi, pi * 2); if (value < 0) value += pi * 2; return value - pi;
}
Affine rotate_radians(const Affine& m, float angle, bool first_only) {
    const auto co = cosine(angle), si = sine(angle);
    return {co * m.a - si * m.b, si * m.a + co * m.b, first_only ? m.c : co * m.c - si * m.d,
        first_only ? m.d : si * m.c + co * m.d, m.tx, m.ty};
}
void observe_limit(float movement, float limit, float denominator, PhysicsDiagnostic& diagnostic) {
    const auto magnitude = std::abs(movement);
    diagnostic.limit_saturated = diagnostic.limit_saturated || magnitude > limit;
    if (magnitude != 0 && diagnostic.required_limit) {
        const auto candidate = magnitude / denominator;
        if (denominator == 0 || !std::isfinite(candidate)) diagnostic.required_limit.reset();
        else diagnostic.required_limit = std::max(*diagnostic.required_limit, candidate);
    }
}
}
void solve_physics(Context& context, std::size_t index, PhysicsStore& store, const PhysicsStep& input, PhysicsBudget& budget) {
    using P = animation::ConstraintProperty;
    auto& pose = context.pose; pose.diagnostics.at(index) = std::monostate{};
    const auto& d = std::get<detail::PhysicsDefinition>(pose.model().constraints.at(index).definition);
    const auto p = pose.constraints[index]; const auto mix = p[P::mix], reference = pose.data().skeleton().reference_scale;
    if (!pose.active_constraints[index] || !pose.active_bones[d.bone] || mix == 0 || p.physics.fps == 0 || !std::isfinite(reference) || reference <= 0 || !input.environment.finite()) return;
    const auto& id = pose.data().catalog(RuntimeCatalogKind::constraint)[index].id;
    const auto failure = [&] { return Error(ErrorCode::non_finite, "apply", "Physics state or geometry became non-finite.", {}, id); };
    auto state = store.state(index).value_or(PhysicsState{}); auto available_budget = budget;
    const auto delta = std::isfinite(input.delta_seconds) ? std::max(input.delta_seconds, 0.0f) : 0;
    const auto length = std::max(pose.data().bones()[d.bone].length, 0.0f), step = 1 / static_cast<float>(p.physics.fps);
    auto matrix = pose.world[d.bone]; const auto origin_x = matrix.tx, origin_y = matrix.ty, previous_remaining = state.remaining;
    auto remaining = state.remaining + delta, planned_remaining = remaining;
    const auto xe = p.physics.x > 0, ye = p.physics.y > 0, re = p.physics.rotate > 0 || p.physics.shear_x > 0, se = p.physics.scale_x > 0;
    PhysicsDiagnostic diagnostic; diagnostic.configured_limit = p.physics.limit; diagnostic.required_limit = 0.0f;
    if (!state.reset && (xe || ye || re || se)) {
        if (!std::isfinite(step) || step <= 0 || !std::isfinite(remaining)) throw Error(ErrorCode::resource_limit, "apply", "Physics step or remaining time cannot be integrated.");
        while (planned_remaining >= step) {
            available_budget.consume(); const auto next = planned_remaining - step;
            if (next == planned_remaining) throw Error(ErrorCode::resource_limit, "apply", "Physics fixed-step subtraction cannot make progress.");
            planned_remaining = next; ++diagnostic.fixed_steps;
        }
    }
    float interpolation = 0; state.remaining = remaining;
    if (state.reset) { state.reset = false; state.ux = origin_x; state.uy = origin_y; }
    else {
        const auto inertia = std::clamp(p[P::inertia], 0.0f, 1.0f), limit = std::max(p.physics.limit, 0.0f);
        const auto root_x = input.root_scale_x, root_y = input.root_scale_y;
        const auto x_limit = limit * delta * std::abs(root_x), y_limit = limit * delta * std::abs(root_y);
        const auto damping = static_cast<float>(std::pow(static_cast<double>(std::clamp(p[P::damping], 0.0f, 1.0f)), 60 * step));
        const auto acceleration = step / std::max(p[P::mass], std::numeric_limits<float>::denorm_min()), strength = std::max(p[P::strength], 0.0f);
        if (xe || ye) {
            if (xe) {
                const auto movement = (state.ux - origin_x) * inertia;
                observe_limit(movement, x_limit, delta * std::abs(root_x), diagnostic);
                state.x_offset += std::clamp(movement, -x_limit, x_limit); state.ux = origin_x;
            }
            if (ye) {
                const auto movement = (state.uy - origin_y) * inertia;
                observe_limit(movement, y_limit, delta * std::abs(root_y), diagnostic);
                state.y_offset += std::clamp(movement, -y_limit, y_limit); state.uy = origin_y;
            }
            if (diagnostic.fixed_steps != 0) {
                const auto wind = reference * p[P::wind], gravity = reference * p[P::gravity]; const auto& env = input.environment;
                const auto force_x = (wind * env.wind_x + gravity * env.gravity_x) * root_x;
                const auto force_y = (wind * env.wind_y + gravity * env.gravity_y) * root_y;
                const auto previous_x = state.x_offset, previous_y = state.y_offset;
                for (std::uint32_t i = 0; i < diagnostic.fixed_steps; ++i) {
                    if (xe) { state.x_velocity += (force_x - state.x_offset * strength) * acceleration; state.x_offset += state.x_velocity * step; state.x_velocity *= damping; }
                    if (ye) { state.y_velocity -= (force_y + state.y_offset * strength) * acceleration; state.y_offset += state.y_velocity * step; state.y_velocity *= damping; }
                }
                state.x_lag = state.x_offset - previous_x; state.y_lag = state.y_offset - previous_y; remaining = planned_remaining;
            }
            interpolation = std::max(1 - remaining / step, 0.0f);
            if (xe) matrix.tx += (state.x_offset - state.x_lag * interpolation) * mix * p.physics.x;
            if (ye) matrix.ty += (state.y_offset - state.y_lag * interpolation) * mix * p.physics.y;
        }
        if (re || se) {
            const auto raw_x = state.cx - matrix.tx, raw_y = state.cy - matrix.ty;
            observe_limit(raw_x, x_limit, delta * std::abs(root_x), diagnostic); observe_limit(raw_y, y_limit, delta * std::abs(root_y), diagnostic);
            const auto axis_angle = atan2(matrix.b, matrix.a), tip_x = std::clamp(raw_x, -x_limit, x_limit), tip_y = std::clamp(raw_y, -y_limit, y_limit);
            const auto rotate_mix = (p.physics.rotate + p.physics.shear_x) * mix; float co, si;
            if (re) {
                const auto lag = state.rotate_lag * std::max(1 - previous_remaining / step, 0.0f);
                const auto incoming = atan2(tip_y + state.tip_y, tip_x + state.tip_x) - axis_angle - (state.rotate_offset - lag) * rotate_mix;
                state.rotate_offset += wrap_radians(incoming) * inertia;
                const auto force_angle = (state.rotate_offset - lag) * rotate_mix + axis_angle; co = cosine(force_angle); si = sine(force_angle);
                if (se) {
                    const auto world_length = length * x_scale(matrix);
                    if (world_length > 0) state.scale_offset += (tip_x * co + tip_y * si) * inertia / world_length;
                }
            } else {
                co = cosine(axis_angle); si = sine(axis_angle);
                const auto world_length = length * x_scale(matrix) - state.scale_lag * std::max(1 - previous_remaining / step, 0.0f);
                if (world_length > 0) state.scale_offset += (tip_x * co + tip_y * si) * inertia / world_length;
            }
            if (diagnostic.fixed_steps != 0) {
                const auto& env = input.environment;
                const auto force_x = p[P::wind] * env.wind_x + p[P::gravity] * env.gravity_x;
                const auto force_y = p[P::wind] * env.wind_y + p[P::gravity] * env.gravity_y;
                const auto length_scale = length / reference, previous_rotate = state.rotate_offset, previous_scale = state.scale_offset;
                for (std::uint32_t i = 0; i < diagnostic.fixed_steps; ++i) {
                    if (se) { state.scale_velocity += (force_x * co - force_y * si - state.scale_offset * strength) * acceleration; state.scale_offset += state.scale_velocity * step; state.scale_velocity *= damping; }
                    if (re) { state.rotate_velocity -= ((force_x * si + force_y * co) * length_scale + state.rotate_offset * strength) * acceleration; state.rotate_offset += state.rotate_velocity * step; state.rotate_velocity *= damping; }
                    if (re && i + 1 < diagnostic.fixed_steps) { const auto angle = state.rotate_offset * rotate_mix + axis_angle; co = cosine(angle); si = sine(angle); }
                }
                state.rotate_lag = state.rotate_offset - previous_rotate; state.scale_lag = state.scale_offset - previous_scale; remaining = planned_remaining;
            }
            interpolation = std::max(1 - remaining / step, 0.0f);
        }
        state.remaining = remaining;
    }
    const auto rotation_offset = (state.rotate_offset - state.rotate_lag * interpolation) * mix;
    if (p.physics.rotate > 0) matrix = rotate_radians(matrix, rotation_offset * p.physics.rotate, false);
    if (p.physics.shear_x > 0) matrix = rotate_radians(matrix, rotation_offset * p.physics.shear_x, true);
    if (p.physics.scale_x > 0) {
        const auto scale = 1 + (state.scale_offset - state.scale_lag * interpolation) * mix * p.physics.scale_x; float y_scale = 1;
        if (d.scale_y == detail::ScaleYMode::uniform) y_scale = scale;
        else if (d.scale_y == detail::ScaleYMode::volume) { const auto magnitude = std::abs(scale); y_scale = magnitude >= .7f ? 1 / magnitude : 4 - 3.67347f * magnitude; }
        matrix.a *= scale; matrix.b *= scale; matrix.c *= y_scale; matrix.d *= y_scale;
    }
    state.cx = origin_x; state.cy = origin_y; state.tip_x = length * matrix.a; state.tip_y = length * matrix.b;
    if (!state.finite() || !matrix.finite()) throw failure();
    diagnostic.translation_offset = cane::hypot(state.x_offset, state.y_offset); diagnostic.translation_speed = cane::hypot(state.x_velocity, state.y_velocity);
    diagnostic.rotation_offset_degrees = state.rotate_offset * radians_to_degrees; diagnostic.angular_speed_degrees = state.rotate_velocity * radians_to_degrees;
    diagnostic.scale_offset = state.scale_offset; diagnostic.scale_speed = state.scale_velocity;
    for (const auto value : {diagnostic.translation_offset, diagnostic.translation_speed, diagnostic.rotation_offset_degrees, diagnostic.angular_speed_degrees}) if (!std::isfinite(value)) throw failure();
    try { context.write_world(d.bone, matrix); } catch (const Error& error) { if (error.code == ErrorCode::non_finite) throw failure(); throw; }
    store.commit(index, state); budget = available_budget; pose.diagnostics[index] = diagnostic;
}
}
