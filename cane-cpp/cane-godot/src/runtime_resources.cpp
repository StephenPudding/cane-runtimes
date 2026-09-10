#include "skeleton.hpp"
#include "data_values.hpp"
#include "geometry_editor.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <set>

namespace cane_godot {
namespace {
std::string string_value(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::STRING, "Resource operation values must be Strings.", field);
    const auto result = text(static_cast<godot::String>(value)); require(!result.empty(), "Resource operation strings must not be empty.", field); return result;
}
void closed(const godot::Dictionary& value, const std::set<std::string>& fields) {
    require(static_cast<std::size_t>(value.size()) == fields.size(), "Resource operation fields differ.", "changes");
    for (const auto& name : fields) require(value.has(text(name)), "Resource operation field is missing.", "changes");
}
cane::RuntimeResourceChanges operations(const godot::Array& input) {
    if (input.size() > 1000000) throw cane::Error(cane::ErrorCode::resource_limit, "godotResources", "Too many resource operations.", "changes");
    cane::RuntimeResourceChanges result;
    for (std::int64_t i = 0; i < input.size(); ++i) {
        require(input[i].get_type() == godot::Variant::DICTIONARY, "Each resource operation must be a Dictionary.", "changes");
        const godot::Dictionary row = input[i]; const auto op = string_value(row.get("operation", {}), "operation");
        if (op == "upsertAtlas") {
            closed(row, {"operation", "reference_json", "atlas_json"});
            result.operations.push_back(cane::RuntimeAtlasResource::from_json(string_value(row["reference_json"], "reference_json"), string_value(row["atlas_json"], "atlas_json")));
        } else if (op == "upsertImage" || op == "upsertAttachment" || op == "upsertSkin") {
            closed(row, {"operation", "json"}); const auto json = string_value(row["json"], "json");
            if (op == "upsertImage") result.operations.push_back(cane::RuntimeImageResource::from_json(json));
            else if (op == "upsertAttachment") result.operations.push_back(cane::RuntimeAttachmentResource::from_json(json));
            else result.operations.push_back(cane::RuntimeSkinResource::from_json(json));
        } else {
            closed(row, {"operation", "id"}); const auto id = string_value(row["id"], "id");
            if (op == "removeImage") result.operations.push_back(cane::RemoveRuntimeImage{id});
            else if (op == "removeAtlas") result.operations.push_back(cane::RemoveRuntimeAtlas{id});
            else if (op == "removeAttachment") result.operations.push_back(cane::RemoveRuntimeAttachment{id});
            else if (op == "removeSkin") result.operations.push_back(cane::RemoveRuntimeSkin{id});
            else require(false, "Unknown resource operation.", "operation");
        }
    }
    return result;
}
}
std::map<std::string, godot::String> texture_file_overrides(const godot::Dictionary& images, const godot::Dictionary& atlases) {
    std::map<std::string, godot::String> result;
    for (const auto& key : images.keys()) result.emplace(direct_texture_key(string_value(key, "image_id")), text(string_value(images[key], "image_file")));
    for (const auto& key : atlases.keys()) {
        const auto id = string_value(key, "atlas_id"); require(atlases[key].get_type() == godot::Variant::DICTIONARY, "Atlas page files must be a Dictionary.", "atlas_page_files");
        const godot::Dictionary pages = atlases[key];
        for (const auto& page : pages.keys()) result.emplace(atlas_texture_key(id, string_value(page, "page_id")), text(string_value(pages[page], "page_file")));
    }
    return result;
}
namespace {
template<class T> godot::Array resource_json(const std::vector<T>& resources) {
    godot::Array result; for (const auto& resource : resources) result.push_back(text(resource.to_json())); return result;
}
}
bool CaneSkeleton::change_resources(const std::function<void(cane::RuntimePlayer&, const cane::RuntimeResourceValidation&)>& operation,
    const godot::Dictionary& images, const godot::Dictionary& pages) {
    if (busy_) { set_error(last_error_, cane::Error(cane::ErrorCode::invalid_state, "godotResources", "Reentrant player mutation.")); return false; }
    busy_ = true; GeometryOwnerScope owner_scope(get_instance_id());
    try {
        require(player_ && source_asset_, "No skeleton data is assigned.", "skeleton_data");
        const auto files = texture_file_overrides(images, pages);
        std::shared_ptr<const LoadedAsset> staged_asset; CanvasProjection staged_projection;
        staged_projection.reuse_shaders(projection_);
        const auto start = godot::Time::get_singleton()->get_ticks_usec(); std::uint64_t host_time = 0, upload_time = 0;
        operation(*player_, [&](const cane::RuntimeData& data, const cane::RuntimeFrame& frame, const cane::RuntimeResourceSnapshot& resources) {
            const auto host_start = godot::Time::get_singleton()->get_ticks_usec();
            if (is_inside_tree()) require(get_viewport()->is_using_hdr_2d(), "Cane requires a linear HDR 2D viewport.", "viewport.use_hdr_2d");
            staged_asset = acquire_overlay(data, resources, *source_asset_, *asset_, files);
            const auto upload_start = godot::Time::get_singleton()->get_ticks_usec();
            // Resource overlays cannot change the Slot catalog, track clocks or full Slot order.
            // Resolve cuts against that current Core order, including newly visible attachments.
            if (is_inside_tree()) staged_projection.publish(get_canvas_item(), frame.render_packet(), *staged_asset,
                prepare_slot_breaks(frame.render_packet()), false);
            upload_time = godot::Time::get_singleton()->get_ticks_usec() - upload_start;
            host_time = godot::Time::get_singleton()->get_ticks_usec() - host_start;
        });
        core_usec_ = godot::Time::get_singleton()->get_ticks_usec() - start - host_time; upload_usec_ = upload_time;
        asset_ = std::move(staged_asset); projection_.commit(staged_projection);
        projected_ = is_inside_tree(); projected_sequence_ = player_->frame().sequence();
        last_error_.clear(); notify_events(); busy_ = false; return true;
    } catch (const std::exception& failure) {
        set_error(last_error_, failure); emit_signal("runtime_error", last_error_.duplicate(true)); busy_ = false; return false;
    }
}
bool CaneSkeleton::apply_runtime_resources(const godot::Array& changes, const godot::Dictionary& images, const godot::Dictionary& pages) {
    return change_resources([&](cane::RuntimePlayer& player, const cane::RuntimeResourceValidation& validate) {
        (void)player.apply_runtime_resources(operations(changes), validate);
    }, images, pages);
}
bool CaneSkeleton::clear_runtime_resources() {
    return change_resources([](cane::RuntimePlayer& player, const cane::RuntimeResourceValidation& validate) { (void)player.clear_runtime_resources(validate); }, {}, {});
}
godot::Dictionary CaneSkeleton::get_runtime_resources() const {
    godot::Dictionary result; if (!player_) return result; const auto resources = player_->query_runtime_resources();
    result["images"] = resource_json(resources.images); result["atlases"] = resource_json(resources.atlases);
    result["attachments"] = resource_json(resources.attachments); result["skins"] = resource_json(resources.skins); return result;
}
godot::Array CaneSkeleton::get_texture_resources() const {
    return player_ ? texture_resources_value(player_->data(), *asset_) : godot::Array();
}
godot::Array texture_resources_value(const cane::RuntimeData& data, const LoadedAsset& asset) {
    godot::Array result;
    for (const auto& resource : data.query_texture_resources()) {
        godot::Dictionary row; row["kind"] = resource.kind == cane::TextureResourceKind::direct ? "direct" : "atlasPage";
        row["image_id"] = resource.image_id ? godot::Variant(text(*resource.image_id)) : godot::Variant();
        row["atlas_id"] = resource.atlas_id ? godot::Variant(text(*resource.atlas_id)) : godot::Variant();
        row["page_id"] = resource.page_id ? godot::Variant(text(*resource.page_id)) : godot::Variant();
        row["atlas_path"] = resource.atlas_path ? godot::Variant(text(*resource.atlas_path)) : godot::Variant();
        row["path"] = text(resource.path); row["width"] = resource.width; row["height"] = resource.height;
        row["pixel_format"] = text(resource.pixel_format);
        row["color_space"] = resource.color_space == cane::ColorSpace::srgb ? "srgb" : "linear";
        row["alpha_mode"] = resource.alpha_mode == cane::AlphaMode::straight ? "straight" : "premultiplied";
        row["min_filter"] = resource.min_filter == cane::TextureFilter::nearest ? "nearest" : "linear";
        row["mag_filter"] = resource.mag_filter == cane::TextureFilter::nearest ? "nearest" : "linear";
        const char* wraps[] = {"clamp", "repeat", "mirror"};
        row["wrap_u"] = wraps[static_cast<std::size_t>(resource.wrap_u)]; row["wrap_v"] = wraps[static_cast<std::size_t>(resource.wrap_v)];
        const auto file = asset.texture_files.find(texture_key(resource)); if (file != asset.texture_files.end()) row["resolved_file"] = file->second;
        result.push_back(row);
    }
    return result;
}
}
