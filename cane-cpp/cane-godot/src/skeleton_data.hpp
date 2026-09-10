#pragma once
#include <cane/runtime_data.hpp>
#include <cane/runtime_resources.hpp>
#include <cane/render_packet.hpp>
#include <godot_cpp/classes/resource.hpp>
#include <godot_cpp/classes/texture2d.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <map>

namespace cane_godot {
struct LoadedAsset {
    cane::RuntimeData data;
    std::map<std::string, godot::Ref<godot::Texture2D>> textures;
    std::map<std::string, cane::RuntimeTextureResource> texture_descriptors;
    godot::String runtime_directory;
    std::map<std::string, godot::String> atlas_directories, texture_files;
    std::map<std::string, std::string> image_overlays, atlas_overlays;
    explicit LoadedAsset(cane::RuntimeData value);
};
std::string texture_key(const cane::TextureDescriptor& descriptor);
std::string texture_key(const cane::RuntimeTextureResource& descriptor);
std::string direct_texture_key(const std::string& image_id);
std::string atlas_texture_key(const std::string& atlas_id, const std::string& page_id);
godot::Ref<godot::Texture2D> load_texture(const godot::String& path, bool reload = false);
std::map<std::string, godot::String> texture_file_overrides(const godot::Dictionary& images, const godot::Dictionary& atlases);
std::shared_ptr<const LoadedAsset> acquire_overlay(const cane::RuntimeData& data, const cane::RuntimeResourceSnapshot& resources,
    const LoadedAsset& source, const LoadedAsset& previous, std::map<std::string, godot::String> files);

class CaneSkeletonData : public godot::Resource {
    GDCLASS(CaneSkeletonData, godot::Resource)
    std::shared_ptr<const LoadedAsset> loaded_;
    godot::Dictionary last_error_;
protected:
    static void _bind_methods();
    static void bind_data_methods();
public:
    // Each successful load replaces one immutable asset snapshot. Existing players retain theirs.
    godot::Error load_files(const godot::String& runtime_file, const godot::PackedStringArray& atlas_files, bool allow_unverified_features = false);
    godot::PackedStringArray get_animation_ids() const;
    godot::PackedStringArray get_skin_ids() const;
    static godot::Dictionary get_capabilities();
    static bool supports_feature(const godot::String& name);
    godot::Dictionary get_metadata();
    godot::Array get_catalog(const godot::String& kind);
    godot::String get_catalog_definition_json(const godot::String& kind, const godot::String& id);
    godot::Array get_load_warnings();
    godot::Array get_texture_resources();
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
    bool is_loaded() const { return static_cast<bool>(loaded_); }
    std::shared_ptr<const LoadedAsset> snapshot() const { return loaded_; }
};
}
