#include "solvers.hpp"

namespace cane::constraints {
namespace {
using Properties = std::array<float, 6>;
float& component(BoneLocal& value, std::size_t property) {
    switch (property) { case 0: return value.rotation_degrees; case 1: return value.x; case 2: return value.y; case 3: return value.scale_x; case 4: return value.scale_y; default: return value.shear_y_degrees; }
}
float positive(float value) { const auto r = std::fmod(value, 360.0f); return r < 0 ? r + 360.0f : r; }
Properties source_values(const Properties& offsets, BoneLocal local, const Affine& world, bool local_source) {
    Properties source{};
    if (local_source) { for (std::size_t i = 0; i < source.size(); ++i) source[i] = component(local, i) + offsets[i]; return source; }
    const auto p = world.transform({offsets[1], offsets[2]}); const auto reflection = world.determinant() < 0 ? -1.0f : 1.0f;
    return {positive(x_angle(world) + offsets[0] * reflection), p.x, p.y, x_scale(world) + offsets[3], y_scale(world) + offsets[4], constraint_degrees(y_angle(world) - x_angle(world) - 90 + offsets[5])};
}
BoneLocal legacy_local(const detail::TransformDefinition& d, const Properties& offsets, BoneLocal current, BoneLocal target, const Properties& mix) {
    auto next = current;
    for (std::size_t i = 0; i < mix.size(); ++i) {
        const auto before = component(current, i), source = component(target, i), offset = offsets[i], amount = mix[i];
        if (amount == 0) continue;
        if (i == 3 || i == 4) component(next, i) = d.relative ? before * ((source - 1 + offset) * amount + 1) : before == 0 ? before : before + (source - before + offset) * amount;
        else if (i == 0 || i == 5) component(next, i) = constraint_degrees(before + (d.relative ? source + offset : constraint_degrees(source + offset - before)) * amount);
        else component(next, i) = before + (source + offset - (d.relative ? 0 : before)) * amount;
    }
    return next;
}
Affine shear_world(Affine current, float delta, float mix) {
    const auto radians = (y_angle(current) + constraint_degrees(delta) * mix) * degrees_to_radians;
    const auto length = y_scale(current);
    current.c = static_cast<float>(std::cos(static_cast<double>(radians))) * length;
    current.d = static_cast<float>(std::sin(static_cast<double>(radians))) * length; return current;
}
Affine legacy_world(const detail::TransformDefinition& d, const Properties& offsets, Affine current, const Affine& target, const Properties& mix) {
    const auto reflection = target.determinant() < 0 ? -1.0f : 1.0f;
    if (mix[0] != 0) current = rotate_axes(current, constraint_degrees(x_angle(target) - (d.relative ? 0 : x_angle(current)) + offsets[0] * reflection) * mix[0]);
    if (mix[1] != 0 || mix[2] != 0) {
        const auto point = target.transform({offsets[1], offsets[2]});
        if (mix[1] != 0) current.tx += (point.x - (d.relative ? 0 : current.tx)) * mix[1];
        if (mix[2] != 0) current.ty += (point.y - (d.relative ? 0 : current.ty)) * mix[2];
    }
    const auto sx = x_scale(current), sy = y_scale(current); float fx = 1, fy = 1;
    if (mix[3] != 0 && sx > matrix_epsilon) fx = d.relative ? (x_scale(target) - 1 + offsets[3]) * mix[3] + 1 : (sx + (x_scale(target) - sx + offsets[3]) * mix[3]) / sx;
    if (mix[4] != 0 && sy > matrix_epsilon) fy = d.relative ? (y_scale(target) - 1 + offsets[4]) * mix[4] + 1 : (sy + (y_scale(target) - sy + offsets[4]) * mix[4]) / sy;
    current.a *= fx; current.b *= fx; current.c *= fy; current.d *= fy;
    if (mix[5] != 0) current = shear_world(current, constraint_degrees(y_angle(target) - x_angle(target)) - (d.relative ? 90 : constraint_degrees(y_angle(current) - x_angle(current))) + offsets[5] * reflection, mix[5]);
    return current;
}
Affine mapped_world(Affine current, std::size_t property, float value, float amount, bool relative) {
    if (property == 0) return rotate_axes(current, constraint_degrees(relative ? value : value - x_angle(current)) * amount);
    if (property == 1) { current.tx += (relative ? value : value - current.tx) * amount; return current; }
    if (property == 2) { current.ty += (relative ? value : value - current.ty) * amount; return current; }
    if (property == 3 || property == 4) {
        const auto length = property == 3 ? x_scale(current) : y_scale(current); if (length <= matrix_epsilon) return current;
        const auto factor = relative ? 1 + (value - 1) * amount : 1 + (value - length) * amount / length;
        if (property == 3) { current.a *= factor; current.b *= factor; } else { current.c *= factor; current.d *= factor; }
        return current;
    }
    return shear_world(current, relative ? value : value + 90 - constraint_degrees(y_angle(current) - x_angle(current)), amount);
}
void project(const detail::TransformDefinition& d, const Properties& offsets, const Properties& source, const BoneLocal& target_local, const Affine& target_world,
             const Properties& mixes, bool local_target, BoneLocal& local, Affine& world) {
    if (!d.mapping) {
        if (local_target) local = legacy_local(d, offsets, local, target_local, mixes); else world = legacy_world(d, offsets, world, target_world, mixes);
        return;
    }
    for (const auto& from : d.mapping->properties) {
        const auto s = source[static_cast<std::size_t>(from.property)] - from.offset;
        for (const auto& to : from.targets) {
            const auto property = static_cast<std::size_t>(to.property); const auto amount = mixes[property]; if (amount == 0) continue;
            auto value = to.offset + s * to.scale;
            if (d.mapping->clamp) value = std::clamp(value, std::min(to.offset, to.max), std::max(to.offset, to.max));
            if (local_target) {
                auto& current = component(local, property);
                if (property == 3 || property == 4) { if (d.relative) current *= 1 + (value - 1) * amount; else if (current != 0) current += (value - current) * amount; }
                else current += (d.relative ? value : value - current) * amount;
            } else world = mapped_world(world, property, value, amount, d.relative);
        }
    }
}
void maximum(std::optional<float>& output, float value) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "apply", "Transform diagnostic is non-finite.", "constraints");
    output = output ? std::max(*output, value) : value;
}
}
void solve_transform(Context& context, std::size_t index) {
    auto& pose = context.pose; pose.diagnostics.at(index) = std::monostate{};
    const auto& d = std::get<detail::TransformDefinition>(pose.model().constraints.at(index).definition);
    if (!pose.active_constraints[index] || !pose.active_bones[d.target]) return;
    Properties mixes{}, full{}; bool active = false;
    for (std::size_t i = 0; i < mixes.size(); ++i) {
        mixes[i] = pose.constraints[index].scalars[static_cast<std::size_t>(animation::ConstraintProperty::mix_rotate) + i];
        full[i] = mixes[i] == 0 ? 0.0f : 1.0f; active = active || mixes[i] != 0;
    }
    if (!active) return;
    const auto world = pose.world[d.target]; const auto local = pose.locals[d.target];
    const auto source = d.mapping ? source_values(pose.constraints[index].transform_offsets, local, world, d.mapping->local_source) : Properties{};
    const bool local_target = d.mapping ? d.mapping->local_target : d.local;
    TransformDiagnostic diagnostic; diagnostic.mixes = mixes;
    for (const auto bone : d.bones) {
        if (bone == d.target) continue;
        auto next_local = pose.locals[bone], ideal_local = next_local; auto next_world = pose.world[bone], ideal_world = next_world;
        project(d, pose.constraints[index].transform_offsets, source, local, world, mixes, local_target, next_local, next_world);
        project(d, pose.constraints[index].transform_offsets, source, local, world, full, local_target, ideal_local, ideal_world);
        if (local_target) { ideal_world = context.compose(bone, ideal_local); context.write_local(bone, next_local); }
        else context.write_world(bone, next_world);
        const auto& actual = pose.world[bone]; ++diagnostic.driven;
        if (mixes[1] != 0 || mixes[2] != 0) maximum(diagnostic.translation_residual, cane::hypot(mixes[1] == 0 ? 0 : actual.tx - ideal_world.tx, mixes[2] == 0 ? 0 : actual.ty - ideal_world.ty));
        if (mixes[0] != 0) maximum(diagnostic.rotation_residual, std::abs(constraint_degrees(x_angle(actual) - x_angle(ideal_world))));
        if (mixes[3] != 0 || mixes[4] != 0) maximum(diagnostic.scale_residual, std::max(mixes[3] == 0 ? 0 : std::abs(x_scale(actual) - x_scale(ideal_world)), mixes[4] == 0 ? 0 : std::abs(y_scale(actual) - y_scale(ideal_world))));
        if (mixes[5] != 0) maximum(diagnostic.shear_residual, std::abs(constraint_degrees(world_shear_y(actual) - world_shear_y(ideal_world))));
    }
    pose.diagnostics[index] = diagnostic;
}
std::optional<std::array<float, 6>> matched_transform_offsets(const Context& context, std::size_t index, ErrorCode* failure_code) {
    if (failure_code) *failure_code = ErrorCode::invalid_state;
    const auto& pose = context.pose; const auto& d = std::get<detail::TransformDefinition>(pose.model().constraints.at(index).definition);
    bool local_source = d.local, local_target = d.local;
    if (d.mapping) {
        const auto& mapping = *d.mapping; if (mapping.clamp || mapping.properties.size() != 6) return {};
        std::array<bool, 6> seen{};
        for (const auto& source : mapping.properties) {
            const auto p = static_cast<std::size_t>(source.property);
            if (seen[p] || source.offset != 0 || source.targets.size() != 1) return {};
            const auto& target = source.targets[0]; if (target.property != source.property || target.offset != 0 || target.scale != 1) return {};
            seen[p] = true;
        }
        local_source = mapping.local_source; local_target = mapping.local_target;
    }
    const auto values = [&](std::size_t bone, bool local) -> Properties {
        if (local) { auto p = pose.locals[bone]; return {p.rotation_degrees, p.x, p.y, p.scale_x, p.scale_y, p.shear_y_degrees}; }
        const auto& world = pose.world[bone]; return {positive(x_angle(world)), world.tx, world.ty, x_scale(world), y_scale(world), world_shear_y(world)};
    };
    const auto desired = d.relative ? Properties{0, 0, 0, 1, 1, 0} : values(d.bones.front(), local_target);
    const auto source = values(d.target, local_source); Properties offsets{};
    offsets[0] = constraint_degrees(desired[0] - source[0]);
    if (local_source) { offsets[1] = desired[1] - source[1]; offsets[2] = desired[2] - source[2]; }
    else {
        const auto& world = pose.world[d.target]; const auto inverse = world.inverse(matrix_epsilon); if (!inverse) return {};
        const auto position = inverse->transform({desired[1], desired[2]}); offsets[1] = position.x; offsets[2] = position.y;
        if (world.determinant() < 0) offsets[0] = -offsets[0];
    }
    offsets[3] = desired[3] - source[3]; offsets[4] = desired[4] - source[4]; offsets[5] = constraint_degrees(desired[5] - source[5]);
    for (const auto value : offsets) if (!std::isfinite(value)) { if (failure_code) *failure_code = ErrorCode::non_finite; return {}; }
    return offsets;
}
}
