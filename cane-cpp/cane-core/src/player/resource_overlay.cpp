#include "resource_overlay.hpp"
#include "resource_values.hpp"
#include "runtime_data_internal.hpp"
#include <iterator>
#include <list>
#include <set>
#include <type_traits>

namespace cane::detail {
namespace {
// Preserve insertion order without quadratic scans through a large resource transaction.
template<class T> class StagedCatalog {
    std::list<T> values_;
    std::unordered_map<std::string, typename std::list<T>::iterator> index_;
public:
    explicit StagedCatalog(const std::vector<T>& previous) { for (const auto& value : previous) upsert(value); }
    void upsert(const T& value) {
        const auto found = index_.find(value.id());
        if (found != index_.end()) *found->second = value;
        else { values_.push_back(value); index_.emplace(value.id(), std::prev(values_.end())); }
    }
    void remove(std::string_view id, const char* operation, const char* field) {
        resource_id(id, operation, field); const auto found = index_.find(std::string(id));
        if (found != index_.end()) { values_.erase(found->second); index_.erase(found); }
    }
    [[nodiscard]] std::vector<T> finish() {
        return {std::make_move_iterator(values_.begin()), std::make_move_iterator(values_.end())};
    }
};
template<class T> format::Json compose_catalog(const format::Json& original, const std::vector<T>& overlay, const char* id_field, bool atlas = false) {
    std::unordered_map<std::string, const T*> entries;
    for (const auto& item : overlay) entries.emplace(item.id(), &item);
    auto result = format::Json::array();
    const auto row = [&](const T& item) -> const format::Json& {
        const auto& value = ResourceAccess::get(item).document; return atlas ? value["reference"] : value;
    };
    for (const auto& item : original) {
        const auto found = entries.find(item[id_field].template get<std::string>());
        result.push_back(found == entries.end() ? item : row(*found->second));
        if (found != entries.end()) entries.erase(found);
    }
    for (const auto& item : overlay) if (entries.find(item.id()) != entries.end()) result.push_back(row(item));
    return result;
}
}
RuntimeResourceSnapshot stage_resources(const RuntimeResourceSnapshot& previous, const RuntimeResourceChanges& changes, const char* operation) {
    if (changes.operations.size() > 1000000) throw Error(ErrorCode::resource_limit, operation, "Resource transaction exceeds 1,000,000 operations.", "operations");
    StagedCatalog<RuntimeImageResource> images(previous.images);
    StagedCatalog<RuntimeAtlasResource> atlases(previous.atlases);
    StagedCatalog<RuntimeAttachmentResource> attachments(previous.attachments);
    StagedCatalog<RuntimeSkinResource> skins(previous.skins);
    for (const auto& change : changes.operations) {
        if (change.valueless_by_exception()) throw Error(ErrorCode::invalid_argument, operation, "Resource operation has no value.", "operations");
        std::visit([&](const auto& value) {
            using T = std::decay_t<decltype(value)>;
            if constexpr (std::is_same_v<T, RuntimeImageResource>) images.upsert(value);
            else if constexpr (std::is_same_v<T, RuntimeAtlasResource>) atlases.upsert(value);
            else if constexpr (std::is_same_v<T, RuntimeAttachmentResource>) attachments.upsert(value);
            else if constexpr (std::is_same_v<T, RuntimeSkinResource>) skins.upsert(value);
            else if constexpr (std::is_same_v<T, RemoveRuntimeImage>) images.remove(value.image_id, operation, "imageId");
            else if constexpr (std::is_same_v<T, RemoveRuntimeAtlas>) atlases.remove(value.atlas_id, operation, "atlasId");
            else if constexpr (std::is_same_v<T, RemoveRuntimeAttachment>) attachments.remove(value.attachment_id, operation, "attachmentId");
            else if constexpr (std::is_same_v<T, RemoveRuntimeSkin>) skins.remove(value.skin_id, operation, "skinId");
        }, change);
    }
    return {images.finish(), atlases.finish(), attachments.finish(), skins.finish()};
}
RuntimeData compose_resources(const RuntimeData& source, const RuntimeResourceSnapshot& resources, const char* operation) {
    if (resources.empty()) return source;
    const auto& original = RuntimeDataAccess::get(source); auto document = original.document;
    document["images"] = compose_catalog(original.document["images"], resources.images, "imageId");
    document["atlases"] = compose_catalog(original.document["atlases"], resources.atlases, "atlasId", true);
    document["attachments"] = compose_catalog(original.document["attachments"], resources.attachments, "id");
    document["skins"] = compose_catalog(original.document["skins"], resources.skins, "id");
    RuntimeLoadOptions options; options.allow_unverified_features = original.allow_unverified_features; options.atlas_json = original.atlas_sources;
    for (const auto& atlas : resources.atlases) options.atlas_json.insert_or_assign(atlas.id(), ResourceAccess::get(atlas).document["atlas"].dump());
    std::set<std::string> features(original.required_features.begin(), original.required_features.end());
    const auto collect = [&](const auto& values) {
        for (const auto& value : values) for (const auto& feature : ResourceAccess::get(value).required_features) features.insert(feature);
    };
    collect(resources.attachments); collect(resources.skins); document["requiredFeatures"] = features;
    // Only an unchanged texture identity/path can inherit a size learned by the source
    // loader. A new path must supply its own dimensions; never stamp facts into authored JSON.
    RuntimeDataAccess::DirectSizes inherited;
    for (const auto& row : document["images"]) {
        if (!row.contains("path")) continue;
        const auto id = row["imageId"].get<std::string>(); const auto found = original.index.catalogs[1].find(id);
        if (found == original.index.catalogs[1].end()) continue;
        const auto& image = original.images[found->second];
        if (!image.path || row["path"] != *image.path || row["mimeType"] != image.mime_type) continue;
        if ((row.contains("width") && row["width"] != image.width) || (row.contains("height") && row["height"] != image.height)) continue;
        inherited.emplace(id, std::make_pair(image.width, image.height));
    }
    return RuntimeDataAccess::load(std::move(document), options, original.warnings, operation, inherited);
}
}
