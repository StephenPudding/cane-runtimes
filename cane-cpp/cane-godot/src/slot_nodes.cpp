#include "skeleton.hpp"
#include "slot.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/object.hpp>
#include <algorithm>

namespace cane_godot {
void CaneSkeleton::detach_slot_nodes() {
    for (int i = 0; i < get_child_count(true); ++i)
        if (auto* slot = godot::Object::cast_to<CaneSlot2D>(get_child(i, true))) slot->detach_projection();
}
void CaneSkeleton::refresh_slot_cache() {
    if (!player_ || (slot_cache_valid_ && slot_sequence_ == player_->frame().sequence())) return;
    auto states = player_->query_slot_states(); std::unordered_map<std::string, std::size_t> indices;
    for (std::size_t i = 0; i < states.size(); ++i) indices.emplace(states[i].slot_id, i);
    slot_states_ = std::move(states); slot_indices_ = std::move(indices);
    slot_sequence_ = player_->frame().sequence(); slot_cache_valid_ = true;
}
const std::vector<std::size_t>& CaneSkeleton::prepare_slot_breaks(const cane::RenderPacket& packet) {
    slot_breaks_.clear();
    if (!player_) return slot_breaks_;
    bool has_slots = false;
    for (int i = 0; i < get_child_count(true); ++i)
        if (auto* slot = godot::Object::cast_to<CaneSlot2D>(get_child(i, true)); slot && slot->is_follow_enabled()) { has_slots = true; break; }
    if (!has_slots) return slot_breaks_;
    refresh_slot_cache();
    prepare_slot_breaks(packet, slot_states_, slot_indices_, slot_breaks_);
    return slot_breaks_;
}
void CaneSkeleton::prepare_slot_breaks(const cane::RenderPacket& packet, const std::vector<cane::SlotState>& states,
    const std::unordered_map<std::string, std::size_t>& indices, std::vector<std::size_t>& output) const {
    output.clear();
    std::vector<CaneSlot2D*> children;
    for (int i = 0; i < get_child_count(true); ++i)
        if (auto* slot = godot::Object::cast_to<CaneSlot2D>(get_child(i, true)); slot && slot->is_follow_enabled()) children.push_back(slot);
    if (children.empty()) return;
    // Attachment packets omit empty/clipped Slots. Cut positions come from Core's
    // complete sampled order, so content in those gaps still separates batches.
    std::vector<std::uint64_t> cuts; cuts.reserve(children.size());
    for (const auto* slot : children) {
        const auto found = indices.find(slot->native_slot_id());
        if (found != indices.end()) cuts.push_back(static_cast<std::uint64_t>(states[found->second].draw_index) * 2 + (slot->is_draw_before() ? 0 : 2));
    }
    if (cuts.empty()) return;
    std::sort(cuts.begin(), cuts.end());
    std::uint64_t previous = 0;
    const auto& attachments = packet.attachments();
    for (std::size_t i = 0; i < attachments.size(); ++i) {
        const auto found = indices.find(attachments[i].slot_id);
        require(found != indices.end(), "Packet Slot is absent from Core's complete order.", "slot_id");
        const auto order = static_cast<std::uint64_t>(states[found->second].draw_index) * 2 + 1;
        const auto cut = std::upper_bound(cuts.begin(), cuts.end(), previous);
        if (i != 0 && cut != cuts.end() && *cut <= order) output.push_back(i);
        previous = order;
    }
}
void CaneSkeleton::sync_slot_nodes() {
    if (syncing_slots_ || !is_inside_tree()) return;
    syncing_slots_ = true;
    struct BusyGuard {
        bool& flag; bool previous;
        explicit BusyGuard(bool& value) : flag(value), previous(value) { flag = true; }
        ~BusyGuard() { flag = previous; }
    } guard(busy_);
    try {
        std::vector<std::uint64_t> children;
        for (int i = 0; i < get_child_count(true); ++i)
            if (auto* slot = godot::Object::cast_to<CaneSlot2D>(get_child(i, true))) children.push_back(slot->get_instance_id());
        // Instances without Slot nodes retain the original render-only cost.
        if (children.empty() && !slots_arranged_ && projection_.layout_matches({})) { syncing_slots_ = false; return; }
        std::vector<SlotMount> mounts;
        if (player_ && projected_) {
            const auto frame = player_->frame();
            const auto& breaks = prepare_slot_breaks(frame.render_packet());
            if (!projection_.layout_matches(breaks)) {
                // Scene insertion only repacks the already-published final geometry.
                // Count this work separately; Core clocks, events and frames do not advance.
                projection_.publish(get_canvas_item(), frame.render_packet(), *asset_, breaks, true, false);
            }
        }
        if (!children.empty()) refresh_slot_cache();
        for (const auto id : children) {
            auto* slot = godot::Object::cast_to<CaneSlot2D>(godot::ObjectDB::get_instance(id));
            if (!slot || slot->get_parent() != this || !slot->is_inside_tree()) continue;
            const auto found = slot_indices_.find(slot->native_slot_id());
            const auto* state = player_ && found != slot_indices_.end() ? &slot_states_[found->second] : nullptr;
            slot->project(*this, state);
            if (slot->is_resolved() && slot->is_inside_tree() && slot->get_parent() == this && slot->native_anchor().is_valid())
                mounts.push_back({slot->native_anchor(), state->draw_index, slot->is_draw_before(), slot->get_index(true)});
        }
        const bool arranged = !mounts.empty();
        if (arranged || slots_arranged_) projection_.arrange_slots(slot_states_, std::move(mounts));
        slots_arranged_ = arranged;
    } catch (const std::exception& failure) { last_error_ = error(failure); }
    syncing_slots_ = false;
}
}
