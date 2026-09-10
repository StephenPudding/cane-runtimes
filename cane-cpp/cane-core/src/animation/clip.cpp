#include "clip.hpp"

namespace cane::animation {
VectorChannel::VectorChannel(std::vector<VectorKey> source) {
    if (!source.empty()) components_ = source.front().values.size();
    keys_.reserve(source.size());
    for (auto& key : source) {
        if (!std::isfinite(key.time) || key.time < 0 || (!keys_.empty() && key.time < keys_.back().time))
            throw Error(ErrorCode::validation_failed, "compileChannel", "Vector times must be finite, non-negative, and ordered.", "time");
        if (key.values.size() != components_ || components_ % 2 != 0)
            throw Error(ErrorCode::validation_failed, "compileChannel", "Vector keys require a consistent XY component count.", "vertices");
        for (const auto component : key.values) if (!std::isfinite(component))
            throw Error(ErrorCode::non_finite, "compileChannel", "Vector values must be finite.", "vertices");
        if (!keys_.empty() && key.time == keys_.back().time) keys_.back() = std::move(key);
        else keys_.push_back(std::move(key));
    }
}
bool VectorChannel::sample_into(float time, float* output, std::size_t count, bool stepped) const {
    if (!std::isfinite(time)) throw Error(ErrorCode::non_finite, "sampleChannel", "Vector sample time must be finite.", "time");
    if (keys_.empty() || time < keys_.front().time) return false;
    if (count != components_ || (count != 0 && output == nullptr))
        throw Error(ErrorCode::invalid_argument, "sampleChannel", "Vector output must have the exact source component count.", "output");
    if (count == 0) return true;
    const auto after = std::upper_bound(keys_.begin(), keys_.end(), time, [](float value, const VectorKey& key) { return value < key.time; });
    const auto& current = *std::prev(after);
    if (after == keys_.end() || time == current.time || stepped) { std::copy(current.values.begin(), current.values.end(), output); return true; }
    const auto progress = (time - current.time) / (after->time - current.time);
    for (std::size_t i = 0; i < count; ++i) output[i] = current.curves[i % 2].sample(current.values[i], after->values[i], progress);
    return true;
}
}
