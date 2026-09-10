#include "state.hpp"

namespace cane::detail {
void RuntimePlayerImpl::configure(const char* op, const Mutation& mutation, bool publish_frame) {
    operation(op, [&] {
        require_idle(op);
        std::size_t event_count;
        {
            auto dry = *state; animation::EventSink count(data(), op), baseline_count(data(), op);
            mutation(dry, count, baseline_count); event_count = count.count();
        }
        auto candidate = std::make_unique<PlayerState>(*state);
        animation::EventSink collect(data(), op, true, event_count), baseline_count(data(), op);
        mutation(*candidate, collect, baseline_count); const auto events = collect.finish();
        if (publish_frame) {
            constraints::PhysicsBudget budget;
            publish(*candidate, evaluate(*candidate, budget, {}), next_sequence(op));
        }
        candidate->pending = EventBatchAccess::append(candidate->pending, events);
        state.swap(candidate);
    });
}
RuntimeStep RuntimePlayerImpl::step(float delta, bool apply, const SamplingOptions& options, const char* op, const PoseModifiers* modifiers, const GeometryModifiers* geometry) {
    return operation(op, [&] {
        require_idle(op);
        require_nonnegative(delta, op, "deltaSeconds"); const auto sampling = checked_sampling(options, op);
        std::size_t event_count;
        { auto dry = state->live; animation::EventSink count(data(), op); dry.update(delta, count); event_count = count.count(); }
        auto candidate = std::make_unique<PlayerState>(*state);
        animation::EventSink collect(data(), op, true, event_count); candidate->live.update(delta, collect);
        const auto events = collect.finish();
        if (apply) {
            constraints::PhysicsBudget budget;
            publish(*candidate, evaluate(*candidate, budget, sampling, modifiers, op, geometry), next_sequence(op));
        }
        candidate->pending = EventBatchAccess::append(candidate->pending, events);
        RuntimeStep result{candidate->frame->sequence(), candidate->frame->time_seconds(), delta != 0 || event_count != 0, events};
        state.swap(candidate); return result;
    });
}
RuntimeStep RuntimePlayerImpl::sample(float time, float fixed_step, const SamplingOptions& options, const char* op) {
    return operation(op, [&] {
        require_idle(op);
        require_nonnegative(time, op, "timeSeconds"); require_finite(fixed_step, op, "fixedStepSeconds");
        if (fixed_step <= 0) throw Error(ErrorCode::invalid_argument, op, "Replay step must be positive.", "fixedStepSeconds");
        const auto sampling = checked_sampling(options, op);
        const double step_count = std::ceil(static_cast<double>(time) / fixed_step);
        if (step_count > 1000000) throw Error(ErrorCode::resource_limit, op, "Replay requires more than 1,000,000 samples.", "timeSeconds");
        const auto steps = static_cast<std::size_t>(step_count);
        const auto delta = [&](std::size_t i) {
            // Resolve representable endpoints from binary64 products before subtraction.
            // Repeatedly adding the nominal float step can pass the requested endpoint and
            // select the next representable authored key, even though the time error is tiny.
            const float previous = static_cast<float>(static_cast<double>(i) * fixed_step);
            const float current = i + 1 == steps ? time : static_cast<float>(std::min(static_cast<double>(i + 1) * fixed_step, static_cast<double>(time)));
            return static_cast<float>(static_cast<double>(current) - previous);
        };
        // Count the complete replay before materializing notifications. Per-step counts also
        // let each collected interval retain its own event ordering at shared step boundaries.
        std::vector<std::size_t> counts; counts.reserve(steps); std::size_t event_count;
        {
            auto dry = state->baseline; animation::EventSink count(data(), op);
            for (std::size_t i = 0; i < steps; ++i) {
                const auto before = count.count(); dry.update(delta(i), count); counts.push_back(count.count() - before);
            }
            event_count = count.count();
        }
        auto candidate = std::make_unique<PlayerState>(*state); candidate->live = candidate->baseline;
        (void)candidate->physics.reset(); constraints::PhysicsBudget budget;
        auto evaluated = evaluate(*candidate, budget, sampling);
        auto stats = evaluated.stats;
        std::vector<RuntimeEvent> events; events.reserve(event_count);
        for (std::size_t i = 0; i < steps; ++i) {
            animation::EventSink collect(data(), op, true, counts[i]); candidate->live.update(delta(i), collect);
            const auto part = collect.finish(); events.insert(events.end(), part.events().begin(), part.events().end());
            evaluated = evaluate(*candidate, budget, sampling);
            stats.animation_samples += evaluated.stats.animation_samples;
            stats.constraint_geometry_solves += evaluated.stats.constraint_geometry_solves;
        }
        evaluated.stats = stats;
        publish(*candidate, std::move(evaluated), next_sequence(op));
        RuntimeStep result{candidate->frame->sequence(), candidate->frame->time_seconds(), steps != 0, EventBatchAccess::own(std::move(events))};
        // Absolute replay neither appends to nor drains the incremental notification queue.
        state.swap(candidate); return result;
    });
}
}
namespace cane {
RuntimePlayer::RuntimePlayer(RuntimeData data)
    : impl_(detail::operation("create", [&] { return std::make_unique<detail::RuntimePlayerImpl>(std::move(data)); })) {}
RuntimePlayer::RuntimePlayer(std::unique_ptr<detail::RuntimePlayerImpl> impl) : impl_(std::move(impl)) {}
RuntimePlayer::~RuntimePlayer() = default;
RuntimePlayer::RuntimePlayer(RuntimePlayer&& source) {
    if (source.impl_) source.impl_->require_idle("movePlayer");
    impl_ = std::move(source.impl_);
}
RuntimePlayer& RuntimePlayer::operator=(RuntimePlayer&& source) {
    if (impl_) impl_->require_idle("movePlayer");
    if (source.impl_) source.impl_->require_idle("movePlayer");
    if (this != &source) impl_ = std::move(source.impl_);
    return *this;
}
detail::RuntimePlayerImpl& RuntimePlayer::impl() const {
    if (!impl_) throw Error(ErrorCode::invalid_state, "player", "Player ownership has been moved.");
    return *impl_;
}
const RuntimeData& RuntimePlayer::data() const { return impl().data(); }
const RuntimeData& RuntimePlayer::source_data() const { return impl().source_data(); }
RuntimeFrame RuntimePlayer::frame() const { return impl().frame(); }
EvaluationStats RuntimePlayer::last_evaluation_stats() const { return impl().frame().evaluation_stats(); }
RuntimeStep RuntimePlayer::update(float delta) { return impl().step(delta, false, {}, "update"); }
RuntimeStep RuntimePlayer::advance(float delta, const SamplingOptions& sampling) { return impl().step(delta, true, sampling, "advance"); }
RuntimeStep RuntimePlayer::sample_at(float time, float fixed_step, const SamplingOptions& sampling) { return impl().sample(time, fixed_step, sampling, "sampleAt"); }
RuntimeStep RuntimePlayer::seek(float time, float fixed_step, const SamplingOptions& sampling) { return impl().sample(time, fixed_step, sampling, "seek"); }
RuntimeFrame RuntimePlayer::apply(const SamplingOptions& options) {
    return detail::operation("apply", [&] {
        auto& p = impl(); p.require_idle("apply"); const auto sampling = detail::checked_sampling(options, "apply");
        auto candidate = std::make_unique<detail::PlayerState>(*p.state); constraints::PhysicsBudget budget;
        p.publish(*candidate, p.evaluate(*candidate, budget, sampling), p.next_sequence("apply"));
        p.state.swap(candidate); return p.frame();
    });
}
EventBatch RuntimePlayer::drain_events() {
    return detail::operation("drainEvents", [&] {
        auto& p = impl(); p.require_idle("drainEvents"); auto& pending = p.state->pending; const auto result = pending; EventBatch empty;
        pending = std::move(empty); return result;
    });
}
RuntimeFrame RuntimePlayer::reset() {
    return detail::operation("reset", [&] {
        auto& p = impl(); const auto sequence = p.next_sequence("reset");
        auto candidate = std::make_unique<detail::PlayerState>(p.data()); constraints::PhysicsBudget budget;
        candidate->resources = p.state->resources;
        p.publish(*candidate, p.evaluate(*candidate, budget, {}, nullptr, "reset", nullptr, sequence), sequence);
        p.state.swap(candidate); return p.frame();
    });
}
RuntimePlayer RuntimePlayer::clone_configuration() const {
    return detail::operation("cloneConfiguration", [&] {
        auto& p = impl(); p.require_idle("cloneConfiguration");
        auto configuration = std::make_unique<detail::PlayerState>(p.data());
        configuration->host = p.state->host; configuration->resources = p.state->resources;
        configuration->live = p.state->live.clone_configuration(); configuration->baseline = configuration->live;
        auto candidate = std::make_unique<detail::RuntimePlayerImpl>(p.data(), p.source_data(), std::move(configuration));
        constraints::PhysicsBudget budget;
        { detail::PlayerCallbackGuard guard(p); candidate->publish(*candidate->state, candidate->evaluate(*candidate->state, budget, {}, nullptr, "cloneConfiguration"), 1); }
        return RuntimePlayer(std::move(candidate));
    });
}
}
