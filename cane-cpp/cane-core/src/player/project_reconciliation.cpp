#include "state.hpp"
#include "resource_overlay.hpp"
#include "constraint_parameters.hpp"
#include "runtime_data_internal.hpp"
#include "geometry/modifiers.hpp"

namespace cane::detail {
HostState reconcile_host(const HostState& host, const RuntimeData& previous, const RuntimeData& effective, const char* operation) {
    HostState result(effective); result.root = host.root; result.root_local = host.root_local;
    result.environment = host.environment; result.geometry = host.geometry;
    const auto& old = RuntimeDataAccess::get(previous); const auto& next = RuntimeDataAccess::get(effective);
    const auto lookup = [&](std::size_t catalog, std::size_t index) -> std::optional<std::size_t> {
        const auto found = next.index.catalogs[catalog].find(old.catalogs[catalog].at(index).id);
        return found == next.index.catalogs[catalog].end() ? std::nullopt : std::optional<std::size_t>(found->second);
    };
    result.skins.clear();
    for (const auto skin : host.skins) if (const auto at = lookup(8, skin)) result.skins.push_back(*at);
    for (const auto& bone : host.bones) if (const auto at = lookup(4, bone.first)) result.bones.emplace(*at, bone.second);
    for (const auto& region : host.regions) if (const auto at = lookup(6, region.first))
        if (next.model.attachments[*at].kind == AttachmentKind::region) result.regions.emplace(*at, region.second);
    if (host.order && host.order->size() == next.model.slots.size()) {
        std::vector<std::size_t> order;
        for (const auto slot : *host.order) { const auto at = lookup(5, slot); if (!at) break; order.push_back(*at); }
        if (order.size() == host.order->size()) result.order = std::move(order);
    }
    for (const auto& attachment : host.attachments) if (const auto slot = lookup(5, attachment.first)) {
        if (!attachment.second) { result.attachments.emplace(*slot, std::nullopt); continue; }
        const auto at = next.index.catalogs[6].find(*attachment.second);
        if (at != next.index.catalogs[6].end() && next.model.attachments[at->second].slot == *slot) result.attachments.emplace(*slot, attachment.second);
    }
    for (const auto& tint : host.tints) if (const auto slot = lookup(5, tint.first)) result.tints.emplace(*slot, tint.second);
    for (const auto& deform : host.deforms) {
        const auto at = lookup(6, deform.first); if (!at) continue;
        const auto& before = old.model.attachments[deform.first]; const auto& after = next.model.attachments[*at];
        if (before.kind != after.kind || after.kind == AttachmentKind::region || after.kind == AttachmentKind::point || after.deform_owner != *at) continue;
        const auto& from = old.model.attachments[before.geometry_owner].geometry;
        const auto& to = next.model.attachments[after.geometry_owner].geometry;
        if (from.positions.size() != to.positions.size() || from.influence_starts != to.influence_starts || from.influences.size() != to.influences.size() || deform.second.size() != to.deform_components()) continue;
        bool compatible = true;
        for (std::size_t i = 0; i < from.influences.size(); ++i)
            if (old.bones[from.influences[i].bone].id != next.bones[to.influences[i].bone].id) { compatible = false; break; }
        if (compatible) result.deforms.emplace(*at, deform.second);
    }
    for (const auto& constraint : host.constraints) if (const auto at = lookup(7, constraint.first)) {
        const auto& definition = next.model.constraints[*at];
        if (public_constraint_kind(definition.kind) != override_kind(constraint.second)) continue;
        auto checked = definition.setup;
        try { apply_constraint_override(checked, constraint.second, operation); }
        catch (const Error& e) { if (e.code == ErrorCode::invalid_argument) continue; throw; }
        result.constraints.emplace(*at, constraint.second);
    }
    return result;
}
}

namespace cane {
RuntimeFrame RuntimePlayer::replace_project(RuntimeData replacement) {
    return replace_project(std::move(replacement), {});
}
RuntimeFrame RuntimePlayer::replace_project(RuntimeData replacement, const RuntimeProjectValidation& validation) {
    constexpr auto op = "replaceProject";
    return detail::operation(op, [&] {
        auto& p = impl(); const auto sequence = p.next_sequence(op);
        auto effective = detail::compose_resources(replacement, *p.state->resources, op);
        auto state = std::make_unique<detail::PlayerState>(*p.state);
        state->live = state->live.reconcile(effective); state->baseline = state->baseline.reconcile(effective);
        state->host = detail::reconcile_host(state->host, p.data(), effective, op);
        state->physics = state->physics.reconcile(p.data(), effective);
        geometry::validate_modifiers(effective, state->host.geometry, op);
        RuntimePlayer candidate(std::make_unique<detail::RuntimePlayerImpl>(std::move(effective), std::move(replacement), std::move(state)));
        constraints::PhysicsBudget budget;
        {
            detail::PlayerCallbackGuard guard(p);
            auto& next = candidate.impl();
            next.publish(*next.state, next.evaluate(*next.state, budget, {}, nullptr, op, nullptr, sequence), sequence);
            if (validation) {
                detail::PlayerCallbackGuard candidate_guard(next);
                try { validation(candidate); }
                catch (const Error&) { throw; }
                catch (const std::bad_alloc&) { throw; }
                catch (const std::exception& e) { throw Error(ErrorCode::internal, op, std::string("Project validation callback failed: ") + e.what()); }
                catch (...) { throw Error(ErrorCode::internal, op, "Project validation callback failed."); }
            }
        }
        // Owned pending events describe earlier occurrences and survive successful replacement.
        impl_.swap(candidate.impl_); return impl().frame();
    });
}
RuntimeFrame RuntimePlayer::reconcile_project(RuntimeData replacement) { return replace_project(std::move(replacement)); }
RuntimeFrame RuntimePlayer::reconcile_project(RuntimeData replacement, const RuntimeProjectValidation& validation) {
    return replace_project(std::move(replacement), validation);
}
}
