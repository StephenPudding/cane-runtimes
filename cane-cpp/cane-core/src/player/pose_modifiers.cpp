#include "state.hpp"
#include "constraint_parameters.hpp"
#include "runtime_data_internal.hpp"

namespace cane::detail {
namespace {
const char* const fields[]{"x", "y", "rotationDegrees", "scaleX", "scaleY", "shearXDegrees", "shearYDegrees"};
using Channels = std::array<std::optional<float>, 7>;
Channels channels(const BoneLocal& v) { return {v.x, v.y, v.rotation_degrees, v.scale_x, v.scale_y, v.shear_x_degrees, v.shear_y_degrees}; }
Channels channels(const BoneLocalPatch& v) { return {v.x, v.y, v.rotation_degrees, v.scale_x, v.scale_y, v.shear_x_degrees, v.shear_y_degrees}; }
Channels channels(const BoneLocalAdditive& v) { return {v.x_delta, v.y_delta, v.rotation_degrees_delta, v.scale_x_delta, v.scale_y_delta, v.shear_x_degrees_delta, v.shear_y_degrees_delta}; }
std::size_t target(const animation::Pose& pose, RuntimeCatalogKind kind, const std::string& id, const char* op, const std::string& field) {
    if (id.empty()) throw Error(ErrorCode::invalid_argument, op, "Modifier target ID must not be empty.", field, id);
    const auto& catalog = RuntimeDataAccess::get(pose.data()).index.catalogs[static_cast<std::size_t>(kind)];
    const auto at = catalog.find(id);
    if (at == catalog.end()) throw Error(ErrorCode::not_found, op, "Modifier target does not exist.", field, id);
    return at->second;
}
void edit_bone(animation::Pose& pose, const std::string& id, const Channels& values, bool additive,
               const char* field, const char* op, const std::string& prefix) {
    const auto index = target(pose, RuntimeCatalogKind::bone, id, op, prefix + ".boneId");
    auto& local = pose.locals[index];
    const std::array<float*, 7> into{&local.x, &local.y, &local.rotation_degrees, &local.scale_x, &local.scale_y, &local.shear_x_degrees, &local.shear_y_degrees};
    for (std::size_t component = 0; component < values.size(); ++component) if (values[component]) {
        const float input = *values[component]; const float value = additive ? *into[component] + input : input;
        if (!std::isfinite(input) || !std::isfinite(value))
            throw Error(ErrorCode::non_finite, op, "Modifier input or arithmetic result is non-finite.", prefix + "." + field + "." + fields[component] + (additive ? "Delta" : ""), id);
        *into[component] = value;
    }
}
}
void apply_pose_modifiers(animation::Pose& pose, const PoseModifiers& modifiers, const char* op) {
    for (std::size_t i = 0; i < modifiers.operations.size(); ++i) {
        const auto& value = modifiers.operations[i]; const auto prefix = "modifiers.operations[" + std::to_string(i) + "]";
        if (const auto* replace = std::get_if<ReplaceBoneLocal>(&value)) edit_bone(pose, replace->bone_id, channels(replace->local), false, "local", op, prefix);
        else if (const auto* patch = std::get_if<PatchBoneLocal>(&value)) edit_bone(pose, patch->bone_id, channels(patch->patch), false, "patch", op, prefix);
        else if (const auto* add = std::get_if<AddBoneLocal>(&value)) edit_bone(pose, add->bone_id, channels(add->delta), true, "delta", op, prefix);
        else if (const auto* constraint = std::get_if<PatchConstraint>(&value)) {
            const auto index = target(pose, RuntimeCatalogKind::constraint, constraint->constraint_id, op, prefix + ".constraintId");
            if (public_constraint_kind(pose.model().constraints[index].kind) != override_kind(constraint->parameters))
                throw Error(ErrorCode::invalid_argument, op, "Constraint modifier kind does not match its target.", prefix + ".parameters.type", constraint->constraint_id);
            try { apply_constraint_override(pose.constraints[index], constraint->parameters, op); }
            catch (const Error& e) { throw Error(e.code, op, e.what(), prefix + "." + e.field.value_or("parameters"), constraint->constraint_id, e.detail); }
        } else throw Error(ErrorCode::invalid_argument, op, "Modifier operation has no active value.", prefix + ".operation");
    }
}
}
namespace cane {
RuntimeFrame RuntimePlayer::apply_with_modifiers(const PoseModifiers& modifiers, const SamplingOptions& options) {
    constexpr auto op = "applyWithModifiers";
    return detail::operation(op, [&] {
        auto& p = impl(); p.require_idle(op); const auto sampling = detail::checked_sampling(options, op);
        auto candidate = std::make_unique<detail::PlayerState>(*p.state); constraints::PhysicsBudget budget;
        p.publish(*candidate, p.evaluate(*candidate, budget, sampling, &modifiers, op), p.next_sequence(op));
        p.state.swap(candidate); return p.frame();
    });
}
RuntimeStep RuntimePlayer::advance_with_modifiers(float delta, const PoseModifiers& modifiers, const SamplingOptions& options) {
    return impl().step(delta, true, options, "advanceWithModifiers", &modifiers);
}
}
