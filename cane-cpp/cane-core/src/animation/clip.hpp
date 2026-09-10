#pragma once
#include "curves.hpp"
#include "cane/error.hpp"
#include "cane/math.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <tuple>

namespace cane::animation {
template<class T> struct DiscreteKey { float time = 0; T value; };
template<class T> class DiscreteChannel {
    std::vector<DiscreteKey<T>> keys_;
public:
    DiscreteChannel() = default;
    explicit DiscreteChannel(std::vector<DiscreteKey<T>> source) {
        keys_.reserve(source.size());
        for (auto& key : source) {
            if (!std::isfinite(key.time) || key.time < 0 || (!keys_.empty() && key.time < keys_.back().time))
                throw Error(ErrorCode::validation_failed, "compileChannel", "Discrete times must be finite, non-negative, and ordered.", "time");
            if (!keys_.empty() && key.time == keys_.back().time) keys_.back() = std::move(key);
            else keys_.push_back(std::move(key));
        }
    }
    [[nodiscard]] const std::vector<DiscreteKey<T>>& keys() const noexcept { return keys_; }
    [[nodiscard]] const DiscreteKey<T>* sample_key(float time) const {
        if (!std::isfinite(time)) throw Error(ErrorCode::non_finite, "sampleChannel", "Discrete sample time must be finite.", "time");
        const auto after = std::upper_bound(keys_.begin(), keys_.end(), time, [](float value, const DiscreteKey<T>& key) { return value < key.time; });
        return after == keys_.begin() ? nullptr : &*std::prev(after);
    }
    [[nodiscard]] const T* sample(float time) const { const auto* key = sample_key(time); return key ? &key->value : nullptr; }
};

struct VectorKey { float time = 0; std::vector<float> values; std::array<Curve, 2> curves; };
class VectorChannel {
    std::vector<VectorKey> keys_;
    std::size_t components_ = 0;
public:
    VectorChannel() = default;
    explicit VectorChannel(std::vector<VectorKey> source);
    [[nodiscard]] const std::vector<VectorKey>& keys() const noexcept { return keys_; }
    [[nodiscard]] std::size_t components() const noexcept { return components_; }
    // The caller owns reusable scratch storage. False means no contribution and leaves it untouched.
    [[nodiscard]] bool sample_into(float time, float* output, std::size_t count, bool stepped = false) const;
};

enum class PropertyDomain { bone, slot, attachment, constraint, physics_global, skin, draw_order };
struct PropertyKey {
    PropertyDomain domain = PropertyDomain::bone;
    std::size_t target = 0, component = 0;
    [[nodiscard]] bool operator<(const PropertyKey& other) const noexcept { return std::tie(domain, target, component) < std::tie(other.domain, other.target, other.component); }
    [[nodiscard]] bool operator==(const PropertyKey& other) const noexcept { return domain == other.domain && target == other.target && component == other.component; }
};
struct BoneTimeline {
    std::size_t index = 0;
    // x, y, rotation, scaleX, scaleY, shearX, shearY; inheritance is component 7.
    std::array<ScalarChannel, 7> channels;
    DiscreteChannel<TransformMode> inherit;
};
struct SlotTimeline {
    std::size_t index = 0;
    // color RGB, dark RGB, alpha; attachment is component 7.
    std::array<ScalarChannel, 7> color;
    ScalarChannel alpha;
    DiscreteChannel<bool> dark_present;
    DiscreteChannel<std::optional<std::string>> attachment;
};
enum class DeformSpace { vertex_positions, weighted_influence_offsets };
enum class SequenceMode { hold, once, loop, pingpong, once_reverse, loop_reverse, pingpong_reverse };
struct SequenceSelection { SequenceMode mode = SequenceMode::hold; std::uint32_t index = 0; float delay = 0; };
struct AttachmentTimeline {
    std::size_t index = 0;
    // x, y, rotation, scaleX, scaleY; deform and sequence are components 5 and 6.
    std::array<ScalarChannel, 5> region;
    VectorChannel deform;
    DeformSpace deform_space = DeformSpace::vertex_positions;
    DiscreteChannel<SequenceSelection> sequence;
};
enum class ConstraintKind { ik, transform, path, physics, slider };
enum class ConstraintProperty : std::size_t {
    target_x, target_y, mix, softness, mix_rotate, mix_x, mix_y, mix_scale_x, mix_scale_y, mix_shear_y,
    position, spacing, inertia, strength, damping, mass, wind, gravity, slider_time,
    bend_positive, compress, stretch, reset, count
};
struct ConstraintScalarChannel { ConstraintProperty property; ScalarChannel values; };
struct ConstraintBooleanChannel { ConstraintProperty property; DiscreteChannel<bool> values; };
struct ResetTrigger { float time = 0; std::size_t declaration_order = 0; };
struct ConstraintTimeline {
    ConstraintKind kind = ConstraintKind::ik;
    // Null denotes the Physics wildcard. The solver applies only opted-in global properties.
    std::optional<std::size_t> index;
    std::vector<ConstraintScalarChannel> scalars;
    std::vector<ConstraintBooleanChannel> booleans;
    // Reset is a crossing edge. A same-time false key must not erase an earlier true trigger.
    std::vector<ResetTrigger> reset_triggers;
};
struct EventKey {
    float time = 0;
    std::size_t declaration_order = 0;
    std::optional<std::size_t> event_index;
    std::string name;
    std::optional<std::int64_t> integer_value;
    std::optional<std::string> string_value;
    std::optional<float> number_value;
    std::optional<std::size_t> audio_index;
    float volume = 1, balance = 0;
};
struct DrawOrderFolder {
    std::string path;
    std::vector<std::size_t> members;
    DiscreteChannel<std::vector<std::size_t>> keys;
};
struct Clip {
    std::string id, name;
    float duration = 0, fps = 30;
    std::vector<BoneTimeline> bones;
    std::vector<SlotTimeline> slots;
    std::vector<AttachmentTimeline> attachments;
    std::vector<ConstraintTimeline> constraints;
    // Event duplicates must remain: events are triggers, not a discrete sampled channel.
    std::vector<EventKey> events;
    DiscreteChannel<std::vector<std::size_t>> draw_order;
    std::vector<DrawOrderFolder> draw_order_folders;
    DiscreteChannel<std::optional<std::size_t>> skins;
    std::vector<PropertyKey> properties;
    [[nodiscard]] bool owns(PropertyKey property) const noexcept { return std::binary_search(properties.begin(), properties.end(), property); }
};
}
