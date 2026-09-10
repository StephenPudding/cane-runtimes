#include "skeleton_data.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/image_texture.hpp>
#include <godot_cpp/classes/resource_loader.hpp>

namespace cane_godot {
std::string direct_texture_key(const std::string& image) { return "image:" + image; }
std::string atlas_texture_key(const std::string& atlas, const std::string& page) { return "atlas:" + std::to_string(atlas.size()) + ":" + atlas + page; }
std::string texture_key(const cane::RuntimeTextureResource& resource) {
    return resource.kind == cane::TextureResourceKind::direct ? direct_texture_key(*resource.image_id) : atlas_texture_key(*resource.atlas_id, *resource.page_id);
}
LoadedAsset::LoadedAsset(cane::RuntimeData value) : data(std::move(value)) {
    for (auto descriptor : data.query_texture_resources()) texture_descriptors.emplace(texture_key(descriptor), std::move(descriptor));
}
godot::Ref<godot::Texture2D> load_texture(const godot::String& path, bool reload) {
    godot::Ref<godot::Texture2D> texture;
    auto* loader = godot::ResourceLoader::get_singleton();
    if (path.begins_with("res://") && loader->exists(path, "Texture2D")) {
        texture = loader->load(path, "Texture2D", reload ? godot::ResourceLoader::CACHE_MODE_IGNORE : godot::ResourceLoader::CACHE_MODE_REUSE);
    } else {
        require(godot::FileAccess::file_exists(path), "Runtime texture file is absent.", "texture.path");
        godot::Ref<godot::Image> image; image.instantiate();
        require(image->load(path) == godot::OK && !image->is_empty(), "Unable to decode a runtime texture.", "texture.path");
        texture = godot::ImageTexture::create_from_image(image);
    }
    require(texture.is_valid() && texture->get_width() > 0 && texture->get_height() > 0, "Texture has no decoded pixels.", "texture.path");
    return texture;
}
std::shared_ptr<const LoadedAsset> acquire_overlay(const cane::RuntimeData& data, const cane::RuntimeResourceSnapshot& resources,
    const LoadedAsset& source, const LoadedAsset& previous, std::map<std::string, godot::String> files) {
    auto staged = std::make_shared<LoadedAsset>(data); staged->runtime_directory = source.runtime_directory; staged->atlas_directories = source.atlas_directories;
    for (const auto& image : resources.images) staged->image_overlays.emplace(image.id(), image.to_json());
    for (const auto& atlas : resources.atlases) staged->atlas_overlays.emplace(atlas.id(), atlas.to_json());
    std::map<std::string, cane::RuntimeTextureResource> original;
    for (auto resource : source.data.query_texture_resources()) original.emplace(texture_key(resource), std::move(resource));
    std::vector<cane::DecodedTextureDimensions> dimensions;
    for (const auto& resource : data.query_texture_resources()) {
        const auto key = texture_key(resource); const bool direct = resource.kind == cane::TextureResourceKind::direct;
        const auto& next_defs = direct ? staged->image_overlays : staged->atlas_overlays;
        const auto& old_defs = direct ? previous.image_overlays : previous.atlas_overlays;
        const auto id = direct ? *resource.image_id : *resource.atlas_id; const auto next = next_defs.find(id), old = old_defs.find(id);
        const auto file = files.find(key); godot::String path; godot::Ref<godot::Texture2D> texture;
        if (next == next_defs.end()) {
            require(file == files.end(), "A texture file override requires an installed image or Atlas resource.", "texture_files");
            const auto found = source.textures.find(key); require(found != source.textures.end(), "Original texture resource is unavailable.", "texture");
            texture = found->second; path = source.texture_files.at(key);
        } else if (file == files.end() && old != old_defs.end() && old->second == next->second && previous.textures.count(key)) {
            texture = previous.textures.at(key); path = previous.texture_files.at(key);
        } else {
            if (file != files.end()) path = file->second;
            else if (direct) path = source.runtime_directory.path_join(text(resource.path));
            else {
                const auto origin = original.find(key);
                const auto directory = origin != original.end() && origin->second.atlas_path == resource.atlas_path
                    ? source.atlas_directories.at(*resource.atlas_id)
                    : source.runtime_directory.path_join(text(*resource.atlas_path)).get_base_dir();
                path = directory.path_join(text(resource.path));
            }
            // Explicit acquisition bypasses the import cache, even if the file path is unchanged.
            try { texture = load_texture(path, file != files.end()); }
            catch (const cane::Error& failure) {
                throw cane::Error(failure.code, failure.operation, std::string(failure.what()) + " " + text(path), failure.field,
                    direct ? resource.image_id : resource.page_id, failure.detail);
            }
        }
        if (file != files.end()) files.erase(file);
        dimensions.push_back({resource.kind, resource.image_id.value_or(""), resource.atlas_id.value_or(""), resource.page_id.value_or(""),
            static_cast<std::uint32_t>(texture->get_width()), static_cast<std::uint32_t>(texture->get_height())});
        staged->textures.emplace(key, std::move(texture)); staged->texture_files.emplace(key, std::move(path));
    }
    require(files.empty(), "Texture file overrides contain an undeclared resource.", "texture_files");
    data.validate_decoded_texture_sizes(dimensions); return staged;
}
}
