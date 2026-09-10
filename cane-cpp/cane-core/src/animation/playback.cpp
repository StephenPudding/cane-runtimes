#include "playback.hpp"
#include "runtime_data_internal.hpp"
#include <limits>

namespace cane::animation {
namespace {
void index_valid(std::uint32_t index, const char* op) {
    if (index > 4095) throw Error(ErrorCode::invalid_argument, op, "Track index must be in 0..4095.", "trackIndex");
}
void finite(float value, const char* op, const char* field) {
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, op, "Playback scalar must be finite.", field);
}
void nonnegative(float value, const char* op, const char* field) {
    finite(value, op, field);
    if (value < 0) throw Error(ErrorCode::invalid_argument, op, "Playback scalar must be non-negative.", field);
}
void unit(const std::optional<float>& value, const char* op, const char* field) {
    if (!value) return;
    finite(*value, op, field);
    if (*value < 0 || *value > 1) throw Error(ErrorCode::invalid_argument, op, "Playback weight must be in 0..1.", field);
}
float progress(const Track& track, std::size_t at) {
    const auto& e = track.chain[at];
    return at == 0 || e.mix_duration == 0 ? 1 : std::clamp(e.mix_time / e.mix_duration, 0.0f, 1.0f);
}
}
float TrackEntry::pose_time() const noexcept {
    const float d = duration(); if (d == 0) return start;
    float value = looping ? std::fmod(time, d) : std::clamp(time, 0.0f, d);
    if (value < 0) value += d;
    return start + value;
}
float Playback::time() const noexcept {
    const auto found = tracks_.find(0); return found == tracks_.end() ? detached_time_ : found->second.chain.back().pose_time();
}
Playback Playback::clone_configuration() const {
    Playback result(data_); result.default_mix_ = default_mix_; result.mixes_ = mixes_; return result;
}
Playback Playback::rebind(RuntimeData data, const char* operation) const {
    auto result = *this; result.data_ = std::move(data);
    const auto bind = [&](TrackEntry& entry) {
        if (!entry.clip) return;
        entry.clip = result.resolve(entry.clip->id, operation);
        if (entry.start < 0 || entry.end < entry.start || entry.end > entry.clip->duration)
            throw Error(ErrorCode::invalid_argument, operation, "Active or queued animation range no longer fits the clip.", "animationRange", entry.clip->id);
    };
    for (auto& track : result.tracks_) {
        for (auto& entry : track.second.chain) bind(entry);
        for (auto& entry : track.second.queue) bind(entry);
    }
    for (const auto& pair : result.mixes_) { (void)result.resolve(pair.first.first, operation); (void)result.resolve(pair.first.second, operation); }
    return result;
}
void Playback::set_detached_time(float time) { nonnegative(time, "setAnimationTime", "timeSeconds"); detached_time_ = time; }
Playback Playback::reconcile(RuntimeData data) const {
    auto result = *this; result.data_ = std::move(data);
    const auto& next = detail::RuntimeDataAccess::get(result.data_);
    const auto bind = [&](TrackEntry& entry) {
        if (!entry.clip) return true;
        const auto at = next.index.catalogs[10].find(entry.clip->id);
        if (at == next.index.catalogs[10].end()) return false;
        const bool full_range = entry.start == 0 && entry.end == entry.clip->duration;
        entry.clip = &next.clips[at->second];
        if (full_range) { entry.start = 0; entry.end = entry.clip->duration; }
        else { entry.start = std::min(entry.start, entry.clip->duration); entry.end = std::min(entry.end, entry.clip->duration); }
        // Absolute elapsed time, event identity/cursor and mix progress remain unchanged.
        return true;
    };
    for (auto track = result.tracks_.begin(); track != result.tracks_.end();) {
        auto& chain = track->second.chain; std::size_t drop = 0;
        for (std::size_t i = 0; i < chain.size(); ++i) if (!bind(chain[i])) drop = i + 1;
        if (drop == chain.size()) { track = result.tracks_.erase(track); continue; }
        chain.erase(chain.begin(), chain.begin() + static_cast<std::ptrdiff_t>(drop));
        auto& queue = track->second.queue;
        queue.erase(std::remove_if(queue.begin(), queue.end(), [&](auto& e) { return !bind(e); }), queue.end());
        ++track;
    }
    for (auto pair = result.mixes_.begin(); pair != result.mixes_.end();) {
        if (!next.index.catalogs[10].count(pair->first.first) || !next.index.catalogs[10].count(pair->first.second)) pair = result.mixes_.erase(pair);
        else ++pair;
    }
    return result;
}
const Clip* Playback::resolve(std::optional<std::string_view> id, const char* operation) const {
    if (!id) return nullptr;
    const auto& state = detail::RuntimeDataAccess::get(data_); const auto found = state.index.catalogs[10].find(std::string(*id));
    if (found == state.index.catalogs[10].end()) throw Error(ErrorCode::not_found, operation, "Animation does not exist.", "animationId", std::string(*id));
    return &state.clips[found->second];
}
Track& Playback::require_track(std::uint32_t index, const char* operation) {
    index_valid(index, operation); const auto found = tracks_.find(index);
    if (found == tracks_.end()) throw Error(ErrorCode::not_found, operation, "Current track entry does not exist.", "trackIndex");
    return found->second;
}
TrackEntry Playback::make_entry(const Clip* clip, bool looping, float mix, const char* operation) {
    if (next_identity_ == std::numeric_limits<std::uint64_t>::max()) throw Error(ErrorCode::resource_limit, operation, "Playback entry identities are exhausted.", "trackIndex");
    TrackEntry e; e.clip = clip; e.end = clip ? clip->duration : 0; e.looping = looping;
    e.mix_duration = mix; e.identity = next_identity_++; return e;
}
float Playback::mix(const TrackEntry& from, const Clip* to) const {
    if (!from.clip || !to) return default_mix_;
    const auto found = mixes_.find({from.clip->id, to->id}); return found == mixes_.end() ? default_mix_ : found->second;
}
void Playback::set_default_mix(float seconds) { nonnegative(seconds, "setDefaultMix", "durationSeconds"); default_mix_ = seconds; }
void Playback::set_mix(std::string_view from, std::string_view to, float seconds) {
    nonnegative(seconds, "setMix", "durationSeconds"); (void)resolve(from, "setMix"); (void)resolve(to, "setMix");
    mixes_[{std::string(from), std::string(to)}] = seconds;
}
void Playback::retire(const Track& track, std::size_t count, std::uint32_t index, double offset, EventSink& sink) {
    if (count == 0) return;
    const auto block_order = track.chain[count - 1].identity;
    for (std::size_t at = count; at-- > 0;) {
        const auto view = track.chain[at].event_view();
        sink.lifecycle(EventKind::end, index, view, offset, block_order);
        sink.lifecycle(EventKind::dispose, index, view, offset, block_order);
    }
}
void Playback::replace(std::uint32_t index, std::optional<std::string_view> id, bool looping, std::optional<float> seconds, EventSink& sink) {
    const auto* op = sink.operation().c_str(); index_valid(index, op); if (seconds) nonnegative(*seconds, op, "mixSeconds");
    const auto* clip = resolve(id, op); const auto found = tracks_.find(index);
    const float duration = found == tracks_.end() ? 0 : seconds.value_or(mix(found->second.chain.back(), clip));
    auto next = make_entry(clip, looping, duration, op);
    if (found != tracks_.end()) {
        auto& old = found->second; sink.lifecycle(EventKind::interrupt, index, old.chain.back().event_view(), 0);
        if (duration == 0) retire(old, old.chain.size(), index, 0, sink);
        for (const auto& queued : old.queue) sink.lifecycle(EventKind::dispose, index, queued.event_view(), 0);
        if (duration == 0) old.chain.clear();
        old.queue.clear(); old.chain.push_back(std::move(next));
    } else { Track track; track.chain.push_back(std::move(next)); tracks_.emplace(index, std::move(track)); }
    allocated_tracks_ = std::max(allocated_tracks_, index + 1);
    sink.lifecycle(EventKind::start, index, tracks_.at(index).chain.back().event_view(), 0);
}
void Playback::enqueue(std::uint32_t index, std::optional<std::string_view> id, bool looping, float delay,
                        std::optional<float> seconds, EventSink& sink) {
    const auto* op = sink.operation().c_str(); index_valid(index, op); finite(delay, op, "delaySeconds");
    if (seconds) nonnegative(*seconds, op, "mixSeconds");
    const auto* clip = resolve(id, op);
    const auto found = tracks_.find(index);
    if (found == tracks_.end()) { replace(index, id, looping, 0.0f, sink); return; }
    auto& track = found->second; const auto& previous = track.queue.empty() ? track.chain.back() : track.queue.back();
    const float duration = seconds.value_or(mix(previous, clip));
    const float threshold = delay > 0 ? delay : std::max(0.0f, previous.duration() - duration + delay);
    finite(threshold, op, "delaySeconds"); auto e = make_entry(clip, looping, duration, op); e.delay = threshold;
    track.queue.push_back(std::move(e));
}
void Playback::clear(std::uint32_t index, EventSink& sink, double offset) {
    index_valid(index, sink.operation().c_str()); const auto found = tracks_.find(index); if (found == tracks_.end()) return;
    const auto& track = found->second; retire(track, track.chain.size(), index, offset, sink);
    for (const auto& queued : track.queue) sink.lifecycle(EventKind::dispose, index, queued.event_view(), offset);
    tracks_.erase(found);
}
void Playback::clear_all(EventSink& sink) { while (!tracks_.empty()) clear(tracks_.begin()->first, sink); }
void Playback::set_time(std::uint32_t index, float value) {
    nonnegative(value, "setTrackTime", "timeSeconds"); auto& e = require_track(index, "setTrackTime").chain.back(); e.time = value; e.cursor_initialized = true;
}
void Playback::set_animation_time(float value) {
    nonnegative(value, "setAnimationTime", "timeSeconds"); detached_time_ = value;
    const auto found = tracks_.find(0); if (found == tracks_.end()) return;
    auto& e = found->second.chain.back(); e.time = std::clamp(value, e.start, e.end) - e.start; e.cursor_initialized = true;
}
void Playback::set_options(std::uint32_t index, const TrackOptions& o) {
    constexpr auto* op = "setTrackOptions"; index_valid(index, op);
    unit(o.alpha, op, "alpha"); unit(o.event_threshold, op, "eventThreshold"); unit(o.attachment_threshold, op, "attachmentThreshold"); unit(o.draw_order_threshold, op, "drawOrderThreshold");
    if (o.time_scale) finite(*o.time_scale, op, "timeScale");
    if (o.blend && *o.blend != TrackBlend::replace && *o.blend != TrackBlend::additive) throw Error(ErrorCode::invalid_argument, op, "Unknown track blend.", "blend");
    auto& e = require_track(index, op).chain.back();
    if (o.alpha) e.alpha = *o.alpha;
    if (o.time_scale) e.rate = *o.time_scale;
    if (o.event_threshold) e.event_threshold = *o.event_threshold;
    if (o.attachment_threshold) e.attachment_threshold = *o.attachment_threshold;
    if (o.draw_order_threshold) e.draw_order_threshold = *o.draw_order_threshold;
    if (o.looping) e.looping = *o.looping;
    if (o.hold_previous) e.hold = *o.hold_previous;
    if (o.blend) e.additive = *o.blend == TrackBlend::additive;
}
void Playback::set_range(std::uint32_t index, std::optional<std::pair<float, float>> range) {
    constexpr auto* op = "setTrackAnimationRange"; auto& e = require_track(index, op).chain.back();
    const float start = range ? range->first : 0, end = range ? range->second : e.clip ? e.clip->duration : 0;
    nonnegative(start, op, "start"); nonnegative(end, op, "end");
    if (start > end || end > (e.clip ? e.clip->duration : 0)) throw Error(ErrorCode::invalid_argument, op, "Invalid animation range.", "range");
    e.start = start; e.end = end;
}
void Playback::set_track_end(std::uint32_t index, std::optional<float> value) {
    if (value) nonnegative(*value, "setTrackEnd", "trackEnd");
    require_track(index, "setTrackEnd").chain.back().track_end = value;
}
void Playback::set_mix_duration(std::uint32_t index, float value) {
    nonnegative(value, "setTrackMixDuration", "mixDuration"); require_track(index, "setTrackMixDuration").chain.back().mix_duration = value;
}
void Playback::set_queued_options(std::uint32_t index, std::size_t queue_index, const QueuedEntryOptions& options) {
    constexpr auto* op = "setQueuedEntryOptions";
    if (!options.delay_seconds && !options.mix_duration_seconds && !options.looping) throw Error(ErrorCode::invalid_argument, op, "At least one queued option is required.", "options");
    if (options.delay_seconds) nonnegative(*options.delay_seconds, op, "delaySeconds");
    if (options.mix_duration_seconds) nonnegative(*options.mix_duration_seconds, op, "mixDurationSeconds");
    auto& queue = require_track(index, op).queue;
    if (queue_index >= queue.size()) throw Error(ErrorCode::not_found, op, "Queued entry does not exist.", "queueIndex");
    auto& e = queue[queue_index]; if (options.delay_seconds) e.delay = *options.delay_seconds;
    if (options.mix_duration_seconds) e.mix_duration = *options.mix_duration_seconds;
    if (options.looping) e.looping = *options.looping;
}
void Playback::remove_queued(std::uint32_t index, std::size_t queue_index, EventSink& sink) {
    auto& queue = require_track(index, sink.operation().c_str()).queue;
    if (queue_index >= queue.size()) throw Error(ErrorCode::not_found, sink.operation(), "Queued entry does not exist.", "queueIndex");
    sink.lifecycle(EventKind::dispose, index, queue[queue_index].event_view(), 0);
    queue.erase(queue.begin() + static_cast<std::ptrdiff_t>(queue_index));
}
void Playback::remove_queued_identity(std::uint32_t index, std::uint64_t identity, EventSink& sink) {
    const auto& queue = require_track(index, sink.operation().c_str()).queue;
    for (std::size_t i = 0; i < queue.size(); ++i) if (queue[i].identity == identity) { remove_queued(index, i, sink); return; }
    throw Error(ErrorCode::invalid_state, sink.operation(), "Entry is not queued in this configuration baseline.", "queueIndex");
}
TrackEntry& Playback::find_entry(std::uint32_t index, std::uint64_t identity, const char* op) {
    auto& t = require_track(index, op);
    for (auto& e : t.chain) if (e.identity == identity) return e;
    for (auto& e : t.queue) if (e.identity == identity) return e;
    throw Error(ErrorCode::invalid_state, op, "Entry identity is absent from this configuration baseline.", "trackIndex");
}
std::optional<TrackState> Playback::query(std::uint32_t index) const {
    index_valid(index, "queryTrackState"); const auto found = tracks_.find(index); if (found == tracks_.end()) return {};
    const auto& track = found->second; const auto& e = track.chain.back(); TrackState state;
    state.track_index = index; if (e.clip) state.animation_id = e.clip->id;
    state.track_time = e.time; state.animation_time = e.pose_time(); state.animation_start = e.start; state.animation_end = e.end;
    state.delay_seconds = e.delay; state.track_end = e.track_end; state.alpha = e.alpha; state.time_scale = e.rate;
    state.looping = e.looping; state.hold_previous = e.hold; state.blend = e.additive ? TrackBlend::additive : TrackBlend::replace;
    state.mix_time = e.mix_time; state.mix_duration = e.mix_duration; state.mix_progress = progress(track, track.chain.size() - 1);
    state.event_threshold = e.event_threshold; state.attachment_threshold = e.attachment_threshold; state.draw_order_threshold = e.draw_order_threshold;
    state.queued_entry_count = track.queue.size(); return state;
}
std::vector<QueuedEntryState> Playback::queued(std::uint32_t index) const {
    index_valid(index, "queryQueuedEntries"); std::vector<QueuedEntryState> values;
    const auto found = tracks_.find(index); if (found == tracks_.end()) return values;
    values.reserve(found->second.queue.size());
    for (const auto& e : found->second.queue) values.push_back({index, values.size(), e.clip ? std::optional<std::string>(e.clip->id) : std::nullopt, e.delay, e.mix_duration, e.looping});
    return values;
}
}
