#include "skeleton_data.hpp"
#include "bridge.hpp"
#include <cane/runtime_load_plan.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>

namespace cane_godot {
namespace {
godot::Dictionary dictionary(const godot::Dictionary& value, const char* key) {
    const auto field = value.get(key, godot::Variant());
    require(field.get_type() == godot::Variant::DICTIONARY, "Imported Cane dictionary is missing.", key);
    return field;
}
std::map<std::string, godot::String> paths(const godot::Dictionary& value) {
    std::map<std::string, godot::String> result;
    const auto keys = value.keys();
    for (std::int64_t i = 0; i < keys.size(); ++i) {
        require(keys[i].get_type() == godot::Variant::STRING && value[keys[i]].get_type() == godot::Variant::STRING,
            "Imported Cane path entries must be strings.", "paths");
        result.emplace(text(static_cast<godot::String>(keys[i])), static_cast<godot::String>(value[keys[i]]));
    }
    return result;
}
}
void CaneSkeletonData::set_imported_bundle(const godot::Dictionary& bundle) {
    try {
        require(bundle.get("schema", godot::Variant()) == godot::Variant(1), "Unsupported imported Cane resource schema.", "schema");
        const auto payload_value = bundle.get("runtime", godot::Variant());
        require(payload_value.get_type() == godot::Variant::PACKED_BYTE_ARRAY, "Imported Cane source bytes are missing.", "runtime");
        const godot::PackedByteArray payload = payload_value;
        require(payload.size() > 0, "Imported Cane source is empty.", "runtime");
        std::vector<std::uint8_t> bytes(payload.ptr(), payload.ptr() + payload.size());
        cane::RuntimeLoadOptions options;
        const auto documents = paths(dictionary(bundle, "atlases"));
        for (const auto& item : documents) options.atlas_json.emplace(item.first, text(item.second));
        const auto unverified = bundle.get("allow_unverified_features", false);
        require(unverified.get_type() == godot::Variant::BOOL, "Imported Cane compatibility option must be boolean.", "allow_unverified_features");
        options.allow_unverified_features = static_cast<bool>(unverified);
        const bool binary = bytes.size() >= 5 && std::string(bytes.begin(), bytes.begin() + 5) == "CANEB";
        const auto plan = binary ? cane::RuntimeLoadPlan::from_caneb(bytes, options) : cane::RuntimeLoadPlan::from_json(std::string(bytes.begin(), bytes.end()), options);
        const auto supplied = dictionary(bundle, "textures");
        std::map<std::string, godot::Ref<godot::Texture2D>> textures;
        std::vector<cane::DecodedTextureDimensions> dimensions;
        for (const auto& request : plan.texture_requests()) {
            const auto key = request.kind == cane::TextureResourceKind::direct ? direct_texture_key(*request.image_id) : atlas_texture_key(*request.atlas_id, *request.page_id);
            const auto value = supplied.get(text(key), godot::Variant());
            require(value.get_type() == godot::Variant::OBJECT, "Imported Cane texture reference is missing.", "textures");
            const godot::Ref<godot::Texture2D> texture = value;
            require(texture.is_valid(), "Imported Cane texture has the wrong resource type.", "textures");
            dimensions.push_back({request.kind, request.image_id.value_or(""), request.atlas_id.value_or(""), request.page_id.value_or(""),
                static_cast<std::uint32_t>(texture->get_width()), static_cast<std::uint32_t>(texture->get_height())});
            textures.emplace(key, texture);
        }
        require(supplied.size() == static_cast<std::int64_t>(textures.size()), "Imported Cane texture catalog has extra entries.", "textures");
        const auto directory = bundle.get("runtime_directory", godot::Variant());
        require(directory.get_type() == godot::Variant::STRING, "Imported Cane source directory is missing.", "runtime_directory");
        auto staged = std::make_shared<LoadedAsset>(plan.create_data(dimensions));
        staged->textures = std::move(textures); staged->runtime_directory = directory;
        staged->atlas_directories = paths(dictionary(bundle, "atlas_directories"));
        staged->texture_files = paths(dictionary(bundle, "texture_files"));
        for (const auto& item : staged->textures) require(staged->texture_files.count(item.first) != 0, "Imported Cane texture path is missing.", "texture_files");
        // All validation and texture acquisition precede publication. No source file I/O is needed during scene load.
        const auto retained = bundle.duplicate(true);
        loaded_ = std::move(staged); imported_bundle_ = retained; imported_scene_resource_ = true; last_error_.clear(); emit_changed();
    } catch (const std::exception& failure) { set_error(last_error_, failure); }
}
godot::PackedStringArray CaneSkeletonData::get_source_files() const {
    godot::PackedStringArray result;
    const auto runtime = imported_bundle_.get("runtime_file", godot::Variant());
    if (runtime.get_type() == godot::Variant::STRING) result.push_back(runtime);
    const auto atlases = imported_bundle_.get("atlas_files", godot::Variant());
    if (atlases.get_type() == godot::Variant::PACKED_STRING_ARRAY) result.append_array(atlases);
    if (loaded_) for (const auto& file : loaded_->texture_files) result.push_back(file.second);
    return result;
}
}
