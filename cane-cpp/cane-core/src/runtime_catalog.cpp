#include "runtime_data_internal.hpp"
#include "operation.hpp"

namespace cane {
RuntimeDocumentMetadata RuntimeData::query_metadata() const {
    return detail::operation("queryMetadata", [&] {
        const auto& source = state_->document;
        return RuntimeDocumentMetadata{
            {source["formatVersion"]["major"].get<std::uint32_t>(), source["formatVersion"]["minor"].get<std::uint32_t>()},
            {source["runtimeApiVersion"]["major"].get<std::uint32_t>(), source["runtimeApiVersion"]["minor"].get<std::uint32_t>()},
            source["generator"]["name"].get<std::string>(), source["generator"]["version"].get<std::string>()};
    });
}
std::string RuntimeData::catalog_definition_json(RuntimeCatalogKind kind, std::string_view id) const {
    return detail::operation("getCatalogDefinition", [&] {
        constexpr std::array<const char*, 11> names{"atlases", "images", "audios", "fonts", "bones", "slots", "attachments", "constraints", "skins", "events", "animations"};
        const auto index = static_cast<std::size_t>(kind);
        if (index >= names.size()) throw Error(ErrorCode::invalid_argument, "getCatalogDefinition", "Unknown Runtime catalog kind.", "kind");
        if (id.empty() || !format::valid_utf8(id, true)) throw Error(ErrorCode::invalid_argument, "getCatalogDefinition", "Catalog ID must be non-empty UTF-8.", "id");
        const auto found = state_->index.catalogs[index].find(std::string(id));
        if (found == state_->index.catalogs[index].end()) throw Error(ErrorCode::not_found, "getCatalogDefinition", "Catalog ID was not found.", "id", std::string(id));
        return state_->document[names[index]][found->second].dump();
    });
}
std::vector<RuntimeTextureResource> RuntimeData::query_texture_resources() const {
    return detail::operation("queryTextureResources", [&] {
        std::vector<RuntimeTextureResource> result;
        for (const auto& image : state_->images) if (image.path) {
            RuntimeTextureResource resource; resource.image_id = image.image_id; resource.path = *image.path;
            resource.width = image.width; resource.height = image.height; result.push_back(std::move(resource));
        }
        for (std::size_t i = 0; i < state_->atlases.size(); ++i) {
            const auto& atlas = state_->atlases[i];
            const auto atlas_path = state_->document["atlases"][i]["path"].get<std::string>();
            for (const auto& page : atlas.pages()) {
                RuntimeTextureResource resource; resource.kind = TextureResourceKind::atlas_page;
                resource.atlas_id = atlas.atlas_id(); resource.page_id = page.page_id; resource.atlas_path = atlas_path;
                resource.path = page.image_path; resource.width = page.width; resource.height = page.height;
                resource.color_space = atlas.color_space(); resource.alpha_mode = atlas.alpha_mode();
                resource.min_filter = page.min_filter; resource.mag_filter = page.mag_filter; resource.wrap_u = page.wrap_u; resource.wrap_v = page.wrap_v;
                result.push_back(std::move(resource));
            }
        }
        return result;
    });
}
std::string RuntimeLoadWarning::message() const {
    return "Ignored unknown optional CANEB section '" + section_tag + "'.";
}
}
