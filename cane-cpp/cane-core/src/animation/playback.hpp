#pragma once
#include "events.hpp"
#include "pose.hpp"
#include "cane/playback.hpp"
#include <deque>

namespace cane::animation {
struct TrackEntry {
    const Clip* clip = nullptr;
    float time = 0, start = 0, end = 0, delay = 0, mix_time = 0, mix_duration = 0, alpha = 1, rate = 1;
    float event_threshold = 0, attachment_threshold = 0, draw_order_threshold = 0;
    std::optional<float> track_end;
    bool looping = false, additive = false, hold = false, cursor_initialized = false;
    std::uint64_t identity = 0;
    [[nodiscard]] float duration() const noexcept { return std::max(0.0f, end - start); }
    [[nodiscard]] float pose_time() const noexcept;
    [[nodiscard]] EventEntry event_view() const noexcept { return {clip, start, end, looping, cursor_initialized, event_threshold, identity}; }
};
struct Track {
    // Oldest mixingFrom first. A flat owned chain avoids recursive traversal, copying and destruction.
    std::vector<TrackEntry> chain;
    std::deque<TrackEntry> queue;
};
struct PlaybackWorkspace {
    std::vector<PropertyKey> lower_properties;
    std::vector<float> ancestor_fades;
};
class Playback {
    RuntimeData data_;
    std::map<std::uint32_t, Track> tracks_;
    std::map<std::pair<std::string, std::string>, float> mixes_;
    float default_mix_ = 0, detached_time_ = 0;
    std::uint32_t allocated_tracks_ = 0;
    std::uint64_t next_identity_ = 0;
    [[nodiscard]] const Clip* resolve(std::optional<std::string_view> id, const char* operation) const;
    [[nodiscard]] TrackEntry make_entry(const Clip* clip, bool looping, float mix, const char* operation);
    [[nodiscard]] float mix(const TrackEntry& from, const Clip* to) const;
    [[nodiscard]] Track& require_track(std::uint32_t index, const char* operation);
    static void retire(const Track& track, std::size_t count, std::uint32_t index, double offset, EventSink& sink);
    static void advance_chain(Track& track, std::uint32_t index, double offset, double delta,
                              std::optional<float> current_boundary, EventSink& sink);
public:
    explicit Playback(RuntimeData data) : data_(std::move(data)) {}
    [[nodiscard]] const RuntimeData& data() const noexcept { return data_; }
    [[nodiscard]] const std::map<std::uint32_t, Track>& tracks() const noexcept { return tracks_; }
    [[nodiscard]] std::uint32_t allocated_tracks() const noexcept { return allocated_tracks_; }
    [[nodiscard]] float default_mix() const noexcept { return default_mix_; }
    [[nodiscard]] float time() const noexcept;
    [[nodiscard]] Playback clone_configuration() const;
    [[nodiscard]] Playback rebind(RuntimeData data, const char* operation) const;
    [[nodiscard]] Playback reconcile(RuntimeData data) const;
    void set_detached_time(float time);
    void set_default_mix(float seconds);
    void set_mix(std::string_view from, std::string_view to, float seconds);
    void replace(std::uint32_t index, std::optional<std::string_view> clip, bool looping, std::optional<float> mix_seconds, EventSink& sink);
    void enqueue(std::uint32_t index, std::optional<std::string_view> clip, bool looping, float delay, std::optional<float> mix_seconds, EventSink& sink);
    void clear(std::uint32_t index, EventSink& sink, double offset = 0);
    void clear_all(EventSink& sink);
    void set_time(std::uint32_t index, float time);
    void set_animation_time(float time);
    void set_options(std::uint32_t index, const TrackOptions& options);
    void set_range(std::uint32_t index, std::optional<std::pair<float, float>> range);
    void set_track_end(std::uint32_t index, std::optional<float> time);
    void set_mix_duration(std::uint32_t index, float seconds);
    void set_queued_options(std::uint32_t index, std::size_t queue_index, const QueuedEntryOptions& options);
    void remove_queued(std::uint32_t index, std::size_t queue_index, EventSink& sink);
    void remove_queued_identity(std::uint32_t index, std::uint64_t identity, EventSink& sink);
    [[nodiscard]] TrackEntry& find_entry(std::uint32_t index, std::uint64_t identity, const char* operation);
    [[nodiscard]] std::optional<TrackState> query(std::uint32_t index) const;
    [[nodiscard]] std::vector<QueuedEntryState> queued(std::uint32_t index) const;
    // Mutable only on a detached candidate; the player preflights all events before collecting
    // and commits this state together with pose, Physics and immutable frame publication.
    void update(float delta, EventSink& sink);
    void apply(Pose& pose, PlaybackWorkspace& scratch, const Sampling& sampling = {}) const;
};
}
