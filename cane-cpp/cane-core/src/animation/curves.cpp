#include "curves.hpp"
#include "cane/error.hpp"
#include "cane/math.hpp"
#include <algorithm>
#include <cmath>

namespace cane::animation {
namespace {
void finite(float value, const char* field) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "sampleCurve", "Animation input must be finite.", field);
}
float result(float value) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "sampleCurve", "Animation arithmetic produced a non-finite result.");
    return value;
}
double cubic(double start, double c1, double c2, double end, double u) noexcept {
    const auto inverse = 1 - u;
    return inverse * inverse * inverse * start + 3 * inverse * inverse * u * c1
        + 3 * inverse * u * u * c2 + u * u * u * end;
}
bool monotonic(float x1, float x2) noexcept {
    // The derivative minimum is tested in binary64, with already-loaded binary32 controls.
    const double first = x1, second = x2;
    if (first < 0 || 1 - second < 0) return false;
    const auto a = 1 + 3 * first - 3 * second, b = 2 * (second - 2 * first);
    if (a > 0) {
        const auto vertex = -b / (2 * a);
        if (vertex > 0 && vertex < 1 && a * vertex * vertex + b * vertex + first < 0) return false;
    }
    return true;
}
}
Curve::Curve(CurveKind kind, float x1, float y1, float x2, float y2)
    : kind_(kind), x1_(x1), y1_(y1), x2_(x2), y2_(y2) {
    if (kind != CurveKind::linear && kind != CurveKind::stepped && kind != CurveKind::bezier && kind != CurveKind::bezier_value)
        throw Error(ErrorCode::invalid_argument, "compileCurve", "Unknown curve kind.", "type");
    finite(x1, "cx1"); finite(y1, "cy1/dy1"); finite(x2, "cx2"); finite(y2, "cy2/dy2");
    monotonic_ = monotonic(x1, x2);
}
float Curve::sample(float from, float to, float progress, bool angular, bool discrete) const {
    finite(from, "from"); finite(to, "to"); finite(progress, "progress");
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    if (discrete || kind_ == CurveKind::stepped) return from;
    if (kind_ == CurveKind::linear)
        return result(from + (angular ? wrap_degrees(to - from) : to - from) * progress);
    const bool percent = kind_ == CurveKind::bezier;
    const float start = percent ? 0 : from, end = percent ? 1 : to;
    const float control1 = percent ? y1_ : from + y1_, control2 = percent ? y2_ : to + y2_;
    float sampled;
    if (monotonic_) {
        double low = 0, high = 1, u = progress;
        for (unsigned iteration = 0; iteration < 24; ++iteration) {
            u = (low + high) * .5;
            if (cubic(0, x1_, x2_, 1, u) < progress) low = u;
            else high = u;
        }
        sampled = static_cast<float>(cubic(start, control1, control2, end, u));
    } else {
        // Deliberately choose the first crossing among ten chords, not a cubic root.
        double previous_x = 0, previous_y = start;
        sampled = end;
        for (unsigned step = 1; step <= 10; ++step) {
            const double u = step / 10.0;
            const auto x = step == 10 ? 1 : cubic(0, x1_, x2_, 1, u);
            const auto y = step == 10 ? end : cubic(start, control1, control2, end, u);
            if (x >= progress || step == 10) {
                sampled = static_cast<float>(x == previous_x ? y : previous_y + (progress - previous_x) / (x - previous_x) * (y - previous_y));
                break;
            }
            previous_x = x; previous_y = y;
        }
    }
    if (percent) return result(from + (angular ? wrap_degrees(to - from) : to - from) * sampled);
    return result(angular ? from + wrap_degrees(sampled - from) : sampled);
}
Curve PropertyCurves::select(std::string_view property) const {
    const auto found = properties.find(std::string(property));
    return found == properties.end() ? default_curve : found->second;
}
ScalarChannel::ScalarChannel(std::vector<ScalarKey> keys) {
    keys_.reserve(keys.size());
    for (const auto& key : keys) {
        finite(key.time, "time"); finite(key.value, "value");
        if (key.time < 0 || (!keys_.empty() && key.time < keys_.back().time))
            throw Error(ErrorCode::validation_failed, "compileChannel", "Key times must be non-negative and in declaration-time order.", "time");
        if (!keys_.empty() && key.time == keys_.back().time) keys_.back() = key;
        else keys_.push_back(key);
    }
}
ScalarChannel ScalarChannel::merge(const ScalarChannel& paired, const ScalarChannel& axis) {
    std::vector<ScalarKey> merged; merged.reserve(paired.keys_.size() + axis.keys_.size());
    auto pair_key = paired.keys_.begin(), axis_key = axis.keys_.begin();
    while (pair_key != paired.keys_.end() || axis_key != axis.keys_.end()) {
        if (axis_key == axis.keys_.end() || (pair_key != paired.keys_.end() && pair_key->time < axis_key->time)) merged.push_back(*pair_key++);
        else {
            if (pair_key != paired.keys_.end() && pair_key->time == axis_key->time) ++pair_key;
            merged.push_back(*axis_key++);
        }
    }
    return ScalarChannel(std::move(merged));
}
std::optional<float> ScalarChannel::sample(float time, bool angular, bool discrete) const {
    finite(time, "time");
    if (keys_.empty() || time < keys_.front().time) return {};
    const auto after = std::upper_bound(keys_.begin(), keys_.end(), time, [](float t, const ScalarKey& key) { return t < key.time; });
    const auto& outgoing = *std::prev(after);
    if (after == keys_.end() || time == outgoing.time) return outgoing.value;
    return outgoing.curve.sample(outgoing.value, after->value, (time - outgoing.time) / (after->time - outgoing.time), angular, discrete);
}
float blend_scalar(float current, float setup, float sampled, float alpha, bool additive, bool angular) {
    finite(current, "current"); finite(setup, "setup"); finite(sampled, "sample"); finite(alpha, "alpha");
    if (alpha == 0) return current;
    const auto delta = sampled - (additive ? setup : current);
    return result(current + (angular ? wrap_degrees(delta) : delta) * alpha);
}
float fixed_frame_time(float pose_time, float frame_step_seconds) {
    finite(pose_time, "time"); finite(frame_step_seconds, "frameStepSeconds");
    if (frame_step_seconds <= 0) throw Error(ErrorCode::invalid_argument, "sampleAt", "Frame step must be positive.", "frameStepSeconds");
    const auto frames = static_cast<double>(pose_time) / frame_step_seconds;
    return result(static_cast<float>(std::floor(frames + .5) * frame_step_seconds));
}
}
