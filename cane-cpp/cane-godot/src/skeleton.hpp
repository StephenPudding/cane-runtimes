#pragma once
#include "canvas_projection.hpp"
#include <cane/runtime_player.hpp>
#include <godot_cpp/classes/node2d.hpp>
#include <functional>
#include <vector>
#include <unordered_map>

namespace cane_godot {
class CaneBounds;
class CaneRuntimeSkin;
class CaneSkeleton : public godot::Node2D {
    friend class CaneFollower2D;
    GDCLASS(CaneSkeleton, godot::Node2D)
    godot::Ref<CaneSkeletonData> data_resource_;
    std::shared_ptr<const LoadedAsset> asset_;
    std::shared_ptr<const LoadedAsset> source_asset_;
    std::unique_ptr<cane::RuntimePlayer> player_;
    CanvasProjection projection_;
    godot::Dictionary last_error_;
    godot::Array replay_events_;
    bool automatic_ = true, busy_ = false;
    std::uint64_t blocked_deletions_ = 0;
    bool projected_ = false;
    bool notified_ = false;
    std::uint64_t notified_sequence_ = 0;
    std::uint64_t projected_sequence_ = 0;
    std::uint64_t core_usec_ = 0, upload_usec_ = 0;
    std::vector<std::uint64_t> pose_followers_;
    bool syncing_followers_ = false, follow_source_available_ = false;
    std::vector<cane::SlotState> slot_states_;
    std::unordered_map<std::string, std::size_t> slot_indices_;
    std::vector<std::size_t> slot_breaks_;
    std::uint64_t slot_sequence_ = 0;
    bool slot_cache_valid_ = false, syncing_slots_ = false, slots_arranged_ = false;
    void detach_slot_nodes();
    void refresh_slot_cache();
    const std::vector<std::size_t>& prepare_slot_breaks(const cane::RenderPacket& packet);
    void prepare_slot_breaks(const cane::RenderPacket& packet, const std::vector<cane::SlotState>& states,
        const std::unordered_map<std::string, std::size_t>& indices, std::vector<std::size_t>& output) const;
    void sync_pose_followers();
    bool perform(const std::function<void(cane::RuntimePlayer&)>& operation, bool apply);
    bool query_player(const std::function<void(const cane::RuntimePlayer&)>& query);
    static void bind_playback_methods();
    static void bind_host_methods();
    static void bind_constraint_methods();
    static void bind_vertex_methods();
    static void bind_bounds_methods();
    static void bind_modifier_methods();
    static void bind_geometry_methods();
    static void bind_sdk_methods();
    void publish();
    void notify_events();
    void notify_frame(bool sync_followers = true);
    bool change_resources(const std::function<void(cane::RuntimePlayer&, const cane::RuntimeResourceValidation&)>& operation,
        const godot::Dictionary& image_files, const godot::Dictionary& atlas_page_files);
protected:
    static void _bind_methods();
    void _notification(int what);
public:
    CaneSkeleton();
    ~CaneSkeleton() override;
    void _process(double delta) override;
    void set_skeleton_data(const godot::Ref<CaneSkeletonData>& data);
    bool replace_project(const godot::Ref<CaneSkeletonData>& data, const godot::Dictionary& image_files = {}, const godot::Dictionary& atlas_page_files = {});
    godot::Ref<CaneSkeletonData> get_skeleton_data() const { return data_resource_; }
    void set_automatic(bool value) { automatic_ = value; set_process(value); }
    bool is_automatic() const { return automatic_; }
    bool play(const godot::String& animation_id, bool looping = true, std::int64_t track = 0, double mix_seconds = -1);
    bool queue(const godot::String& animation_id, double delay_seconds = 0, bool looping = false, std::int64_t track = 0, double mix_seconds = -1);
    bool play_empty(double mix_seconds, std::int64_t track = 0);
    bool queue_empty(double mix_seconds, double delay_seconds = 0, std::int64_t track = 0);
    bool set_default_mix(double seconds);
    bool set_mix(const godot::String& from_animation_id, const godot::String& to_animation_id, double seconds);
    bool set_track_time(std::int64_t track, double seconds);
    bool set_animation_time(double seconds);
    bool set_track_options(std::int64_t track, const godot::Dictionary& options);
    bool set_track_animation_range(std::int64_t track, const godot::Variant& range = {});
    bool set_track_end(std::int64_t track, const godot::Variant& seconds = {});
    bool set_track_mix_duration(std::int64_t track, double seconds);
    bool set_queued_entry_options(std::int64_t track, std::int64_t queue_index, const godot::Dictionary& options);
    bool remove_queued_entry(std::int64_t track, std::int64_t queue_index);
    bool clear_tracks();
    godot::Dictionary get_track_state(std::int64_t track = 0);
    godot::Array get_queued_entries(std::int64_t track = 0);
    std::int64_t get_track_count();
    double get_default_mix();
    bool set_bone_local_override(const godot::String& bone_id, const godot::Dictionary& local, const godot::Variant& transform_mode = {});
    bool clear_bone_local_override(const godot::String& bone_id);
    bool set_region_pose_override(const godot::String& attachment_id, const godot::Dictionary& local);
    bool clear_region_pose_override(const godot::String& attachment_id);
    bool set_pose_overrides(const godot::Array& operations);
    bool set_root_pose(const godot::Dictionary& local, const godot::String& physics_motion = "move", const godot::Variant& constraint_id = {});
    bool set_physics_environment(const godot::Dictionary& environment);
    bool reset_physics(const godot::Variant& constraint_id = {});
    bool advance_physics(double delta_seconds);
    godot::Dictionary get_root_pose();
    godot::Dictionary get_bone_pose(const godot::String& bone_id);
    godot::Dictionary get_region_pose(const godot::String& attachment_id);
    bool set_constraint_override(const godot::String& constraint_id, const godot::String& kind, const godot::Dictionary& parameters);
    bool clear_constraint_override(const godot::String& constraint_id);
    godot::PackedStringArray get_constraint_ids();
    godot::Dictionary get_constraint_state(const godot::String& constraint_id);
    godot::Dictionary get_matched_transform_constraint_offsets(const godot::String& constraint_id);
    godot::Dictionary get_path_constraint_position(const godot::String& constraint_id);
    godot::Variant get_path_constraint_position_for_world_target(const godot::String& constraint_id, const godot::Vector2& core_target_world);
    bool advance(double delta_seconds);
    bool update(double delta_seconds);
    bool apply_with_sampling(const godot::Dictionary& sampling);
    bool advance_with_sampling(double delta_seconds, const godot::Dictionary& sampling);
    bool sample_at_with_sampling(double seconds, double fixed_step_seconds, const godot::Dictionary& sampling);
    bool set_authoring_overrides(const godot::Array& operations, const godot::Dictionary& sampling = {});
    bool set_slot_tint(const godot::String& slot_id, const godot::Dictionary& tint);
    bool clear_slot_tint(const godot::String& slot_id);
    bool install_skin(const godot::Ref<CaneRuntimeSkin>& skin);
    godot::Dictionary get_slot_state(const godot::String& slot_id);
    godot::Array get_slot_states();
    godot::Variant get_sequence_index(const godot::String& attachment_id);
    godot::Dictionary get_authoring_snapshot();
    CaneSkeleton* clone_configuration();
    bool apply_with_modifiers(const godot::Array& operations, const godot::Dictionary& sampling = {});
    bool advance_with_modifiers(double delta_seconds, const godot::Array& operations, const godot::Dictionary& sampling = {});
    bool set_geometry_modifiers(const godot::Array& operations);
    bool clear_geometry_modifiers();
    godot::Array get_geometry_modifiers();
    godot::Dictionary get_geometry_modifier_stats();
    bool apply_with_geometry_modifiers(const godot::Array& operations, const godot::Dictionary& sampling = {});
    bool advance_with_geometry_modifiers(double delta_seconds, const godot::Array& operations, const godot::Dictionary& sampling = {});
    bool apply_with_frame_modifiers(const godot::Array& pose_operations, const godot::Array& geometry_operations, const godot::Dictionary& sampling = {});
    bool advance_with_frame_modifiers(double delta_seconds, const godot::Array& pose_operations, const godot::Array& geometry_operations, const godot::Dictionary& sampling = {});
    bool write_bounds(const godot::Ref<CaneBounds>& output, const godot::Dictionary& options = {});
    godot::Dictionary get_attachment_geometry(const godot::String& attachment_id);
    godot::Dictionary get_vertex_source_geometry(const godot::String& attachment_id, const godot::String& deform_space = "vertex_positions");
    godot::Dictionary get_vertex_deform_for_world_target(const godot::String& attachment_id, const godot::Variant& source_vertex_index,
        const godot::Vector2& core_target_world, const godot::String& deform_space = "vertex_positions", const godot::Variant& current_values = {});
    godot::Variant get_vertex_weight_local_positions_for_world_target(const godot::String& attachment_id, const godot::Variant& source_vertex_index, const godot::Vector2& core_target_world);
    godot::Variant get_vertex_weighted_offsets_after_position_edit(const godot::String& attachment_id, const godot::Variant& current_offsets,
        const godot::Variant& before_positions, const godot::Variant& after_positions);
    godot::Variant get_translated_weighted_mesh_deform(const godot::String& attachment_id, const godot::String& deform_space, const godot::Vector2& core_world_delta);
    bool set_vertex_deform_override(const godot::String& attachment_id, const godot::String& deform_space, const godot::Variant& values);
    bool clear_vertex_deform_override(const godot::String& attachment_id);
    bool apply();
    bool refresh_render();
    bool sample_at(double seconds, double fixed_step_seconds = 1.0 / 60.0);
    godot::Array get_replay_events() const { return replay_events_.duplicate(true); }
    bool set_skins(const godot::PackedStringArray& skin_ids);
    bool set_attachment(const godot::String& slot_id, const godot::Variant& attachment_id);
    bool clear_attachment(const godot::String& slot_id);
    bool clear_track(std::int64_t track = 0);
    bool reset();
    bool set_draw_order(const godot::PackedStringArray& slot_ids);
    bool clear_draw_order();
    bool apply_runtime_resources(const godot::Array& changes, const godot::Dictionary& image_files = {}, const godot::Dictionary& atlas_page_files = {});
    bool clear_runtime_resources();
    godot::Dictionary get_runtime_resources() const;
    godot::Array get_texture_resources() const;
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
    godot::Dictionary get_frame_info() const;
    godot::Dictionary get_render_stats() const;
    godot::Array get_packet_snapshot() const;
    godot::Transform2D get_bone_transform(const godot::String& bone_id);
    godot::Dictionary get_point_pose(const godot::String& attachment_id);
    godot::PackedStringArray get_point_attachment_ids() const;
    // Native game code can use the complete public Core without a second evaluator.
    cane::RuntimePlayer* native_player() noexcept { return player_.get(); }
    std::uint64_t blocked_deletions() const noexcept { return blocked_deletions_; }
    bool bone_follow_source_available() const noexcept { return follow_source_available_; }
    bool follow_source_available() const noexcept { return follow_source_available_; }
    void register_pose_follower(std::uint64_t id);
    void unregister_pose_follower(std::uint64_t id);
    void register_bone_follower(std::uint64_t id) { register_pose_follower(id); }
    void unregister_bone_follower(std::uint64_t id) { unregister_pose_follower(id); }
    void sync_slot_nodes();
};
}
