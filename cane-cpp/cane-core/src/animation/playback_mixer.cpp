#include "playback.hpp"

namespace cane::animation {
namespace {
float progress(const Track& track, std::size_t i) {
    const auto& e = track.chain[i]; return i == 0 || e.mix_duration == 0 ? 1 : std::clamp(e.mix_time / e.mix_duration, 0.0f, 1.0f);
}
struct PropertyFade {
    const Clip& incoming;
    const std::vector<PropertyKey>& lower;
    float base = 0, mix = 0;
};
float property_weight(const void* raw, PropertyKey key) {
    const auto& fade = *static_cast<const PropertyFade*>(raw);
    return fade.incoming.owns(key) && !std::binary_search(fade.lower.begin(), fade.lower.end(), key)
        ? fade.base : fade.base * (1 - fade.mix);
}
}
void Playback::apply(Pose& pose, PlaybackWorkspace& scratch, const Sampling& sampling) const {
    scratch.lower_properties.clear();
    for (const auto& item : tracks_) {
        const auto& track = item.second; scratch.ancestor_fades.resize(track.chain.size());
        float fade = 1;
        for (std::size_t i = track.chain.size(); i-- > 0;) {
            scratch.ancestor_fades[i] = fade;
            const auto& e = track.chain[i];
            if (!e.clip && !e.hold) fade *= 1 - progress(track, i);
        }
        for (std::size_t i = 0; i < track.chain.size(); ++i) {
            const auto& e = track.chain[i]; if (!e.clip) continue;
            Layer layer{*e.clip}; layer.time = sampling.time(e.pose_time());
            layer.alpha = scratch.ancestor_fades[i] * e.alpha * progress(track, i);
            layer.additive = e.additive; layer.stepped = sampling.stepped;
            if (i + 1 < track.chain.size()) {
                const auto& incoming = track.chain[i + 1]; const float mix = progress(track, i + 1);
                layer.attachments = mix < e.attachment_threshold; layer.draw_order = mix < e.draw_order_threshold;
                if (incoming.clip && !incoming.hold) {
                    const PropertyFade weights{*incoming.clip, scratch.lower_properties, layer.alpha, mix};
                    layer.weight_context = &weights; layer.property_alpha = property_weight; pose.apply(layer); continue;
                }
            }
            pose.apply(layer);
        }
        for (const auto& e : track.chain) if (e.clip) for (const auto key : e.clip->properties) {
            const auto at = std::lower_bound(scratch.lower_properties.begin(), scratch.lower_properties.end(), key);
            if (at == scratch.lower_properties.end() || !(*at == key)) scratch.lower_properties.insert(at, key);
        }
    }
}
}
