#include "skeleton.hpp"
#include "script_values.hpp"
#include "modifier_values.hpp"
#include "geometry_editor.hpp"
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <cmath>

namespace cane_godot {
namespace {
godot::Dictionary event_value(const cane::RuntimeEvent& event) {
    godot::Dictionary result;
    const char* kinds[] = {"start", "interrupt", "end", "dispose", "complete", "user"};
    result["kind"] = kinds[static_cast<std::size_t>(event.kind)]; result["track_index"] = event.track_index;
    if (event.animation_id) result["animation_id"] = text(*event.animation_id);
    if (event.timeline_time_seconds) result["timeline_time_seconds"] = *event.timeline_time_seconds;
    if (event.event_id) result["event_id"] = text(*event.event_id);
    if (event.name) result["name"] = text(*event.name);
    if (event.integer_value) result["integer_value"] = *event.integer_value;
    if (event.string_value) result["string_value"] = text(*event.string_value);
    if (event.number_value) result["number_value"] = *event.number_value;
    if (event.audio_id) result["audio_id"] = text(*event.audio_id);
    result["volume"] = event.volume; result["balance"] = event.balance;
    return result;
}
godot::PackedFloat32Array floats(const std::vector<float>& values) {
    godot::PackedFloat32Array output; output.resize(static_cast<std::int64_t>(values.size()));
    auto* destination = output.ptrw(); std::copy(values.begin(), values.end(), destination); return output;
}
}
CaneSkeleton::CaneSkeleton() { set_process(true); set_notify_transform(true); set_notify_local_transform(true); }
CaneSkeleton::~CaneSkeleton() { detach_slot_nodes(); }
void CaneSkeleton::_bind_methods() {
    bind_sdk_methods();
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_skeleton_data", "data"), &CaneSkeleton::set_skeleton_data);
    ClassDB::bind_method(D_METHOD("get_skeleton_data"), &CaneSkeleton::get_skeleton_data);
    ClassDB::bind_method(D_METHOD("replace_project", "data", "image_files", "atlas_page_files"), &CaneSkeleton::replace_project, DEFVAL(godot::Dictionary()), DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("reconcile_project", "data", "image_files", "atlas_page_files"), &CaneSkeleton::replace_project, DEFVAL(godot::Dictionary()), DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("set_automatic", "enabled"), &CaneSkeleton::set_automatic);
    ClassDB::bind_method(D_METHOD("is_automatic"), &CaneSkeleton::is_automatic);
    bind_playback_methods();
    bind_host_methods();
    bind_constraint_methods();
    bind_vertex_methods();
    bind_bounds_methods();
    bind_modifier_methods();
    bind_geometry_methods();
    ClassDB::bind_method(D_METHOD("advance", "delta_seconds"), &CaneSkeleton::advance);
    ClassDB::bind_method(D_METHOD("apply"), &CaneSkeleton::apply);
    ClassDB::bind_method(D_METHOD("refresh_render"), &CaneSkeleton::refresh_render);
    ClassDB::bind_method(D_METHOD("sample_at", "seconds", "fixed_step_seconds"), &CaneSkeleton::sample_at, DEFVAL(1.0 / 60.0));
    ClassDB::bind_method(D_METHOD("get_replay_events"), &CaneSkeleton::get_replay_events);
    ClassDB::bind_method(D_METHOD("set_skins", "skin_ids"), &CaneSkeleton::set_skins);
    ClassDB::bind_method(D_METHOD("set_attachment", "slot_id", "attachment_id"), &CaneSkeleton::set_attachment);
    ClassDB::bind_method(D_METHOD("clear_attachment", "slot_id"), &CaneSkeleton::clear_attachment);
    ClassDB::bind_method(D_METHOD("reset"), &CaneSkeleton::reset);
    ClassDB::bind_method(D_METHOD("set_draw_order", "slot_ids"), &CaneSkeleton::set_draw_order);
    ClassDB::bind_method(D_METHOD("clear_draw_order"), &CaneSkeleton::clear_draw_order);
    ClassDB::bind_method(D_METHOD("apply_runtime_resources", "changes", "image_files", "atlas_page_files"), &CaneSkeleton::apply_runtime_resources, DEFVAL(godot::Dictionary()), DEFVAL(godot::Dictionary()));
    ClassDB::bind_method(D_METHOD("clear_runtime_resources"), &CaneSkeleton::clear_runtime_resources);
    ClassDB::bind_method(D_METHOD("get_runtime_resources"), &CaneSkeleton::get_runtime_resources);
    ClassDB::bind_method(D_METHOD("get_texture_resources"), &CaneSkeleton::get_texture_resources);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneSkeleton::get_last_error);
    ClassDB::bind_method(D_METHOD("get_frame_info"), &CaneSkeleton::get_frame_info);
    ClassDB::bind_method(D_METHOD("get_render_stats"), &CaneSkeleton::get_render_stats);
    ClassDB::bind_method(D_METHOD("get_packet_snapshot"), &CaneSkeleton::get_packet_snapshot);
    ClassDB::bind_method(D_METHOD("get_bone_transform", "bone_id"), &CaneSkeleton::get_bone_transform);
    ClassDB::bind_method(D_METHOD("get_point_pose", "attachment_id"), &CaneSkeleton::get_point_pose);
    ClassDB::bind_method(D_METHOD("get_point_attachment_ids"), &CaneSkeleton::get_point_attachment_ids);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::OBJECT, "skeleton_data", godot::PROPERTY_HINT_RESOURCE_TYPE, "CaneSkeletonData"), "set_skeleton_data", "get_skeleton_data");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "automatic"), "set_automatic", "is_automatic");
    ADD_SIGNAL(godot::MethodInfo("runtime_event", godot::PropertyInfo(godot::Variant::DICTIONARY, "event")));
    ADD_SIGNAL(godot::MethodInfo("runtime_error", godot::PropertyInfo(godot::Variant::DICTIONARY, "details")));
    ADD_SIGNAL(godot::MethodInfo("frame_updated", godot::PropertyInfo(godot::Variant::INT, "sequence")));
}
void CaneSkeleton::_notification(int what) {
    if (what == NOTIFICATION_PREDELETE && busy_) { cancel_free(); ++blocked_deletions_; return; }
    if (what == NOTIFICATION_EXIT_TREE) { follow_source_available_ = false; sync_pose_followers(); sync_slot_nodes(); detach_slot_nodes(); projection_.clear(); projected_ = false; }
    else if (what == NOTIFICATION_ENTER_TREE) {
        follow_source_available_ = true;
        if (player_) try { publish(); sync_pose_followers(); sync_slot_nodes(); } catch (const std::exception& failure) { last_error_ = error(failure); emit_signal("runtime_error", last_error_.duplicate(true)); }
    }
    else if (what == NOTIFICATION_CHILD_ORDER_CHANGED) sync_slot_nodes();
    else if ((what == NOTIFICATION_TRANSFORM_CHANGED || what == NOTIFICATION_LOCAL_TRANSFORM_CHANGED || what == NOTIFICATION_VISIBILITY_CHANGED) && is_inside_tree()) sync_pose_followers();
}
void CaneSkeleton::set_skeleton_data(const godot::Ref<CaneSkeletonData>& data) {
    if (busy_) { last_error_ = error(cane::Error(cane::ErrorCode::invalid_state, "godotAdapter", "Reentrant player mutation.")); return; }
    busy_ = true; GeometryOwnerScope owner_scope(get_instance_id());
    try {
        if (data.is_null()) {
            detach_slot_nodes(); projection_.clear(); projected_ = false; notified_ = false; replay_events_.clear();
            player_.reset(); asset_.reset(); source_asset_.reset(); data_resource_.unref(); slot_cache_valid_ = false; slot_states_.clear(); slot_indices_.clear();
            last_error_.clear(); sync_pose_followers(); sync_slot_nodes(); busy_ = false; return;
        }
        auto asset = data->snapshot(); require(static_cast<bool>(asset), "CaneSkeletonData has no loaded asset.", "skeleton_data");
        auto player = std::make_unique<cane::RuntimePlayer>(asset->data);
        if (is_inside_tree()) require(get_viewport()->is_using_hdr_2d(), "Enable HDR 2D on the viewport for Cane linear color/blend rendering.", "viewport.use_hdr_2d");
        asset_ = std::move(asset); source_asset_ = asset_; player_ = std::move(player); data_resource_ = data;
        projected_ = false; notified_ = false; slot_cache_valid_ = false; replay_events_.clear();
        publish(); last_error_.clear(); notify_frame();
    } catch (const std::exception& failure) { last_error_ = error(failure); emit_signal("runtime_error", last_error_.duplicate(true)); }
    busy_ = false;
}
void CaneSkeleton::publish() {
    upload_usec_ = 0;
    if (!is_inside_tree()) return;
    require(get_viewport()->is_using_hdr_2d(), "Cane requires a linear HDR 2D viewport.", "viewport.use_hdr_2d");
    const auto frame = player_->frame();
    if (projected_ && frame.sequence() == projected_sequence_) return;
    const auto start = godot::Time::get_singleton()->get_ticks_usec();
    projection_.publish(get_canvas_item(), frame.render_packet(), *asset_, prepare_slot_breaks(frame.render_packet()));
    upload_usec_ = godot::Time::get_singleton()->get_ticks_usec() - start;
    projected_sequence_ = frame.sequence(); projected_ = true;
}
void CaneSkeleton::notify_frame(bool sync_followers) {
    if (sync_followers) { sync_pose_followers(); sync_slot_nodes(); }
    const auto sequence = player_->frame().sequence();
    if (notified_ && notified_sequence_ == sequence) return;
    notified_ = true; notified_sequence_ = sequence;
    emit_signal("frame_updated", static_cast<std::int64_t>(sequence));
}
void CaneSkeleton::notify_events() {
    sync_pose_followers();
    sync_slot_nodes();
    const auto batch = player_->drain_events();
    for (const auto& event : batch.events()) emit_signal("runtime_event", event_value(event));
    notify_frame(false);
}
bool CaneSkeleton::perform(const std::function<void(cane::RuntimePlayer&)>& operation, bool evaluate) {
    if (busy_) { last_error_ = error(cane::Error(cane::ErrorCode::invalid_state, "godotAdapter", "Reentrant player mutation.")); return false; }
    busy_ = true; GeometryOwnerScope owner_scope(get_instance_id());
    try {
        require(player_ != nullptr, "No skeleton data is assigned.", "skeleton_data");
        const auto start = godot::Time::get_singleton()->get_ticks_usec();
        operation(*player_); if (evaluate) (void)player_->apply();
        core_usec_ = godot::Time::get_singleton()->get_ticks_usec() - start;
        publish(); last_error_.clear(); notify_events(); busy_ = false; return true;
    } catch (const std::exception& failure) {
        last_error_ = error(failure); emit_signal("runtime_error", last_error_.duplicate(true)); busy_ = false; return false;
    }
}
void CaneSkeleton::_process(double delta) {
    if (automatic_ && player_ && !godot::Engine::get_singleton()->is_editor_hint() && !advance(delta)) set_automatic(false);
}
bool CaneSkeleton::advance(double delta) { return perform([&](cane::RuntimePlayer& player) { (void)player.advance(scalar(delta, "delta_seconds")); }, false); }
bool CaneSkeleton::apply() { return perform([](cane::RuntimePlayer&) {}, true); }
bool CaneSkeleton::refresh_render() { return perform([](cane::RuntimePlayer&) {}, false); }
bool CaneSkeleton::sample_at(double seconds, double step) {
    return sample_at_with_sampling(seconds, step, {});
}
bool CaneSkeleton::sample_at_with_sampling(double seconds, double step, const godot::Dictionary& sampling) {
    return perform([&](cane::RuntimePlayer& player) {
        const auto result = player.sample_at(scalar(seconds, "seconds"), scalar(step, "fixed_step_seconds"), sampling_options(sampling));
        godot::Array events;
        for (const auto& event : result.events.events()) events.push_back(event_value(event));
        replay_events_ = std::move(events);
    }, false);
}
bool CaneSkeleton::set_skins(const godot::PackedStringArray& ids) { return perform([&](cane::RuntimePlayer& player) { player.set_skins(strings(ids)); }, false); }
bool CaneSkeleton::set_attachment(const godot::String& slot, const godot::Variant& id) {
    return perform([&](cane::RuntimePlayer& player) {
        require(id.get_type() == godot::Variant::NIL || id.get_type() == godot::Variant::STRING, "Attachment ID must be a String or null.", "attachment_id");
        const std::string value = id.get_type() == godot::Variant::NIL ? std::string() : text(static_cast<godot::String>(id));
        player.set_slot_attachment_override(text(slot), id.get_type() == godot::Variant::NIL ? std::nullopt : std::optional<std::string_view>(value));
    }, false);
}
bool CaneSkeleton::clear_attachment(const godot::String& slot) { return perform([&](cane::RuntimePlayer& player) { player.clear_slot_attachment_override(text(slot)); }, false); }
bool CaneSkeleton::reset() { return perform([&](cane::RuntimePlayer& player) { (void)player.reset(); replay_events_.clear(); }, false); }
bool CaneSkeleton::set_draw_order(const godot::PackedStringArray& ids) { return perform([&](cane::RuntimePlayer& player) { player.set_draw_order_override(strings(ids)); }, false); }
bool CaneSkeleton::clear_draw_order() { return perform([](cane::RuntimePlayer& player) { player.clear_draw_order_override(); }, false); }
godot::Dictionary CaneSkeleton::get_frame_info() const {
    godot::Dictionary result; if (!player_) return result;
    const auto frame = player_->frame(); const auto stats = frame.evaluation_stats();
    result["sequence"] = static_cast<std::int64_t>(frame.sequence()); result["time_seconds"] = frame.time_seconds();
    result["bone_count"] = static_cast<std::int64_t>(frame.bones().size());
    result["animation_samples"] = static_cast<std::int64_t>(stats.animation_samples);
    result["constraint_geometry_solves"] = static_cast<std::int64_t>(stats.constraint_geometry_solves);
    result["frames_published"] = static_cast<std::int64_t>(stats.frames_published);
    godot::PackedStringArray skins; for (const auto& id : frame.configured_skin_ids()) skins.push_back(text(id)); result["skin_ids"] = skins;
    return result;
}
godot::Dictionary CaneSkeleton::get_render_stats() const {
    const auto stats = projection_.stats(); godot::Dictionary result;
    result["attachments"] = stats.attachments; result["draws"] = stats.draws; result["vertices"] = stats.vertices; result["triangles"] = stats.triangles;
    result["backbuffer_copies"] = stats.backbuffer_copies; result["core_usec"] = static_cast<std::int64_t>(core_usec_); result["upload_usec"] = static_cast<std::int64_t>(upload_usec_);
    result["packet_uploads"] = stats.packet_uploads;
    result["layout_uploads"] = stats.layout_uploads;
    result["geometry_uploads"] = stats.packet_uploads + stats.layout_uploads;
    result["unbatched_draws"] = stats.unbatched_draws;
    result["material_parameter_writes"] = stats.material_parameter_writes; result["material_shader_changes"] = stats.material_shader_changes;
    return result;
}
godot::Array CaneSkeleton::get_packet_snapshot() const {
    godot::Array result; if (!player_) return result;
    const auto frame = player_->frame();
    for (const auto& attachment : frame.render_packet().attachments()) {
        godot::Dictionary value; value["attachment_id"] = text(attachment.attachment_id); value["slot_id"] = text(attachment.slot_id);
        value["draw_index"] = attachment.draw_index; value["source_z_index"] = attachment.source_z_index;
        value["world_vertices_xy"] = floats(attachment.world_vertices_xy); value["uvs"] = floats(attachment.uvs);
        godot::PackedInt32Array indices; for (auto index : attachment.indices) indices.push_back(static_cast<int>(index)); value["indices"] = indices;
        result.push_back(value);
    }
    return result;
}
godot::Transform2D CaneSkeleton::get_bone_transform(const godot::String& bone_id) {
    try {
        require(player_ != nullptr, "No skeleton data is assigned.", "skeleton_data");
        const auto matrix = player_->query_bone_pose(text(bone_id)).matrix; last_error_.clear();
        return {{matrix.a, -matrix.b}, {-matrix.c, matrix.d}, {matrix.tx, -matrix.ty}};
    } catch (const std::exception& failure) { last_error_ = error(failure); return {}; }
}
bool CaneSkeleton::query_player(const std::function<void(const cane::RuntimePlayer&)>& query) {
    try {
        require(player_ != nullptr, "No skeleton data is assigned.", "skeleton_data");
        query(*player_); last_error_.clear(); return true;
    } catch (const std::exception& failure) { last_error_ = error(failure); return false; }
}
godot::Dictionary CaneSkeleton::get_point_pose(const godot::String& id) {
    godot::Dictionary result;
    try {
        require(player_ != nullptr, "No skeleton data is assigned.", "skeleton_data");
        const auto pose = player_->query_point_attachment_pose(text(id)); const auto& m = pose.matrix;
        const godot::Transform2D transform({m.a, -m.b}, {-m.c, m.d}, {m.tx, -m.ty});
        result["attachment_id"] = text(pose.attachment_id); result["slot_id"] = text(pose.slot_id);
        result["transform"] = transform; result["position"] = transform.get_origin();
        result["rotation_degrees"] = -pose.rotation_degrees; result["active"] = pose.active; result["selected"] = pose.selected;
        last_error_.clear();
    } catch (const std::exception& failure) { last_error_ = error(failure); }
    return result;
}
godot::PackedStringArray CaneSkeleton::get_point_attachment_ids() const {
    godot::PackedStringArray result;
    if (player_) for (const auto& item : player_->data().catalog(cane::RuntimeCatalogKind::attachment))
        if (item.type == "point") result.push_back(text(item.id));
    return result;
}
}
