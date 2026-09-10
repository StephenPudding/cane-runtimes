#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

namespace cane {
enum class TrackBlend { replace, additive };
struct TrackOptions {
    std::optional<float> alpha, time_scale, event_threshold, attachment_threshold, draw_order_threshold;
    std::optional<bool> looping, hold_previous;
    std::optional<TrackBlend> blend;
};
struct QueuedEntryOptions {
    std::optional<float> delay_seconds, mix_duration_seconds;
    std::optional<bool> looping;
};
struct TrackState {
    std::uint32_t track_index = 0;
    std::optional<std::string> animation_id;
    float track_time = 0, animation_time = 0, animation_start = 0, animation_end = 0, delay_seconds = 0;
    std::optional<float> track_end;
    float alpha = 1, time_scale = 1;
    bool looping = false, hold_previous = false;
    TrackBlend blend = TrackBlend::replace;
    float mix_time = 0, mix_duration = 0, mix_progress = 1;
    float event_threshold = 0, attachment_threshold = 0, draw_order_threshold = 0;
    std::size_t queued_entry_count = 0;
};
struct QueuedEntryState {
    std::uint32_t track_index = 0;
    std::size_t queue_index = 0;
    std::optional<std::string> animation_id;
    float delay_seconds = 0, mix_duration = 0;
    bool looping = false;
};
}
