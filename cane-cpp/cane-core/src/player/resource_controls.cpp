#include "state.hpp"
#include "resource_overlay.hpp"
#include "runtime_data_internal.hpp"
#include "geometry/modifiers.hpp"

namespace cane {
RuntimeResourceSnapshot RuntimePlayer::query_runtime_resources() const {
    return detail::operation("queryRuntimeResources", [&] { return *impl().state->resources; });
}
RuntimeFrame RuntimePlayer::apply_runtime_resources(const RuntimeResourceChanges& changes) {
    return apply_runtime_resources(changes, {});
}
RuntimeFrame RuntimePlayer::apply_runtime_resources(const RuntimeResourceChanges& changes, const RuntimeResourceValidation& validation) {
    constexpr auto op = "applyRuntimeResources";
    return detail::operation(op, [&] {
        auto& p = impl(); p.require_idle(op);
        return replace_resources(detail::stage_resources(*p.state->resources, changes, op), op, validation);
    });
}
RuntimeFrame RuntimePlayer::clear_runtime_resources() {
    return clear_runtime_resources({});
}
RuntimeFrame RuntimePlayer::clear_runtime_resources(const RuntimeResourceValidation& validation) {
    return detail::operation("clearRuntimeResources", [&] { return replace_resources({}, "clearRuntimeResources", validation); });
}
RuntimeFrame RuntimePlayer::replace_resources(RuntimeResourceSnapshot overlay, const char* op, const RuntimeResourceValidation& validation) {
    auto& p = impl(); const auto sequence = p.next_sequence(op);
    auto effective = detail::compose_resources(p.source_data(), overlay, op);
    auto state = std::make_unique<detail::PlayerState>(*p.state);
    state->live = state->live.rebind(effective, op); state->baseline = state->baseline.rebind(effective, op);
    state->host = detail::reconcile_host(state->host, p.data(), effective, op); state->resources = std::make_shared<const RuntimeResourceSnapshot>(std::move(overlay));
    geometry::validate_modifiers(effective, state->host.geometry, op);
    auto candidate = std::make_unique<detail::RuntimePlayerImpl>(std::move(effective), p.source_data(), std::move(state));
    constraints::PhysicsBudget budget;
    {
        detail::PlayerCallbackGuard guard(p);
        candidate->publish(*candidate->state, candidate->evaluate(*candidate->state, budget, {}, nullptr, op, nullptr, sequence), sequence);
        if (validation) {
            try { validation(candidate->data(), candidate->frame(), *candidate->state->resources); }
            catch (const Error&) { throw; }
            catch (const std::bad_alloc&) { throw; }
            catch (const std::exception& e) { throw Error(ErrorCode::internal, op, std::string("Resource validation callback failed: ") + e.what()); }
            catch (...) { throw Error(ErrorCode::internal, op, "Resource validation callback failed."); }
        }
    }
    impl_.swap(candidate); return impl().frame();
}
}
