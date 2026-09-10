#pragma once
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace cane {
namespace animation { class EventSink; }
namespace detail { struct EventBatchAccess; }
inline constexpr std::size_t max_runtime_events_v1 = 1000000;
enum class EventKind { start, interrupt, end, dispose, complete, user };
struct RuntimeEvent {
    EventKind kind = EventKind::user;
    std::uint32_t track_index = 0;
    std::optional<std::string> animation_id;
    std::optional<float> timeline_time_seconds;
    std::optional<std::string> event_id, name;
    std::optional<std::int64_t> integer_value;
    std::optional<std::string> string_value;
    std::optional<float> number_value;
    std::optional<std::string> audio_id;
    float volume = 1, balance = 0;
};

// All identifiers and payloads are owned. Neither a data object nor mutable clock storage is
// retained by a published batch; later updates cannot change events already returned to a host.
class EventBatch {
    std::shared_ptr<const std::vector<RuntimeEvent>> events_;
    explicit EventBatch(std::vector<RuntimeEvent> events)
        : events_(std::make_shared<const std::vector<RuntimeEvent>>(std::move(events))) {}
    friend class animation::EventSink;
    friend struct detail::EventBatchAccess;
public:
    EventBatch() : EventBatch(std::vector<RuntimeEvent>{}) {}
    [[nodiscard]] const std::vector<RuntimeEvent>& events() const noexcept { return *events_; }
};
}
