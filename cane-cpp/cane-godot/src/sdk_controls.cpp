#include "skeleton.hpp"
#include "runtime_skin.hpp"
#include "script_values.hpp"
#include "color_values.hpp"
#include "modifier_values.hpp"
#include "snapshot_values.hpp"
#include "geometry_editor.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
void CaneSkeleton::bind_sdk_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("update", "delta_seconds"), &CaneSkeleton::update);
    ClassDB::bind_method(D_METHOD("apply_with_sampling", "sampling"), &CaneSkeleton::apply_with_sampling);
    ClassDB::bind_method(D_METHOD("advance_with_sampling", "delta_seconds", "sampling"), &CaneSkeleton::advance_with_sampling);
    ClassDB::bind_method(D_METHOD("sample_at_with_sampling", "seconds", "fixed_step_seconds", "sampling"), &CaneSkeleton::sample_at_with_sampling);
    ClassDB::bind_method(D_METHOD("set_authoring_overrides", "operations", "sampling"), &CaneSkeleton::set_authoring_overrides, DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("set_slot_tint", "slot_id", "tint"), &CaneSkeleton::set_slot_tint);
    ClassDB::bind_method(D_METHOD("clear_slot_tint", "slot_id"), &CaneSkeleton::clear_slot_tint);
    ClassDB::bind_method(D_METHOD("install_skin", "skin"), &CaneSkeleton::install_skin);
    ClassDB::bind_method(D_METHOD("get_slot_state", "slot_id"), &CaneSkeleton::get_slot_state);
    ClassDB::bind_method(D_METHOD("get_slot_states"), &CaneSkeleton::get_slot_states);
    ClassDB::bind_method(D_METHOD("get_sequence_index", "attachment_id"), &CaneSkeleton::get_sequence_index);
    ClassDB::bind_method(D_METHOD("get_authoring_snapshot"), &CaneSkeleton::get_authoring_snapshot);
    ClassDB::bind_method(D_METHOD("clone_configuration"), &CaneSkeleton::clone_configuration);
}
bool CaneSkeleton::update(double delta) { return perform([&](cane::RuntimePlayer& p) { (void)p.update(scalar(delta, "delta_seconds")); }, false); }
bool CaneSkeleton::apply_with_sampling(const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.apply(sampling_options(sampling)); }, false);
}
bool CaneSkeleton::advance_with_sampling(double delta, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& p) { (void)p.advance(scalar(delta, "delta_seconds"), sampling_options(sampling)); }, false);
}
bool CaneSkeleton::set_slot_tint(const godot::String& id, const godot::Dictionary& tint) {
    return perform([&](cane::RuntimePlayer& p) { p.set_slot_tint_override(text(id), tint_input(tint)); }, false);
}
bool CaneSkeleton::clear_slot_tint(const godot::String& id) { return perform([&](cane::RuntimePlayer& p) { p.clear_slot_tint_override(text(id)); }, false); }
bool CaneSkeleton::install_skin(const godot::Ref<CaneRuntimeSkin>& skin) {
    return change_resources([&](cane::RuntimePlayer& p, const cane::RuntimeResourceValidation& validation) {
        require(skin.is_valid(), "Skin builder is required.", "skin");
        (void)p.apply_runtime_resources({{skin->native_snapshot()}}, validation);
    }, {}, {});
}
godot::Dictionary CaneSkeleton::get_slot_state(const godot::String& id) {
    godot::Dictionary result; query_player([&](const cane::RuntimePlayer& p) { assign_dictionary(result, slot_snapshot_value(p.query_slot_state(text(id)))); }); return result;
}
godot::Array CaneSkeleton::get_slot_states() {
    godot::Array result; query_player([&](const cane::RuntimePlayer& p) { for (const auto& state : p.query_slot_states()) result.push_back(slot_snapshot_value(state)); }); return result;
}
godot::Variant CaneSkeleton::get_sequence_index(const godot::String& id) {
    godot::Variant result; query_player([&](const cane::RuntimePlayer& p) { result = p.query_sequence_index(text(id)); }); return result;
}
godot::Dictionary CaneSkeleton::get_authoring_snapshot() {
    godot::Dictionary result; query_player([&](const cane::RuntimePlayer& p) { assign_dictionary(result, authoring_snapshot_value(p.query_authoring_snapshot())); }); return result;
}
CaneSkeleton* CaneSkeleton::clone_configuration() {
    if (busy_) { set_error(last_error_, cane::Error(cane::ErrorCode::invalid_state, "cloneConfiguration", "Reentrant player mutation.")); return nullptr; }
    busy_ = true; GeometryOwnerScope owner_scope(get_instance_id()); CaneSkeleton* result = nullptr;
    try {
        require(player_ != nullptr, "No skeleton data is assigned.", "skeleton_data");
        auto player = std::make_unique<cane::RuntimePlayer>(player_->clone_configuration());
        result = memnew(CaneSkeleton); result->set_automatic(automatic_);
        result->asset_ = asset_; result->source_asset_ = source_asset_; result->data_resource_ = data_resource_; result->player_ = std::move(player);
        last_error_.clear(); busy_ = false; return result;
    } catch (const std::exception& failure) {
        if (result) memdelete(result);
        set_error(last_error_, failure); busy_ = false; return nullptr;
    }
}
}
