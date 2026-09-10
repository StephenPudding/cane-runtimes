#include "solvers.hpp"
#include "runtime_data_internal.hpp"

namespace cane::constraints {
namespace {
float local_property(const BoneLocal& local, detail::MappedProperty property) {
    switch (property) {
        case detail::MappedProperty::rotate: return local.rotation_degrees;
        case detail::MappedProperty::x: return local.x;
        case detail::MappedProperty::y: return local.y;
        case detail::MappedProperty::scale_x: return local.scale_x;
        case detail::MappedProperty::scale_y: return local.scale_y;
        case detail::MappedProperty::shear_y: return local.shear_y_degrees;
    }
    throw Error(ErrorCode::invalid_state, "apply", "Unknown Slider source property.");
}
float world_property(const Affine& world, detail::MappedProperty property) {
    switch (property) {
        case detail::MappedProperty::rotate: { const auto angle = x_angle(world); return angle < 0 ? angle + 360 : angle; }
        case detail::MappedProperty::x: return world.tx;
        case detail::MappedProperty::y: return world.ty;
        case detail::MappedProperty::scale_x: return x_scale(world);
        case detail::MappedProperty::scale_y: return y_scale(world);
        case detail::MappedProperty::shear_y: return y_angle(world) - x_angle(world) - 90;
    }
    throw Error(ErrorCode::invalid_state, "apply", "Unknown Slider source property.");
}
}
void solve_slider(Context& context, std::size_t index, const animation::Sampling& sampling) {
    using P = animation::ConstraintProperty;
    auto& pose = context.pose;
    pose.diagnostics.at(index) = std::monostate{};
    if (!pose.active_constraints.at(index)) return;
    // Capture settings before the layer can overwrite even its own sampled values.
    const auto d = std::get<detail::SliderDefinition>(pose.model().constraints.at(index).definition);
    const auto parameters = pose.constraints[index]; const auto mix = parameters[P::mix];
    if (!std::isfinite(mix) || mix == 0) return;
    const auto& clip = detail::RuntimeDataAccess::get(pose.data()).clips[d.animation];
    auto time = parameters[P::slider_time]; std::optional<float> source;
    if (d.source_bone) {
        const auto bone = *d.source_bone; if (!pose.active_bones[bone]) return;
        if (d.local) source = local_property(pose.locals[bone], d.source_property);
        else {
            // World mapping removes only the host root, using the exact-zero
            // inverse rule, not the applied-pose reconstruction tolerance.
            const auto inverse = context.root.inverse(); if (!inverse) return;
            source = world_property(*inverse * pose.world[bone], d.source_property);
        }
        time = parameters.slider.time_offset + (*source - parameters.slider.source_offset) * parameters.slider.time_scale;
    }
    if (!std::isfinite(time) || (source && !std::isfinite(*source))) return;
    const auto mapped = time; const auto looping = d.looping && clip.duration > 0;
    if (looping) { time = std::fmod(time, clip.duration); if (time < 0) time += clip.duration; if (time == clip.duration) time = 0; }
    else if (source) time = std::clamp(time, 0.0f, std::max(clip.duration, 0.0f));
    // Pose::apply samples all channels but never clocks, events, or constraints.
    // Later declarations observe mutations; earlier/current solvers cannot recur.
    pose.apply({clip, sampling.time(time), mix, d.additive, true, true, sampling.stepped});
    pose.resolve_attachments();
    if (!clip.bones.empty()) pose.update_world(context.root);
    pose.diagnostics[index] = SliderDiagnostic{source, mapped, time, clip.duration, looping && mapped != time, !looping && source.has_value() && mapped != time};
}
}
