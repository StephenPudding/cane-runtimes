#include "events.hpp"
#include <limits>

namespace cane::animation {
namespace {
// Smallest integer n whose loaded binary32 n*duration is >= value (inclusive), or >
// value. Quotient floor alone is not a boundary test: e.g. loaded .7/.1 is below 7.
double boundary_index(float value, double duration, bool inclusive) {
    const double center = value;
    const float before = std::nextafter(value, -std::numeric_limits<float>::infinity());
    const float after = std::nextafter(value, std::numeric_limits<float>::infinity());
    const double lower_gap = std::isfinite(before) ? center - before : static_cast<double>(after) - center;
    const double upper_gap = std::isfinite(after) ? static_cast<double>(after) - center : lower_gap;
    double low = std::floor((center - lower_gap) / duration) - 2;
    double high = std::ceil((center + upper_gap) / duration) + 2;
    while (low < high) {
        const double mid = low + std::floor((high - low) * .5);
        const float raw = static_cast<float>(mid * duration);
        if (inclusive ? raw >= value : raw > value) high = mid;
        else low = mid + 1;
    }
    return low;
}
}
EventSink::EventSink(const RuntimeData& data, std::string operation, bool collect, std::size_t capacity)
    : data_(data), operation_(std::move(operation)), collecting_(collect), capacity_(capacity) {
    if (capacity > max_runtime_events_v1)
        throw Error(ErrorCode::invalid_argument, operation_, "The event budget exceeds the Runtime API limit.", "eventCapacity");
    if (collecting_) occurrences_.reserve(capacity_);
}
void EventSink::require(double minimum) const {
    if (!std::isfinite(minimum) || minimum > static_cast<double>(capacity_ - count_))
        throw Error(ErrorCode::resource_limit, operation_, "The operation exceeds its remaining event budget.",
                    operation_ == "seek" || operation_ == "sampleAt" ? "timeSeconds" : "deltaSeconds");
    if (minimum < 0)
        throw Error(ErrorCode::invalid_argument, operation_, "An event count cannot be negative.", "eventCount");
}
void EventSink::append(EventKind kind, std::uint32_t track, const EventEntry& entry,
                       const EventKey* key, double offset, std::optional<std::uint64_t> order) {
    if (!std::isfinite(offset) || offset < 0)
        throw Error(ErrorCode::non_finite, operation_, "An event crossing requires a finite non-negative wall offset.", "eventOffset");
    require(1);
    if (collecting_) {
        const unsigned phase = kind == EventKind::interrupt || kind == EventKind::end || kind == EventKind::dispose ? 1u : 0u;
        occurrences_.push_back({offset, track, order.value_or(entry.order), phase, count_, kind, entry.clip, key});
    }
    ++count_;
}
void EventSink::lifecycle(EventKind kind, std::uint32_t track, const EventEntry& entry, double offset, std::optional<std::uint64_t> retirement_order) {
    if (kind == EventKind::user)
        throw Error(ErrorCode::invalid_argument, operation_, "A user event requires its authored key.", "eventKind");
    append(kind, track, entry, nullptr, offset, retirement_order);
}
void EventSink::user(std::uint32_t track, const EventEntry& entry, const EventKey& key, double offset) {
    if (!entry.clip) throw Error(ErrorCode::invalid_state, operation_, "An empty entry cannot emit an authored event.", "animationId");
    append(EventKind::user, track, entry, &key, offset);
}
EventBatch EventSink::finish() {
    if (!collecting_ || count_ != capacity_)
        throw Error(ErrorCode::invalid_state, operation_, "Collected events differ from the preflight count.", "eventCount");
    std::sort(occurrences_.begin(), occurrences_.end(), [](const Occurrence& a, const Occurrence& b) {
        return std::tie(a.offset, a.track, a.entry_order, a.phase, a.ordinal)
             < std::tie(b.offset, b.track, b.entry_order, b.phase, b.ordinal);
    });
    std::vector<RuntimeEvent> values;
    values.reserve(count_);
    for (const auto& at : occurrences_) {
        RuntimeEvent value; value.kind = at.kind; value.track_index = at.track;
        if (at.clip) value.animation_id = at.clip->id;
        if (at.key) {
            const auto& key = *at.key;
            value.timeline_time_seconds = key.time;
            value.name = key.name;
            if (key.event_index) {
                const auto& event = data_.catalog(RuntimeCatalogKind::event).at(*key.event_index);
                value.event_id = event.id; value.name = event.name;
            }
            value.integer_value = key.integer_value; value.string_value = key.string_value;
            value.number_value = key.number_value; value.volume = key.volume; value.balance = key.balance;
            if (key.audio_index) value.audio_id = data_.catalog(RuntimeCatalogKind::audio).at(*key.audio_index).id;
        }
        values.push_back(std::move(value));
    }
    return EventBatch(std::move(values));
}

bool collect_crossings(const EventEntry& entry, std::uint32_t track, const EventInterval& interval,
                       EventSink& sink, const IncomingEventMix* incoming) {
    const auto finite = [](double value) { return std::isfinite(value); };
    if (!finite(interval.previous) || !finite(interval.current) || !finite(interval.base_offset) ||
        !finite(interval.delta) || !finite(interval.base_offset + interval.delta) ||
        !finite(entry.range_start) || !finite(entry.range_end) || !finite(entry.event_threshold) ||
        (incoming && (!finite(incoming->time) || !finite(incoming->duration))))
        throw Error(ErrorCode::non_finite, sink.operation(), "Event traversal values must be finite.", "timeSeconds");
    if (interval.base_offset < 0 || interval.delta < 0 || entry.range_start < 0 || entry.range_end < entry.range_start ||
        (entry.clip && entry.range_end > entry.clip->duration) || entry.event_threshold < 0 || entry.event_threshold > 1 ||
        (!entry.looping && (interval.previous < 0 || interval.current < 0)) ||
        (incoming && (incoming->time < 0 || incoming->duration < 0)) ||
        (interval.delta == 0 && interval.previous != interval.current))
        throw Error(ErrorCode::invalid_argument, sink.operation(), "Event traversal range or interval is invalid.", "timeSeconds");
    if (interval.previous == interval.current) return entry.cursor_initialized;
    if (!entry.clip) return true;

    const double previous = interval.previous, current = interval.current;
    const double duration = static_cast<float>(entry.range_end - entry.range_start);
    const bool forward = current > previous;
    const auto& keys = entry.clip->events;
    const auto relative_wall = [&](double raw) { return (raw - previous) / (current - previous) * interval.delta; };
    const auto wall = [&](double raw) { return interval.base_offset + relative_wall(raw); };
    const auto enabled = [&](double relative_offset) {
        if (!incoming) return true;
        const double progress = incoming->duration == 0 ? 1 :
            std::clamp((static_cast<double>(incoming->time) + relative_offset) / incoming->duration, 0.0, 1.0);
        return progress < entry.event_threshold;
    };
    const auto user = [&](const EventKey& key, double raw) {
        const double relative = relative_wall(raw);
        if (enabled(relative)) sink.user(track, entry, key, interval.base_offset + relative);
    };
    const auto boundary = [&](double raw) {
        if (forward) {
            for (const auto& key : keys) if (key.time == entry.range_end) user(key, raw);
            sink.lifecycle(EventKind::complete, track, entry, wall(raw));
            for (const auto& key : keys) if (key.time == entry.range_start) user(key, raw);
        } else {
            for (auto key = keys.rbegin(); key != keys.rend(); ++key) if (key->time == entry.range_start) user(*key, raw);
            sink.lifecycle(EventKind::complete, track, entry, wall(raw));
            for (auto key = keys.rbegin(); key != keys.rend(); ++key) if (key->time == entry.range_end) user(*key, raw);
        }
    };
    if (!entry.cursor_initialized && previous == 0 && enabled(0))
        for (const auto& key : keys) if (key.time == entry.range_start) sink.user(track, entry, key, interval.base_offset);
    if (duration == 0) return true;
    if (!entry.looping) {
        if (forward) {
            for (const auto& key : keys) {
                const double raw = static_cast<float>(key.time - entry.range_start);
                if (raw >= 0 && raw <= duration && raw > previous && raw <= current) user(key, raw);
            }
            if (previous < duration && current >= duration) sink.lifecycle(EventKind::complete, track, entry, wall(duration));
        } else {
            for (auto key = keys.rbegin(); key != keys.rend(); ++key) {
                const double raw = static_cast<float>(key->time - entry.range_start);
                if (raw >= 0 && raw <= duration && raw >= current && raw < previous) user(*key, raw);
            }
            if (previous > 0 && current <= 0) sink.lifecycle(EventKind::complete, track, entry, wall(0));
        }
        return true;
    }

    // Distinct loaded endpoints own a rounding-cell interval at least half their raw span.
    // This looser quarter-span bound rejects enormous clocks before searching integer cycles;
    // surviving cycle indices are exactly representable in binary64. Exact counting below
    // uses rounded crossings, including all cycles that collapse onto one loaded endpoint.
    sink.require(std::max(0.0, std::floor(std::abs(current - previous) / duration * .25) - 2));
    const double first = boundary_index(interval.previous, duration, !forward);
    const double after = boundary_index(interval.current, duration, !forward);
    const double completions = forward ? after - first : first - after;
    sink.require(completions);
    double cycle = first - 1;
    const auto iterations = static_cast<std::size_t>(completions) + 1;
    for (std::size_t n = 0; n < iterations; ++n, cycle += forward ? 1 : -1) {
        if (forward) {
            for (const auto& key : keys) {
                if (key.time <= entry.range_start || key.time >= entry.range_end) continue;
                const double raw = static_cast<float>(cycle * duration + static_cast<float>(key.time - entry.range_start));
                if (raw > previous && raw <= current) user(key, raw);
            }
            const double end = static_cast<float>((cycle + 1) * duration);
            if (end > previous && end <= current) boundary(end);
        } else {
            for (auto key = keys.rbegin(); key != keys.rend(); ++key) {
                if (key->time <= entry.range_start || key->time >= entry.range_end) continue;
                const double raw = static_cast<float>(cycle * duration + static_cast<float>(key->time - entry.range_start));
                if (raw >= current && raw < previous) user(*key, raw);
            }
            const double end = static_cast<float>(cycle * duration);
            if (end >= current && end < previous) boundary(end);
        }
    }
    return true;
}
}
