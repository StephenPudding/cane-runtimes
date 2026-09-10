#include "state.hpp"

namespace cane {
namespace {
using detail::PlayerState;
using animation::EventSink;
using animation::Playback;
using animation::TrackEntry;
using ClockMutation = std::function<void(Playback&, EventSink&)>;
void clocks(detail::RuntimePlayerImpl& p, const char* op, const ClockMutation& mutate, bool publish = true) {
    p.configure(op, [&](PlayerState& s, EventSink& live, EventSink& baseline) { mutate(s.live, live); mutate(s.baseline, baseline); }, publish);
}
const TrackEntry& current(const Playback& state, std::uint32_t index, const char* op) {
    (void)state.query(index); const auto at = state.tracks().find(index);
    if (at == state.tracks().end()) throw Error(ErrorCode::not_found, op, "Current entry does not exist.", "trackIndex");
    return at->second.chain.back();
}
void current_edit(detail::RuntimePlayerImpl& p, const char* op, std::uint32_t index,
                  const std::function<void(Playback&)>& edit, const std::function<void(TrackEntry&, const TrackEntry&)>& project) {
    p.configure(op, [&](PlayerState& s, EventSink&, EventSink&) {
        edit(s.live); const auto& e = current(s.live, index, op);
        project(s.baseline.find_entry(index, e.identity, op), e);
    });
}
}
RuntimeStep RuntimePlayer::advance_physics(float delta_seconds) {
    constexpr auto op = "advancePhysics";
    return detail::operation(op, [&] {
        auto& p = impl(); const auto sequence = p.next_sequence(op); detail::require_nonnegative(delta_seconds, op, "deltaSeconds");
        auto candidate = std::make_unique<PlayerState>(*p.state); constraints::PhysicsBudget budget;
        p.publish(*candidate, p.evaluate(*candidate, budget, {}, nullptr, op, nullptr, sequence, delta_seconds), sequence);
        RuntimeStep result{sequence, candidate->frame->time_seconds(), delta_seconds > 0, {}};
        p.state.swap(candidate); return result;
    });
}
void RuntimePlayer::set_default_mix(float seconds) { clocks(impl(), "setDefaultMix", [&](Playback& p, EventSink&) { p.set_default_mix(seconds); }, false); }
void RuntimePlayer::set_mix(std::string_view from, std::string_view to, float seconds) { clocks(impl(), "setMix", [&](Playback& p, EventSink&) { p.set_mix(from, to, seconds); }, false); }
void RuntimePlayer::set_animation(std::uint32_t track, std::string_view id, bool looping, std::optional<float> mix) {
    clocks(impl(), "setAnimation", [&](Playback& p, EventSink& sink) { p.replace(track, id, looping, mix, sink); });
}
void RuntimePlayer::queue_animation(std::uint32_t track, std::string_view id, bool looping, float delay, std::optional<float> mix) {
    clocks(impl(), "queueAnimation", [&](Playback& p, EventSink& sink) { p.enqueue(track, id, looping, delay, mix, sink); });
}
void RuntimePlayer::set_empty_animation(std::uint32_t track, float mix) { clocks(impl(), "setEmptyAnimation", [&](Playback& p, EventSink& sink) { p.replace(track, {}, false, mix, sink); }); }
void RuntimePlayer::queue_empty_animation(std::uint32_t track, float mix, float delay) { clocks(impl(), "queueEmptyAnimation", [&](Playback& p, EventSink& sink) { p.enqueue(track, {}, false, delay, mix, sink); }); }
void RuntimePlayer::clear_track(std::uint32_t track) { clocks(impl(), "clearTrack", [&](Playback& p, EventSink& sink) { p.clear(track, sink); }); }
void RuntimePlayer::clear_tracks() { clocks(impl(), "clearTracks", [](Playback& p, EventSink& sink) { p.clear_all(sink); }); }
void RuntimePlayer::set_track_time(std::uint32_t track, float time) {
    current_edit(impl(), "setTrackTime", track, [&](Playback& p) { p.set_time(track, time); },
                 [](TrackEntry& baseline, const TrackEntry& live) { baseline.time = live.time; baseline.cursor_initialized = live.cursor_initialized; });
}
void RuntimePlayer::set_animation_time(float time) {
    impl().configure("setAnimationTime", [&](PlayerState& s, EventSink&, EventSink&) {
        s.live.set_animation_time(time); s.baseline.set_detached_time(time);
        if (!s.live.query(0)) return;
        const auto& e = current(s.live, 0, "setAnimationTime"); auto& b = s.baseline.find_entry(0, e.identity, "setAnimationTime");
        b.time = e.time; b.cursor_initialized = true;
    });
}
void RuntimePlayer::set_track_options(std::uint32_t track, const TrackOptions& options) {
    current_edit(impl(), "setTrackOptions", track, [&](Playback& p) { p.set_options(track, options); }, [](TrackEntry& b, const TrackEntry& e) {
        b.alpha = e.alpha; b.rate = e.rate; b.event_threshold = e.event_threshold; b.attachment_threshold = e.attachment_threshold;
        b.draw_order_threshold = e.draw_order_threshold; b.looping = e.looping; b.hold = e.hold; b.additive = e.additive;
    });
}
void RuntimePlayer::set_track_animation_range(std::uint32_t track, std::optional<std::pair<float, float>> range) {
    current_edit(impl(), "setTrackAnimationRange", track, [&](Playback& p) { p.set_range(track, range); }, [](TrackEntry& b, const TrackEntry& e) { b.start = e.start; b.end = e.end; });
}
void RuntimePlayer::set_track_end(std::uint32_t track, std::optional<float> time) {
    current_edit(impl(), "setTrackEnd", track, [&](Playback& p) { p.set_track_end(track, time); }, [](TrackEntry& b, const TrackEntry& e) { b.track_end = e.track_end; });
}
void RuntimePlayer::set_track_mix_duration(std::uint32_t track, float seconds) {
    current_edit(impl(), "setTrackMixDuration", track, [&](Playback& p) { p.set_mix_duration(track, seconds); }, [](TrackEntry& b, const TrackEntry& e) { b.mix_duration = e.mix_duration; });
}
void RuntimePlayer::set_queued_entry_options(std::uint32_t track, std::size_t index, const QueuedEntryOptions& options) {
    impl().configure("setQueuedEntryOptions", [&](PlayerState& s, EventSink&, EventSink&) {
        s.live.set_queued_options(track, index, options); const auto& e = s.live.tracks().at(track).queue.at(index);
        auto& b = s.baseline.find_entry(track, e.identity, "setQueuedEntryOptions"); b.delay = e.delay; b.mix_duration = e.mix_duration; b.looping = e.looping;
    });
}
void RuntimePlayer::remove_queued_entry(std::uint32_t track, std::size_t index) {
    impl().configure("removeQueuedEntry", [&](PlayerState& s, EventSink& live, EventSink& baseline) {
        (void)s.live.query(track); const auto at = s.live.tracks().find(track);
        if (at == s.live.tracks().end() || index >= at->second.queue.size()) throw Error(ErrorCode::not_found, "removeQueuedEntry", "Queued entry does not exist.", "queueIndex");
        const auto identity = at->second.queue[index].identity;
        s.live.remove_queued(track, index, live); s.baseline.remove_queued_identity(track, identity, baseline);
    });
}
std::optional<TrackState> RuntimePlayer::query_track(std::uint32_t track) const { return impl().state->live.query(track); }
std::vector<QueuedEntryState> RuntimePlayer::query_queued_entries(std::uint32_t track) const { return impl().state->live.queued(track); }
std::uint32_t RuntimePlayer::track_count() const { return impl().state->live.allocated_tracks(); }
float RuntimePlayer::default_mix() const { return impl().state->live.default_mix(); }
}
