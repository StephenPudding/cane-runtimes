#include "skeleton.hpp"
#include "geometry_editor.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/classes/viewport.hpp>

namespace cane_godot {
bool CaneSkeleton::replace_project(const godot::Ref<CaneSkeletonData>& data,
    const godot::Dictionary& images, const godot::Dictionary& pages) {
    if (busy_) { set_error(last_error_, cane::Error(cane::ErrorCode::invalid_state, "godotProject", "Reentrant player mutation.")); return false; }
    busy_ = true; GeometryOwnerScope owner_scope(get_instance_id());
    try {
        require(player_ && asset_, "No skeleton data is assigned.", "skeleton_data");
        require(data.is_valid(), "Replacement skeleton data is required.", "data");
        auto source = data->snapshot(); require(static_cast<bool>(source), "Replacement skeleton data has no loaded asset.", "data");
        const auto files = texture_file_overrides(images, pages);
        std::shared_ptr<const LoadedAsset> staged_asset;
        CanvasProjection staged_projection; staged_projection.reuse_shaders(projection_);
        std::vector<cane::SlotState> staged_slots;
        std::unordered_map<std::string, std::size_t> staged_indices;
        std::vector<std::size_t> staged_breaks;
        const auto start = godot::Time::get_singleton()->get_ticks_usec(); std::uint64_t host_time = 0, upload_time = 0;
        const auto frame = player_->replace_project(source->data, [&](const cane::RuntimePlayer& candidate) {
            const auto host_start = godot::Time::get_singleton()->get_ticks_usec();
            if (is_inside_tree()) require(get_viewport()->is_using_hdr_2d(), "Cane requires a linear HDR 2D viewport.", "viewport.use_hdr_2d");
            staged_asset = acquire_overlay(candidate.data(), candidate.query_runtime_resources(), *source, *asset_, files);
            // Empty or newly introduced Slots also affect scene insertion. Query the
            // candidate's complete authoritative order without changing the live cache.
            staged_slots = candidate.query_slot_states();
            for (std::size_t i = 0; i < staged_slots.size(); ++i) staged_indices.emplace(staged_slots[i].slot_id, i);
            prepare_slot_breaks(candidate.frame().render_packet(), staged_slots, staged_indices, staged_breaks);
            const auto upload_start = godot::Time::get_singleton()->get_ticks_usec();
            if (is_inside_tree()) staged_projection.publish(get_canvas_item(), candidate.frame().render_packet(), *staged_asset, staged_breaks, false);
            upload_time = godot::Time::get_singleton()->get_ticks_usec() - upload_start;
            host_time = godot::Time::get_singleton()->get_ticks_usec() - host_start;
        });
        core_usec_ = godot::Time::get_singleton()->get_ticks_usec() - start - host_time; upload_usec_ = upload_time;
        asset_ = std::move(staged_asset); source_asset_ = std::move(source); connect_data_resource(data);
        projection_.commit(staged_projection); projected_ = is_inside_tree(); projected_sequence_ = frame.sequence();
        slot_states_ = std::move(staged_slots); slot_indices_ = std::move(staged_indices); slot_breaks_ = std::move(staged_breaks);
        slot_sequence_ = frame.sequence(); slot_cache_valid_ = true;
        last_error_.clear(); notify_events(); busy_ = false; return true;
    } catch (const std::exception& failure) {
        set_error(last_error_, failure); emit_signal("runtime_error", last_error_.duplicate(true)); busy_ = false; return false;
    }
}
}
