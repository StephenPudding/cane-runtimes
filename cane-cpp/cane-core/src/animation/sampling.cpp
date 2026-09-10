#include "pose.hpp"
#include <limits>

namespace cane::animation {
namespace {
float& component(BoneLocal& local, std::size_t i) {
    switch (i) {
        case 0: return local.x; case 1: return local.y; case 2: return local.rotation_degrees;
        case 3: return local.scale_x; case 4: return local.scale_y; case 5: return local.shear_x_degrees;
        default: return local.shear_y_degrees;
    }
}
std::uint8_t color_byte(float value) { return static_cast<std::uint8_t>(std::floor(std::clamp(value, 0.0f, 1.0f) * 255.0f + .5f)); }
bool sampled_dark(const DiscreteChannel<bool>& channel, float time) {
    const auto& keys = channel.keys();
    const auto next = std::upper_bound(keys.begin(), keys.end(), time, [](float t, const DiscreteKey<bool>& key) { return t < key.time; });
    if (next == keys.begin()) return false;
    const auto& current = *std::prev(next);
    return current.value || (time != current.time && next != keys.end() && next->value);
}
std::uint32_t sequence_index(const DiscreteKey<SequenceSelection>& key, float time, std::size_t count) {
    const auto& value = key.value;
    if (value.mode == SequenceMode::hold || value.delay <= 0) return value.index;
    const double steps = std::floor((static_cast<double>(time) - key.time) / value.delay + .00001);
    const auto last = static_cast<std::uint32_t>(count - 1);
    const auto loop = [&] { return static_cast<std::uint32_t>(std::fmod(std::fmod(steps, static_cast<double>(count)) + value.index, static_cast<double>(count))); };
    const auto pingpong = [&](bool reverse) {
        if (count <= 1) return std::uint32_t{0};
        const double period = 2.0 * static_cast<double>(count) - 2;
        const auto phase = std::fmod(std::fmod(steps, period) + value.index + (reverse ? last : 0), period);
        return static_cast<std::uint32_t>(phase < static_cast<double>(count) ? phase : period - phase);
    };
    switch (value.mode) {
        case SequenceMode::once: return steps >= last - value.index ? last : value.index + static_cast<std::uint32_t>(steps);
        case SequenceMode::once_reverse: return steps >= last - value.index ? 0 : last - value.index - static_cast<std::uint32_t>(steps);
        case SequenceMode::loop: return loop();
        case SequenceMode::loop_reverse: return last - loop();
        case SequenceMode::pingpong: return pingpong(false);
        case SequenceMode::pingpong_reverse: return pingpong(true);
        case SequenceMode::hold: return value.index;
    }
    throw Error(ErrorCode::invalid_argument, "apply", "Unknown image sequence mode.");
}
float constrained_scalar(ConstraintKind kind, ConstraintProperty property, float value) {
    using P = ConstraintProperty;
    if (kind == ConstraintKind::physics) {
        if (property == P::mix || property == P::inertia || property == P::damping) return std::clamp(value, 0.0f, 1.0f);
        if (property == P::strength) return std::max(0.0f, value);
        if (property == P::mass && value <= 0) return std::numeric_limits<float>::denorm_min();
    } else if (kind == ConstraintKind::ik) {
        if (property == P::mix) return std::clamp(value, 0.0f, 1.0f);
        if (property == P::softness) return std::max(0.0f, value);
    } else if (kind == ConstraintKind::path && (property == P::mix_rotate || property == P::mix_x || property == P::mix_y)) return std::clamp(value, 0.0f, 1.0f);
    return value;
}
}
void Pose::apply(const Layer& layer) {
    if (!std::isfinite(layer.time) || !std::isfinite(layer.alpha)) throw Error(ErrorCode::non_finite, "apply", "Layer sample time and alpha must be finite.");
    const auto& clip = layer.clip; const auto& m = model();
    for (const auto& timeline : clip.bones) {
        auto& local = locals[timeline.index]; auto setup = data_.bones()[timeline.index].setup;
        for (std::size_t i = 0; i < timeline.channels.size(); ++i) {
            const bool angular = i == 2 || i >= 5;
            const auto sample = timeline.channels[i].sample(layer.time, angular, layer.stepped);
            if (sample) component(local, i) = blend_scalar(component(local, i), component(setup, i), *sample, layer.weight(PropertyDomain::bone, timeline.index, i), layer.additive, angular);
        }
        const auto inherit = timeline.inherit.sample(layer.time);
        if (inherit && layer.weight(PropertyDomain::bone, timeline.index, 7) >= .5f) modes[timeline.index] = *inherit;
    }
    for (const auto& timeline : clip.slots) {
        auto& slot = slots[timeline.index]; const auto& setup = m.slots[timeline.index];
        if (layer.attachments && layer.weight(PropertyDomain::slot, timeline.index, 7) >= .5f) {
            if (const auto key = timeline.attachment.sample(layer.time)) slot.key = *key;
        }
        const auto color_alpha = timeline.color[6].sample(layer.time, false, layer.stepped);
        if (color_alpha) {
            const auto blend_rgb = [&](detail::Rgb current, detail::Rgb base, std::size_t start) {
                for (std::size_t i = 0; i < current.size(); ++i) {
                    const auto value = timeline.color[start + i].sample(layer.time, false, layer.stepped);
                    if (value) current[i] = color_byte(blend_scalar(static_cast<float>(current[i]) / 255.0f, static_cast<float>(base[i]) / 255.0f, *value,
                        layer.weight(PropertyDomain::slot, timeline.index, start + i), layer.additive));
                }
                return current;
            };
            slot.color = blend_rgb(slot.color, setup.color, 0);
            bool dark_weight = false;
            for (std::size_t i = 3; i < 6; ++i) dark_weight = dark_weight || layer.weight(PropertyDomain::slot, timeline.index, i) != 0;
            if (dark_weight && (slot.dark || setup.dark || sampled_dark(timeline.dark_present, layer.time))) slot.dark = blend_rgb(slot.dark.value_or(detail::Rgb{}), setup.dark.value_or(detail::Rgb{}), 3);
        }
        const auto separate = timeline.alpha.sample(layer.time, false, layer.stepped);
        const auto alpha = !timeline.alpha.keys().empty() && color_alpha ? std::optional<float>(separate.value_or(setup.alpha)) : separate ? separate : color_alpha;
        if (alpha) slot.alpha = std::clamp(blend_scalar(slot.alpha, setup.alpha, *alpha, layer.weight(PropertyDomain::slot, timeline.index, 6), layer.additive), 0.0f, 1.0f);
    }
    for (const auto& timeline : clip.attachments) {
        auto& local = regions[timeline.index]; auto setup = m.attachments[timeline.index].local;
        for (std::size_t i = 0; i < timeline.region.size(); ++i) {
            const auto value = timeline.region[i].sample(layer.time, i == 2, layer.stepped);
            if (value) component(local, i) = blend_scalar(component(local, i), component(setup, i), *value, layer.weight(PropertyDomain::attachment, timeline.index, i), layer.additive, i == 2);
        }
        apply_deform(timeline, layer);
        if (layer.attachments && layer.weight(PropertyDomain::attachment, timeline.index, 6) >= .5f) {
            if (const auto key = timeline.sequence.sample_key(layer.time)) sequence_indices[timeline.index] = sequence_index(*key, layer.time, m.attachments[timeline.index].sequence_images.size());
        }
    }
    for (const auto& timeline : clip.constraints) {
        const auto apply_constraint = [&](std::size_t index) {
            const auto& definition = m.constraints[index]; auto& current = constraints[index];
            const auto domain = timeline.index ? PropertyDomain::constraint : PropertyDomain::physics_global;
            const auto target = timeline.index.value_or(0);
            for (const auto& channel : timeline.scalars) {
                const auto field = static_cast<std::size_t>(channel.property);
                if (!timeline.index && !std::get<detail::PhysicsDefinition>(definition.definition).globals[field]) continue;
                const auto value = channel.values.sample(layer.time, false, layer.stepped);
                if (value) {
                    const auto weight = layer.weight(domain, target, field);
                    if (weight != 0) current[channel.property] = constrained_scalar(definition.kind, channel.property,
                        blend_scalar(current[channel.property], definition.setup[channel.property], *value, weight, layer.additive && channel.property != ConstraintProperty::slider_time));
                }
            }
            for (const auto& channel : timeline.booleans) {
                const auto field = static_cast<std::size_t>(channel.property);
                const auto value = channel.values.sample(layer.time);
                if (value && layer.weight(domain, target, field) >= .5f) current.booleans.at(field - detail::scalar_parameter_count) = *value;
            }
        };
        if (timeline.index) apply_constraint(*timeline.index);
        else for (std::size_t i = 0; i < m.constraints.size(); ++i) if (m.constraints[i].kind == ConstraintKind::physics) apply_constraint(i);
    }
    if (layer.attachments && layer.weight(PropertyDomain::skin) >= .5f) {
        if (const auto skin = clip.skins.sample(layer.time)) { skins.clear(); if (*skin) skins.push_back(**skin); }
    }
    if (layer.draw_order && layer.weight(PropertyDomain::draw_order) >= .5f) {
        if (const auto sampled = clip.draw_order.sample(layer.time)) { order = *sampled; order_sampled = true; }
        for (const auto& folder : clip.draw_order_folders) {
            const auto key = folder.keys.sample(layer.time); if (!key) continue;
            std::fill(order_members_.begin(), order_members_.end(), false);
            for (const auto member : folder.members) order_members_[member] = true;
            std::size_t at = 0;
            for (auto& member : order) if (order_members_[member]) member = (*key)[at++];
            order_sampled = true;
        }
    }
}
}
