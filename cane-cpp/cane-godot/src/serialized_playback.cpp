#include "skeleton.hpp"
#include "script_values.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/callable.hpp>

namespace cane_godot {
void CaneSkeleton::bind_configuration_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_initial_animation", "animation_id"), &CaneSkeleton::set_initial_animation);
    ClassDB::bind_method(D_METHOD("get_initial_animation"), &CaneSkeleton::get_initial_animation);
    ClassDB::bind_method(D_METHOD("set_initial_skins", "skin_ids"), &CaneSkeleton::set_initial_skins);
    ClassDB::bind_method(D_METHOD("get_initial_skins"), &CaneSkeleton::get_initial_skins);
    ClassDB::bind_method(D_METHOD("set_initial_loop", "loop"), &CaneSkeleton::set_initial_loop);
    ClassDB::bind_method(D_METHOD("get_initial_loop"), &CaneSkeleton::get_initial_loop);
    ClassDB::bind_method(D_METHOD("set_playback_speed", "speed"), &CaneSkeleton::set_playback_speed);
    ClassDB::bind_method(D_METHOD("get_playback_speed"), &CaneSkeleton::get_playback_speed);
    ClassDB::bind_method(D_METHOD("set_editor_preview", "enabled"), &CaneSkeleton::set_editor_preview);
    ClassDB::bind_method(D_METHOD("get_editor_preview"), &CaneSkeleton::get_editor_preview);
    ClassDB::bind_method(D_METHOD("_refresh_imported_resource"), &CaneSkeleton::refresh_imported_resource);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::STRING, "initial_animation"), "set_initial_animation", "get_initial_animation");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::PACKED_STRING_ARRAY, "initial_skins"), "set_initial_skins", "get_initial_skins");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "initial_loop"), "set_initial_loop", "get_initial_loop");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::FLOAT, "playback_speed", godot::PROPERTY_HINT_RANGE, "0,10,0.05,or_greater"), "set_playback_speed", "get_playback_speed");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "editor_preview", godot::PROPERTY_HINT_NONE, "", godot::PROPERTY_USAGE_EDITOR), "set_editor_preview", "get_editor_preview");
}
void CaneSkeleton::set_initial_animation(const godot::String& value) {
    if (value == initial_animation_) return;
    if (player_ && !perform([&](cane::RuntimePlayer& player) {
        if (value.is_empty()) { (void)player.reset(); player.set_skins(strings(initial_skins_)); }
        else player.set_animation(0, text(value), initial_loop_);
        initial_animation_ = value;
    }, false)) return;
    initial_animation_ = value;
}
void CaneSkeleton::set_initial_skins(const godot::PackedStringArray& value) {
    if (value == initial_skins_) return;
    if (player_ && !perform([&](cane::RuntimePlayer& player) { player.set_skins(strings(value)); initial_skins_ = value; }, false)) return;
    initial_skins_ = value;
}
void CaneSkeleton::set_initial_loop(bool value) {
    if (value == initial_loop_) return;
    if (player_ && !perform([&](cane::RuntimePlayer& player) {
        if (player.query_track(0)) { cane::TrackOptions options; options.looping = value; player.set_track_options(0, options); }
        initial_loop_ = value;
    }, false)) return;
    initial_loop_ = value;
}
void CaneSkeleton::set_playback_speed(double value) {
    try {
        const auto speed = scalar(value, "playback_speed"); require(speed >= 0, "Playback speed must be nonnegative.", "playback_speed");
        playback_speed_ = speed; last_error_.clear();
    } catch (const std::exception& failure) { set_error(last_error_, failure); emit_signal("runtime_error", last_error_.duplicate(true)); }
}
void CaneSkeleton::connect_data_resource(const godot::Ref<CaneSkeletonData>& data) {
    const godot::Callable callback(this, "_refresh_imported_resource");
    // Godot restores editor-side signal connections when it rebuilds an imported
    // scene. A reference-counted connection accepts that restoration once, without
    // duplicate callbacks; clear every retained registration when changing data.
    while (data_resource_.is_valid() && data_resource_->is_connected("changed", callback)) data_resource_->disconnect("changed", callback);
    data_resource_ = data; resource_refresh_pending_ = false;
    // Legacy load_files users keep their retained snapshots. Imported/serialized scene resources opt into reimport.
    if (data_resource_.is_valid() && data_resource_->is_imported_resource())
        data_resource_->connect("changed", callback, godot::Object::CONNECT_REFERENCE_COUNTED);
}
void CaneSkeleton::refresh_imported_resource() {
    if (busy_) {
        if (!resource_refresh_pending_) { resource_refresh_pending_ = true; call_deferred("_refresh_imported_resource"); }
        return;
    }
    resource_refresh_pending_ = false;
    if (data_resource_.is_null() || data_resource_->snapshot() == source_asset_) return;
    if (player_) (void)replace_project(data_resource_);
    else set_skeleton_data(data_resource_);
}
}
