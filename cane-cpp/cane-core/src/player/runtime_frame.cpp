#include "state.hpp"
#include "runtime_data_internal.hpp"

namespace cane::detail {
RuntimeFrameState::RuntimeFrameState(Evaluation result, std::uint64_t seq, const std::vector<std::size_t>& skins)
    : evaluated(std::move(result)), sequence(seq) {
    const auto& pose = evaluated.pose; const auto& data = pose.data(); bones.reserve(data.bones().size());
    for (std::size_t i = 0; i < data.bones().size(); ++i)
        bones.push_back({data.bones()[i].id, pose.world[i], pose.locals[i], pose.modes[i], pose.active_bones[i]});
    const auto& catalog = data.catalog(RuntimeCatalogKind::skin);
    for (const auto skin : skins) configured_skins.push_back(catalog[skin].id);
    for (const auto skin : pose.skins) sampled_skins.push_back(catalog[skin].id);
}
EventBatch EventBatchAccess::append(const EventBatch& previous, const EventBatch& next) {
    if (next.events().empty()) return previous;
    if (previous.events().empty()) return next;
    auto values = previous.events();
    values.insert(values.end(), next.events().begin(), next.events().end());
    return own(std::move(values));
}
}
namespace cane {
std::uint64_t RuntimeFrame::sequence() const noexcept { return state_->sequence; }
float RuntimeFrame::time_seconds() const noexcept { return state_->evaluated.time; }
const std::vector<BonePose>& RuntimeFrame::bones() const noexcept { return state_->bones; }
const BonePose& RuntimeFrame::bone(std::string_view id) const {
    const auto& data = detail::RuntimeDataAccess::get(state_->evaluated.pose.data());
    const auto& catalog = data.index.catalogs[static_cast<std::size_t>(RuntimeCatalogKind::bone)];
    const auto found = catalog.find(std::string(id));
    if (found == catalog.end()) throw Error(ErrorCode::not_found, "queryBonePose", "Bone does not exist.", "boneId", std::string(id));
    return state_->bones[found->second];
}
const std::vector<std::string>& RuntimeFrame::configured_skin_ids() const noexcept { return state_->configured_skins; }
const std::vector<std::string>& RuntimeFrame::sampled_skin_ids() const noexcept { return state_->sampled_skins; }
const RenderPacket& RuntimeFrame::render_packet() const noexcept { return state_->evaluated.packet; }
EvaluationStats RuntimeFrame::evaluation_stats() const noexcept { return state_->evaluated.stats; }
GeometryModifierStats RuntimeFrame::geometry_modifier_stats() const noexcept { return state_->evaluated.geometry_stats; }
}
