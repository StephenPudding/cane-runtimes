#pragma once
#include "events.hpp"
#include "playback.hpp"
#include "runtime_data.hpp"
#include "runtime_frame.hpp"
#include "pose_queries.hpp"
#include "constraint_state.hpp"
#include "vertex_geometry.hpp"
#include "pose_modifiers.hpp"
#include "bounds.hpp"
#include "runtime_resources.hpp"
#include "authoring_overrides.hpp"
#include "authoring_snapshot.hpp"

namespace cane {
namespace detail { class RuntimePlayerImpl; }
struct SamplingOptions {
    std::optional<float> frame_step_seconds;
    bool stepped = false;
};
struct RuntimeStep {
    std::uint64_t frame_sequence = 0;
    float time_seconds = 0;
    bool changed = false;
    EventBatch events;
};
struct PhysicsEnvironment {
    float wind_x = 1, wind_y = 0, gravity_x = 0, gravity_y = 1;
};
enum class PhysicsHostMotion { move, teleport, preserve_inertia, clear_inertia };

class RuntimePlayer;
// Synchronous preparation over the evaluated, read-only candidate. Throw to reject.
// Both candidate and source reject mutation; owned query results may be retained.
using RuntimeProjectValidation = std::function<void(const RuntimePlayer&)>;

// Single-owner mutable instance over shared immutable data. Fallible calls throw cane::Error
// and commit clocks, history, notifications and publication together. Distinct instances may
// run independently; concurrent access to the same player requires host synchronization.
class RuntimePlayer {
    std::unique_ptr<detail::RuntimePlayerImpl> impl_;
    explicit RuntimePlayer(std::unique_ptr<detail::RuntimePlayerImpl> impl);
    [[nodiscard]] detail::RuntimePlayerImpl& impl() const;
    [[nodiscard]] RuntimeFrame apply_frame_modifiers(const PoseModifiers*, const GeometryModifiers*, const SamplingOptions&, const char*);
    [[nodiscard]] RuntimeStep advance_frame_modifiers(float, const PoseModifiers*, const GeometryModifiers*, const SamplingOptions&, const char*);
    [[nodiscard]] RuntimeFrame replace_resources(RuntimeResourceSnapshot, const char*, const RuntimeResourceValidation&);
    [[nodiscard]] RuntimeFrame apply_authoring(const AuthoringOverrides&, const SamplingOptions&, const char*);
public:
    // Construction evaluates setup pose, constraints and packet before returning an instance.
    explicit RuntimePlayer(RuntimeData data);
    ~RuntimePlayer();
    RuntimePlayer(RuntimePlayer&&);
    RuntimePlayer& operator=(RuntimePlayer&&);
    RuntimePlayer(const RuntimePlayer&) = delete;
    RuntimePlayer& operator=(const RuntimePlayer&) = delete;
    [[nodiscard]] const RuntimeData& data() const;
    [[nodiscard]] const RuntimeData& source_data() const;
    // Rebind compatible live state and resources; failures retain the old project and frame.
    [[nodiscard]] RuntimeFrame replace_project(RuntimeData replacement);
    [[nodiscard]] RuntimeFrame replace_project(RuntimeData replacement, const RuntimeProjectValidation& validation);
    [[nodiscard]] RuntimeFrame reconcile_project(RuntimeData replacement);
    [[nodiscard]] RuntimeFrame reconcile_project(RuntimeData replacement, const RuntimeProjectValidation& validation);
    [[nodiscard]] RuntimeFrame frame() const;
    [[nodiscard]] RuntimeStep update(float delta_seconds);
    [[nodiscard]] RuntimeFrame apply(const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep advance(float delta_seconds, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep advance_physics(float delta_seconds);
    [[nodiscard]] RuntimeStep sample_at(float time_seconds, float fixed_step_seconds, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep seek(float time_seconds, float fixed_step_seconds, const SamplingOptions& sampling = {});
    [[nodiscard]] EventBatch drain_events();
    [[nodiscard]] RuntimeFrame reset();
    [[nodiscard]] RuntimeFrame apply_with_modifiers(const PoseModifiers& modifiers, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep advance_with_modifiers(float delta_seconds, const PoseModifiers& modifiers, const SamplingOptions& sampling = {});
    [[nodiscard]] EvaluationStats last_evaluation_stats() const;
    void set_geometry_modifiers(const GeometryModifiers& modifiers);
    void clear_geometry_modifiers();
    [[nodiscard]] GeometryModifiers query_geometry_modifiers() const;
    [[nodiscard]] GeometryModifierStats last_geometry_modifier_stats() const;
    [[nodiscard]] RuntimeFrame apply_with_geometry_modifiers(const GeometryModifiers& modifiers, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep advance_with_geometry_modifiers(float delta_seconds, const GeometryModifiers& modifiers, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeFrame apply_with_frame_modifiers(const PoseModifiers& pose_modifiers, const GeometryModifiers& geometry_modifiers, const SamplingOptions& sampling = {});
    [[nodiscard]] RuntimeStep advance_with_frame_modifiers(float delta_seconds, const PoseModifiers& pose_modifiers, const GeometryModifiers& geometry_modifiers, const SamplingOptions& sampling = {});
    void write_bounds(RuntimeBounds& output, const BoundsOptions& options = {}) const;
    [[nodiscard]] BoundsSnapshot query_bounds(const BoundsOptions& options = {}) const;
    [[nodiscard]] RuntimePlayer clone_configuration() const;
    [[nodiscard]] RuntimeResourceSnapshot query_runtime_resources() const;
    [[nodiscard]] RuntimeFrame apply_runtime_resources(const RuntimeResourceChanges& changes);
    [[nodiscard]] RuntimeFrame apply_runtime_resources(const RuntimeResourceChanges& changes, const RuntimeResourceValidation& validation);
    [[nodiscard]] RuntimeFrame clear_runtime_resources();
    [[nodiscard]] RuntimeFrame clear_runtime_resources(const RuntimeResourceValidation& validation);
    [[nodiscard]] RuntimeFrame set_authoring_overrides(const AuthoringOverrides& request);
    [[nodiscard]] RuntimeFrame set_authoring_overrides_with_sampling(const AuthoringOverrides& request, const SamplingOptions& sampling);
    [[nodiscard]] AuthoringSnapshot query_authoring_snapshot() const;

    void set_default_mix(float duration_seconds);
    void set_mix(std::string_view from_animation_id, std::string_view to_animation_id, float duration_seconds);
    void set_animation(std::uint32_t track, std::string_view animation_id, bool looping = false, std::optional<float> mix_seconds = {});
    void queue_animation(std::uint32_t track, std::string_view animation_id, bool looping, float delay_seconds, std::optional<float> mix_seconds = {});
    void set_empty_animation(std::uint32_t track, float mix_seconds);
    void queue_empty_animation(std::uint32_t track, float mix_seconds, float delay_seconds);
    void clear_track(std::uint32_t track);
    void clear_tracks();
    void set_track_time(std::uint32_t track, float time_seconds);
    void set_animation_time(float time_seconds);
    void set_track_options(std::uint32_t track, const TrackOptions& options);
    void set_track_animation_range(std::uint32_t track, std::optional<std::pair<float, float>> range);
    void set_track_end(std::uint32_t track, std::optional<float> time_seconds);
    void set_track_mix_duration(std::uint32_t track, float duration_seconds);
    void set_queued_entry_options(std::uint32_t track, std::size_t queue_index, const QueuedEntryOptions& options);
    void remove_queued_entry(std::uint32_t track, std::size_t queue_index);
    [[nodiscard]] std::optional<TrackState> query_track(std::uint32_t track) const;
    [[nodiscard]] std::vector<QueuedEntryState> query_queued_entries(std::uint32_t track) const;
    [[nodiscard]] std::uint32_t track_count() const;
    [[nodiscard]] float default_mix() const;
    [[nodiscard]] BonePose query_bone_pose(std::string_view bone_id) const;
    [[nodiscard]] bool query_bone_active(std::string_view bone_id) const;
    [[nodiscard]] BoneLocal query_bone_local(std::string_view bone_id) const;
    [[nodiscard]] TransformMode query_bone_transform_mode(std::string_view bone_id) const;
    [[nodiscard]] BoneLocalState query_bone_local_state(std::string_view bone_id) const;
    [[nodiscard]] RegionLocal query_region_attachment_pose(std::string_view attachment_id) const;
    [[nodiscard]] std::uint32_t query_sequence_index(std::string_view attachment_id) const;
    [[nodiscard]] SlotState query_slot_state(std::string_view slot_id) const;
    // Owned SDK conveniences over the current publication, including empty Slots.
    [[nodiscard]] std::vector<SlotState> query_slot_states() const;
    [[nodiscard]] BonePose query_slot_bone_pose(std::string_view slot_id) const;
    [[nodiscard]] PointAttachmentPose query_point_attachment_pose(std::string_view attachment_id) const;
    [[nodiscard]] AttachmentGeometry query_attachment_geometry(std::string_view attachment_id) const;
    [[nodiscard]] VertexAttachmentSourceGeometry query_vertex_attachment_source_geometry(std::string_view attachment_id,
        VertexDeformSpace space = VertexDeformSpace::vertex_positions) const;
    [[nodiscard]] VertexDeform vertex_attachment_deform_for_world_target(const VertexWorldTarget& request) const;
    [[nodiscard]] std::vector<Point> vertex_attachment_weight_local_positions_for_world_target(std::string_view attachment_id,
        std::uint32_t source_vertex_index, Point target_world) const;
    [[nodiscard]] std::vector<float> vertex_attachment_weighted_deform_offsets_after_position_edit(std::string_view attachment_id,
        const std::vector<float>& current_weighted_offsets, const std::vector<float>& before_positions, const std::vector<float>& after_positions) const;
    [[nodiscard]] std::vector<float> translate_weighted_mesh_deform(std::string_view attachment_id, VertexDeformSpace space, Point world_delta) const;
    void set_vertex_deform_override(std::string_view attachment_id, VertexDeformSpace space, const std::vector<float>& values);
    void clear_vertex_deform_override(std::string_view attachment_id);
    [[nodiscard]] ConstraintState query_constraint_state(std::string_view constraint_id) const;
    [[nodiscard]] TransformConstraintOffsets query_matched_transform_constraint_offsets(std::string_view constraint_id) const;
    [[nodiscard]] PathConstraintPosition query_path_constraint_position(std::string_view constraint_id) const;
    [[nodiscard]] float query_path_constraint_position_for_world_target(std::string_view constraint_id, Point target_world) const;
    void set_constraint_override(std::string_view constraint_id, const ConstraintOverride& parameters);
    void clear_constraint_override(std::string_view constraint_id);

    void set_skins(const std::vector<std::string>& skin_ids);
    void set_root_transform(const RegionLocal& transform, PhysicsHostMotion motion = PhysicsHostMotion::move,
                            std::optional<std::string_view> physics_constraint_id = {});
    [[nodiscard]] RegionLocal root_transform() const;
    void set_physics_environment(const PhysicsEnvironment& environment);
    void reset_physics();
    [[nodiscard]] bool reset_physics_constraint(std::string_view constraint_id);
    void set_bone_local_override(std::string_view bone_id, const BoneOverride& value);
    void clear_bone_local_override(std::string_view bone_id);
    void set_region_pose_override(std::string_view attachment_id, const RegionLocal& value);
    void clear_region_pose_override(std::string_view attachment_id);
    void set_draw_order_override(const std::vector<std::string>& slot_ids);
    void clear_draw_order_override();
    // null hides the slot; clearing restores the authored/animated attachment selection.
    void set_slot_attachment_override(std::string_view slot_id, std::optional<std::string_view> attachment_id);
    void clear_slot_attachment_override(std::string_view slot_id);
    void set_slot_tint_override(std::string_view slot_id, const FinalTint& tint);
    void clear_slot_tint_override(std::string_view slot_id);
};
}
