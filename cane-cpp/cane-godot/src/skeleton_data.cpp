#include "skeleton_data.hpp"
#include "bridge.hpp"
#include <cane/runtime_load_plan.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/image_texture.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
namespace {
std::vector<std::uint8_t> read(const godot::String& path) {
    auto file = godot::FileAccess::open(path, godot::FileAccess::READ);
    require(file.is_valid(), "Unable to open the runtime or atlas file.", "path");
    const auto count = file->get_length();
    if (count > 2ull * 1024 * 1024 * 1024) throw cane::Error(cane::ErrorCode::resource_limit, "godotAdapter", "Runtime input exceeds the 2 GiB transport limit.", "path");
    auto buffer = file->get_buffer(static_cast<std::int64_t>(count));
    require(static_cast<std::uint64_t>(buffer.size()) == count && count > 0, "Runtime input is empty or incomplete.", "path");
    return {buffer.ptr(), buffer.ptr() + buffer.size()};
}
godot::PackedStringArray ids(const std::shared_ptr<const LoadedAsset>& asset, cane::RuntimeCatalogKind kind) {
    godot::PackedStringArray output;
    if (asset) for (const auto& item : asset->data.catalog(kind)) output.push_back(text(item.id));
    return output;
}
}
std::string texture_key(const cane::TextureDescriptor& descriptor) {
    if (const auto* direct = std::get_if<cane::DirectTexture>(&descriptor)) return direct_texture_key(direct->image_id);
    const auto& atlas = std::get<cane::AtlasTexture>(descriptor); return atlas_texture_key(atlas.atlas_id, atlas.page_id);
}
void CaneSkeletonData::_bind_methods() {
    bind_data_methods();
    godot::ClassDB::bind_method(godot::D_METHOD("load_files", "runtime_file", "atlas_files", "allow_unverified_features"), &CaneSkeletonData::load_files, DEFVAL(false));
    godot::ClassDB::bind_method(godot::D_METHOD("get_animation_ids"), &CaneSkeletonData::get_animation_ids);
    godot::ClassDB::bind_method(godot::D_METHOD("get_skin_ids"), &CaneSkeletonData::get_skin_ids);
    godot::ClassDB::bind_method(godot::D_METHOD("get_last_error"), &CaneSkeletonData::get_last_error);
    godot::ClassDB::bind_method(godot::D_METHOD("is_loaded"), &CaneSkeletonData::is_loaded);
}
godot::Error CaneSkeletonData::load_files(const godot::String& runtime_file, const godot::PackedStringArray& atlas_files, bool allow_unverified_features) {
    try {
        cane::RuntimeLoadOptions options; options.allow_unverified_features = allow_unverified_features;
        std::map<std::string, godot::String> atlas_directories;
        for (std::int64_t i = 0; i < atlas_files.size(); ++i) {
            auto bytes = read(atlas_files[i]); std::string source(bytes.begin(), bytes.end());
            auto atlas = cane::AtlasData::from_json(source);
            require(options.atlas_json.emplace(atlas.atlas_id(), std::move(source)).second, "Duplicate atlas ID.", "atlas_files");
            atlas_directories.emplace(atlas.atlas_id(), atlas_files[i].get_base_dir());
        }
        auto bytes = read(runtime_file);
        const bool caneb = bytes.size() >= 5 && std::string(bytes.begin(), bytes.begin() + 5) == "CANEB";
        const auto plan = caneb ? cane::RuntimeLoadPlan::from_caneb(bytes, options)
            : cane::RuntimeLoadPlan::from_json(std::string(bytes.begin(), bytes.end()), options);
        std::map<std::string, godot::Ref<godot::Texture2D>> textures;
        std::map<std::string, godot::String> texture_files;
        std::vector<cane::DecodedTextureDimensions> dimensions;
        for (const auto& request : plan.texture_requests()) {
            const bool direct = request.kind == cane::TextureResourceKind::direct;
            const auto directory = direct ? runtime_file.get_base_dir() : atlas_directories.at(*request.atlas_id);
            const auto path = directory.path_join(text(request.path));
            auto texture = load_texture(path);
            dimensions.push_back({request.kind, request.image_id.value_or(""), request.atlas_id.value_or(""), request.page_id.value_or(""),
                static_cast<std::uint32_t>(texture->get_width()), static_cast<std::uint32_t>(texture->get_height())});
            const auto key = direct ? direct_texture_key(*request.image_id) : atlas_texture_key(*request.atlas_id, *request.page_id);
            textures.emplace(key, std::move(texture)); texture_files.emplace(key, path);
        }
        auto staged = std::make_shared<LoadedAsset>(plan.create_data(dimensions));
        staged->textures = std::move(textures); staged->texture_files = std::move(texture_files);
        staged->runtime_directory = runtime_file.get_base_dir(); staged->atlas_directories = std::move(atlas_directories);
        loaded_ = std::move(staged); last_error_.clear(); emit_changed(); return godot::OK;
    } catch (const std::exception& failure) { last_error_ = error(failure); return godot::ERR_INVALID_DATA; }
}
godot::PackedStringArray CaneSkeletonData::get_animation_ids() const { return ids(loaded_, cane::RuntimeCatalogKind::animation); }
godot::PackedStringArray CaneSkeletonData::get_skin_ids() const { return ids(loaded_, cane::RuntimeCatalogKind::skin); }
}
