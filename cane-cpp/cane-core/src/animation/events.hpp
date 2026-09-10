#pragma once
#include "clip.hpp"
#include "cane/events.hpp"
#include "cane/runtime_data.hpp"

namespace cane::animation {
// Borrowed from a detached playback candidate. collect_crossings never changes the entry;
// the caller commits the returned cursor only after the entire operation succeeds.
struct EventEntry {
    const Clip* clip = nullptr;
    float range_start = 0, range_end = 0;
    bool looping = false, cursor_initialized = false;
    float event_threshold = 0;
    std::uint64_t order = 0; // Oldest outgoing entry first, assigned by the playback owner.
};
struct EventInterval {
    float previous = 0, current = 0;
    double base_offset = 0, delta = 0;
};
struct IncomingEventMix { float time = 0, duration = 0; };

class EventSink {
    struct Occurrence {
        double offset = 0;
        std::uint32_t track = 0;
        std::uint64_t entry_order = 0;
        unsigned phase = 0;
        std::size_t ordinal = 0;
        EventKind kind = EventKind::user;
        const Clip* clip = nullptr;
        const EventKey* key = nullptr;
    };
    const RuntimeData& data_;
    std::string operation_;
    bool collecting_;
    std::size_t capacity_, count_ = 0;
    std::vector<Occurrence> occurrences_;
    void append(EventKind kind, std::uint32_t track, const EventEntry& entry,
                const EventKey* key, double offset, std::optional<std::uint64_t> order = {});
public:
    // First run the entire clock transaction with collect=false. Only after that succeeds,
    // replay it with collect=true and capacity=count from the dry pass. Borrowed clips/keys
    // must remain stable until finish; no JSON or host callbacks are used during traversal.
    EventSink(const RuntimeData& data, std::string operation, bool collect = false,
              std::size_t capacity = max_runtime_events_v1);
    [[nodiscard]] std::size_t count() const noexcept { return count_; }
    [[nodiscard]] const std::string& operation() const noexcept { return operation_; }
    void require(double minimum) const;
    void lifecycle(EventKind kind, std::uint32_t track, const EventEntry& entry, double offset,
                   std::optional<std::uint64_t> retirement_order = {});
    void user(std::uint32_t track, const EventEntry& entry, const EventKey& key, double offset);
    [[nodiscard]] EventBatch finish();
};

[[nodiscard]] bool collect_crossings(const EventEntry& entry, std::uint32_t track,
                                     const EventInterval& interval, EventSink& sink,
                                     const IncomingEventMix* incoming = nullptr);
}
