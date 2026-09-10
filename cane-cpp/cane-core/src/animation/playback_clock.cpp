#include "playback.hpp"
#include <limits>

namespace cane::animation {
namespace {
double until(const TrackEntry& e, float target) {
    if (e.time >= target) return 0;
    return e.rate > 0 ? (static_cast<double>(target) - e.time) / e.rate : std::numeric_limits<double>::infinity();
}
double next_mix(const Track& track) {
    double result = std::numeric_limits<double>::infinity();
    for (std::size_t i = 1; i < track.chain.size(); ++i) {
        const auto& e = track.chain[i]; result = std::min(result, std::max(0.0, static_cast<double>(e.mix_duration) - e.mix_time));
    }
    return result;
}
}
void Playback::advance_chain(Track& track, std::uint32_t index, double offset, double delta,
                              std::optional<float> current_boundary, EventSink& sink) {
    // Oldest first: each outgoing entry sees its controller's mix clock at segment start.
    for (std::size_t i = 0; i < track.chain.size(); ++i) {
        auto& e = track.chain[i]; const float previous = e.time;
        float next = i + 1 == track.chain.size() && current_boundary ? *current_boundary : previous + static_cast<float>(delta) * e.rate;
        if (!e.looping) next = std::max(0.0f, next);
        if (!std::isfinite(next)) throw Error(ErrorCode::non_finite, sink.operation(), "Track clock overflowed.", "timeSeconds");
        IncomingEventMix incoming;
        const IncomingEventMix* controller = nullptr;
        if (i + 1 < track.chain.size()) {
            const auto& parent = track.chain[i + 1]; incoming = {parent.mix_time, parent.mix_duration}; controller = &incoming;
        }
        e.cursor_initialized = collect_crossings(e.event_view(), index, {previous, next, offset, delta}, sink, controller);
        e.time = next;
        const double mix_remaining = std::max(0.0, static_cast<double>(e.mix_duration) - e.mix_time);
        e.mix_time = i > 0 && delta >= mix_remaining ? e.mix_duration : e.mix_time + static_cast<float>(delta);
        if (!std::isfinite(e.mix_time)) throw Error(ErrorCode::non_finite, sink.operation(), "Mix clock overflowed.", "mixTime");
    }
}
void Playback::update(float delta, EventSink& sink) {
    if (!std::isfinite(delta)) throw Error(ErrorCode::non_finite, sink.operation(), "Update delta must be finite.", "deltaSeconds");
    if (delta < 0) throw Error(ErrorCode::invalid_argument, sink.operation(), "Update delta must be non-negative.", "deltaSeconds");
    const float next_detached = detached_time_ + delta;
    if (!std::isfinite(next_detached)) throw Error(ErrorCode::non_finite, sink.operation(), "Playback clock overflowed.", "deltaSeconds");
    detached_time_ = next_detached;
    for (auto iterator = tracks_.begin(); iterator != tracks_.end();) {
        const auto index = iterator->first; ++iterator;
        double offset = 0, remaining = delta;
        for (;;) {
            const auto found = tracks_.find(index); if (found == tracks_.end()) break;
            auto& track = found->second; const auto& current = track.chain.back();
            const double queue_at = track.queue.empty() ? std::numeric_limits<double>::infinity() : until(current, track.queue.front().delay);
            const double end_at = current.track_end ? until(current, *current.track_end) : std::numeric_limits<double>::infinity();
            const double span = std::min(remaining, std::min(queue_at, std::min(end_at, next_mix(track))));
            const bool promote = queue_at <= span && queue_at <= end_at;
            const bool ending = !promote && end_at <= span;
            std::optional<float> boundary;
            if (span > 0 && (promote || ending)) boundary = promote ? track.queue.front().delay : *current.track_end;
            advance_chain(track, index, offset, span, boundary, sink);
            offset += span; remaining = std::max(0.0, remaining - span);
            bool changed = false;
            if (promote) {
                auto next = std::move(track.queue.front()); track.queue.pop_front();
                sink.lifecycle(EventKind::interrupt, index, track.chain.back().event_view(), offset);
                if (next.mix_duration == 0) { retire(track, track.chain.size(), index, offset, sink); track.chain.clear(); }
                track.chain.push_back(std::move(next));
                sink.lifecycle(EventKind::start, index, track.chain.back().event_view(), offset); changed = true;
            } else if (ending) { clear(index, sink, offset); break; }
            else {
                for (std::size_t i = track.chain.size(); i-- > 1;) {
                    const auto& e = track.chain[i];
                    if (e.mix_duration != 0 && e.mix_time < e.mix_duration) continue;
                    retire(track, i, index, offset, sink);
                    track.chain.erase(track.chain.begin(), track.chain.begin() + static_cast<std::ptrdiff_t>(i));
                    changed = true; break;
                }
            }
            if ((remaining == 0 || span == 0) && !changed) break;
        }
    }
}
}
