#include "runtime_data_internal.hpp"
#include "format/compile_animation.hpp"
#include "format/compile_model.hpp"
#include "cane/error.hpp"
#include <algorithm>
#include <set>
#include <tuple>

namespace cane {
namespace {
using format::Json;
using format::ModelValidation;
using FactKey = std::tuple<TextureResourceKind, std::string, std::string>;
FactKey key(const DecodedTextureDimensions& fact) {
    return fact.kind == TextureResourceKind::direct ? FactKey(fact.kind, fact.image_id, "") : FactKey(fact.kind, fact.atlas_id, fact.page_id);
}
std::map<FactKey, DecodedTextureDimensions> texture_facts(const std::vector<DecodedTextureDimensions>& facts) {
    std::map<FactKey, DecodedTextureDimensions> result;
    for (const auto& fact : facts) {
        if (fact.kind != TextureResourceKind::direct && fact.kind != TextureResourceKind::atlas_page) throw Error(ErrorCode::invalid_argument, "validateDecodedTextureSizes", "Unknown texture resource kind.", "kind");
        const auto valid_id = [](const std::string& id) { return !id.empty() && format::valid_utf8(id, true); };
        if ((fact.kind == TextureResourceKind::direct && (!valid_id(fact.image_id) || !fact.atlas_id.empty() || !fact.page_id.empty()))
            || (fact.kind == TextureResourceKind::atlas_page && (!valid_id(fact.atlas_id) || !valid_id(fact.page_id) || !fact.image_id.empty()))) throw Error(ErrorCode::invalid_argument, "validateDecodedTextureSizes", "Decoded texture identity does not match its resource kind.", "identity");
        if (fact.width == 0 || fact.height == 0) throw Error(ErrorCode::invalid_argument, "validateDecodedTextureSizes", "Decoded texture dimensions must be positive.", "dimensions");
        if (!result.emplace(key(fact), fact).second) throw Error(ErrorCode::validation_failed, "validateDecodedTextureSizes", "Duplicate decoded texture identity.", "identity");
    }
    return result;
}
}
RuntimeData detail::RuntimeDataAccess::load(Json document, const RuntimeLoadOptions& options, std::vector<RuntimeLoadWarning> warnings, const char* operation, const DirectSizes& inherited_sizes) {
    try {
        auto state = std::make_shared<RuntimeDataState>(); state->index = ModelValidation(document, operation).validate();
        state->document = std::move(document); const auto& source = state->document;
        for (const auto& feature : source["requiredFeatures"]) state->required_features.push_back(feature.get<std::string>());
        state->skeleton = {source["skeleton"]["skeletonId"].get<std::string>(), source["skeleton"]["name"].get<std::string>(), source["skeleton"]["referenceScale"].get<float>()};
        state->warnings = std::move(warnings);
        state->atlas_sources = options.atlas_json; state->allow_unverified_features = options.allow_unverified_features;
        constexpr std::array<const char*, 11> catalogs{"atlases", "images", "audios", "fonts", "bones", "slots", "attachments", "constraints", "skins", "events", "animations"};
        for (std::size_t kind = 0; kind < catalogs.size(); ++kind) {
            const auto* id = kind == 0 ? "atlasId" : kind == 1 ? "imageId" : kind == 2 ? "audioId" : kind == 3 ? "fontId" : "id";
            for (const auto& row : source[catalogs[kind]]) state->catalogs[kind].push_back({row[id].get<std::string>(), row.value("name", row[id].get<std::string>()), row.value("type", "")});
        }
        for (const auto& row : source["bones"]) {
            RuntimeBoneDefinition bone; bone.id = row["id"].get<std::string>(); bone.name = row["name"].get<std::string>();
            if (!row["parentId"].is_null()) { bone.parent_id = row["parentId"].get<std::string>(); bone.parent_index = state->index.catalogs[4].at(*bone.parent_id); }
            bone.setup = {row["x"].get<float>(), row["y"].get<float>(), row["rotation"].get<float>(), row["scaleX"].get<float>(), row["scaleY"].get<float>(), row["shearX"].get<float>(), row["shearY"].get<float>()};
            bone.length = row["length"].get<float>(); bone.transform_mode = format::decode_transform_mode(row["transformMode"].get<std::string>()); state->bones.push_back(std::move(bone));
        }
        for (const auto& supplied : options.atlas_json) if (state->index.catalogs[0].find(supplied.first) == state->index.catalogs[0].end()) throw Error(ErrorCode::invalid_argument, "attachAtlas", "Supplied Atlas ID is not declared by this Runtime document.", "atlasId", supplied.first);
        std::vector<std::string> image_ids; for (const auto& row : source["images"]) image_ids.push_back(row["imageId"].get<std::string>());
        std::unordered_set<std::string> paths;
        ModelValidation validation(source, operation);
        for (const auto* collection : {"atlases", "images", "audios", "fonts"}) for (const auto& row : source[collection])
            if (!ModelValidation::get(row, "path").is_null()) paths.insert(validation.path(row["path"], std::string(collection) + ".path"));
        for (const auto& row : source["atlases"]) {
            const auto id = row["atlasId"].get<std::string>(); const auto found = options.atlas_json.find(id);
            if (found == options.atlas_json.end()) throw Error(ErrorCode::missing_resource, "attachAtlas", "Declared Atlas JSON is required.", {}, id);
            auto atlas = AtlasData::from_json(found->second); if (atlas.atlas_id() != id) validation.fail("atlases.atlasId", "Atlas document identity differs from its reference.");
            atlas.validate_image_ids(image_ids);
            for (const auto& region : atlas.regions()) {
                const auto image = state->index.catalogs[1].at(region.image_id);
                if (ModelValidation::get(source["images"][image], "atlasId") != id) validation.fail("images.atlasId", "Atlas region image belongs to a different resource source.");
            }
            for (const auto& page : atlas.pages()) if (!paths.insert(validation.path(Json(page.image_path), "atlas.pages.image")).second) validation.fail("atlas.pages.image", "Atlas page path collides with another Runtime resource.");
            state->atlases.push_back(std::move(atlas));
        }
        const auto decoded = options.decoded_textures ? texture_facts(*options.decoded_textures) : std::map<FactKey, DecodedTextureDimensions>();
        for (const auto& row : source["images"]) {
            RuntimeImageDefinition image; image.image_id = row["imageId"].get<std::string>(); image.name = row["name"].get<std::string>(); image.mime_type = row["mimeType"].get<std::string>();
            if (ModelValidation::get(row, "atlasId").is_null()) {
                image.path = row["path"].get<std::string>(); const auto fact = decoded.find({TextureResourceKind::direct, image.image_id, ""});
                const auto inherited = inherited_sizes.find(image.image_id);
                image.width = row.contains("width") ? row["width"].get<std::uint32_t>() : fact != decoded.end() ? fact->second.width : inherited != inherited_sizes.end() ? inherited->second.first : 0;
                image.height = row.contains("height") ? row["height"].get<std::uint32_t>() : fact != decoded.end() ? fact->second.height : inherited != inherited_sizes.end() ? inherited->second.second : 0;
                if (image.width == 0 || image.height == 0) throw Error(ErrorCode::missing_resource, operation, "Direct images need declared or decoded dimensions.", "images", image.image_id);
            } else {
                image.atlas_id = row["atlasId"].get<std::string>(); image.atlas_index = state->index.catalogs[0].at(*image.atlas_id);
                const auto& atlas = state->atlases[*image.atlas_index]; const AtlasRegion* region = nullptr;
                try { region = &atlas.region_for_image(image.image_id); }
                catch (const Error& failure) {
                    if (failure.code != ErrorCode::not_found) throw;
                    throw Error(ErrorCode::missing_resource, "attachAtlas", "Image has no region in its declared Atlas.", "images", image.image_id);
                }
                image.region_index = static_cast<std::size_t>(region - atlas.regions().data());
                image.width = region->source_width; image.height = region->source_height;
                if ((row.contains("width") && row["width"].get<std::uint32_t>() != image.width) || (row.contains("height") && row["height"].get<std::uint32_t>() != image.height))
                    throw Error(ErrorCode::validation_failed, "attachAtlas", "Atlas source extent differs from the Runtime image declaration.", "images." + image.image_id, image.image_id);
            }
            state->images.push_back(std::move(image));
        }
        state->model = format::compile_model(source, state->index);
        state->clips = format::compile_animations(source, state->index);
        RuntimeData data(std::move(state)); if (options.decoded_textures) data.validate_decoded_texture_sizes(*options.decoded_textures); return data;
    } catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, operation, "Unable to allocate Runtime data."); }
    catch (const Error& error) {
        // Whole-model validation has one public document field. Retain precise source
        // locations in its diagnostic text, while resource/Atlas/limit errors keep their
        // own structured domains. Instance resource transactions preserve target fields.
        if ((std::string_view(operation) == "loadJson" || std::string_view(operation) == "loadCaneb")
            && error.operation == operation && error.code == ErrorCode::validation_failed && error.field != "requiredFeatures") {
            const auto message = error.field ? *error.field + ": " + error.what() : std::string(error.what());
            throw Error(error.code, error.operation, message, "$", error.entity_id, error.detail);
        }
        throw;
    }
    catch (const Json::exception& error) { throw Error(ErrorCode::validation_failed, operation, error.what(), "$"); }
}
RuntimeData RuntimeData::from_json(std::string_view utf8, const RuntimeLoadOptions& options) { return detail::RuntimeDataAccess::load(format::parse_json(utf8), options, {}, "loadJson"); }
RuntimeData RuntimeData::from_caneb(const std::vector<std::uint8_t>& bytes, const RuntimeLoadOptions& options) {
    auto decoded = format::decode_caneb(bytes); std::vector<RuntimeLoadWarning> warnings;
    for (const auto& warning : decoded.warnings) warnings.push_back({warning.code, warning.operation, warning.section_tag});
    return detail::RuntimeDataAccess::load(std::move(decoded.document), options, std::move(warnings), "loadCaneb");
}
const RuntimeSkeletonInfo& RuntimeData::skeleton() const noexcept { return state_->skeleton; }
const std::vector<RuntimeCatalogEntry>& RuntimeData::catalog(RuntimeCatalogKind kind) const {
    const auto index = static_cast<std::size_t>(kind); if (index >= state_->catalogs.size()) throw Error(ErrorCode::invalid_argument, "getCatalog", "Unknown Runtime catalog kind.", "kind");
    return state_->catalogs[index];
}
const std::vector<RuntimeBoneDefinition>& RuntimeData::bones() const noexcept { return state_->bones; }
const std::vector<RuntimeImageDefinition>& RuntimeData::images() const noexcept { return state_->images; }
const std::vector<AtlasData>& RuntimeData::atlases() const noexcept { return state_->atlases; }
const std::vector<std::string>& RuntimeData::required_features() const noexcept { return state_->required_features; }
const std::vector<RuntimeLoadWarning>& RuntimeData::warnings() const noexcept { return state_->warnings; }
void RuntimeData::validate_decoded_texture_sizes(const std::vector<DecodedTextureDimensions>& decoded) const {
    auto facts = texture_facts(decoded);
    const auto consume = [&](const FactKey& id, std::uint32_t width, std::uint32_t height) {
        const auto found = facts.find(id); if (found == facts.end()) throw Error(ErrorCode::missing_resource, "validateDecodedTextureSizes", "Complete decoded texture catalog is required.", "textures");
        if (found->second.width != width || found->second.height != height) throw Error(ErrorCode::validation_failed, "validateDecodedTextureSizes", "Decoded texture dimensions disagree with the Runtime resource.", "dimensions");
        facts.erase(found);
    };
    for (const auto& image : state_->images) if (image.path) consume({TextureResourceKind::direct, image.image_id, ""}, image.width, image.height);
    for (const auto& atlas : state_->atlases) for (const auto& page : atlas.pages()) consume({TextureResourceKind::atlas_page, atlas.atlas_id(), page.page_id}, page.width, page.height);
    if (!facts.empty()) throw Error(ErrorCode::validation_failed, "validateDecodedTextureSizes", "Decoded catalog contains an undeclared texture.", "textures");
}
}
