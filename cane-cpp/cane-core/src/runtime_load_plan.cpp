#include "cane/runtime_load_plan.hpp"
#include "runtime_data_internal.hpp"
#include "operation.hpp"

namespace cane::detail {
struct RuntimeLoadPlanState {
    format::Json document;
    RuntimeLoadOptions options;
    std::vector<RuntimeTextureRequest> requests;
    std::vector<RuntimeLoadWarning> warnings;
    std::string load_operation;
};
}
namespace cane {
namespace {
std::shared_ptr<const detail::RuntimeLoadPlanState> prepare(format::Json document, const RuntimeLoadOptions& options,
    std::vector<RuntimeLoadWarning> warnings, const char* load_operation) {
    using format::ModelValidation;
    auto state = std::make_shared<detail::RuntimeLoadPlanState>();
    state->document = std::move(document); state->options = options; state->warnings = std::move(warnings); state->load_operation = load_operation;
    const auto& source = state->document;
    const auto index = ModelValidation(source, load_operation).validate();
    for (const auto& supplied : options.atlas_json) if (index.catalogs[0].find(supplied.first) == index.catalogs[0].end())
        throw Error(ErrorCode::invalid_argument, load_operation, "Supplied Atlas ID is not declared by this Runtime document.", "atlasId", supplied.first);
    for (const auto& row : source["images"]) if (ModelValidation::get(row, "atlasId").is_null()) {
        RuntimeTextureRequest request; request.image_id = row["imageId"].get<std::string>(); request.path = row["path"].get<std::string>();
        if (row.contains("width")) request.declared_width = row["width"].get<std::uint32_t>();
        if (row.contains("height")) request.declared_height = row["height"].get<std::uint32_t>();
        state->requests.push_back(std::move(request));
    }
    for (const auto& reference : source["atlases"]) {
        const auto id = reference["atlasId"].get<std::string>(); const auto found = options.atlas_json.find(id);
        if (found == options.atlas_json.end()) throw Error(ErrorCode::missing_resource, load_operation, "Declared Atlas JSON is required.", "atlasId", id);
        const auto atlas = AtlasData::from_json(found->second);
        if (atlas.atlas_id() != id) throw Error(ErrorCode::validation_failed, load_operation, "Atlas document identity differs from its reference.", "atlasId", id);
        for (const auto& page : atlas.pages()) {
            RuntimeTextureRequest request; request.kind = TextureResourceKind::atlas_page;
            request.atlas_id = id; request.page_id = page.page_id; request.atlas_path = reference["path"].get<std::string>(); request.path = page.image_path;
            request.declared_width = page.width; request.declared_height = page.height; request.color_space = atlas.color_space(); request.alpha_mode = atlas.alpha_mode();
            request.min_filter = page.min_filter; request.mag_filter = page.mag_filter; request.wrap_u = page.wrap_u; request.wrap_v = page.wrap_v;
            state->requests.push_back(std::move(request));
        }
    }
    return state;
}
}
RuntimeLoadPlan RuntimeLoadPlan::from_json(std::string_view utf8, const RuntimeLoadOptions& options) {
    return detail::operation("prepareJson", [&] { return RuntimeLoadPlan(prepare(format::parse_json(utf8), options, {}, "loadJson")); });
}
std::vector<RuntimeAtlasReference> RuntimeLoadPlan::inspect_atlas_references(const std::vector<std::uint8_t>& source) {
    return detail::operation("inspectDependencies", [&] {
        const bool binary = source.size() >= 5 && std::string(source.begin(), source.begin() + 5) == "CANEB";
        auto document = binary ? format::decode_caneb(source).document : format::parse_json(std::string(source.begin(), source.end()));
        (void)format::ModelValidation(document, "inspectDependencies").validate();
        std::vector<RuntimeAtlasReference> references;
        for (const auto& row : document["atlases"])
            references.push_back({row["atlasId"].get<std::string>(), row["path"].get<std::string>()});
        return references;
    });
}
RuntimeLoadPlan RuntimeLoadPlan::from_caneb(const std::vector<std::uint8_t>& bytes, const RuntimeLoadOptions& options) {
    return detail::operation("prepareCaneb", [&] {
        auto decoded = format::decode_caneb(bytes); std::vector<RuntimeLoadWarning> warnings;
        for (const auto& warning : decoded.warnings) warnings.push_back({warning.code, warning.operation, warning.section_tag});
        return RuntimeLoadPlan(prepare(std::move(decoded.document), options, std::move(warnings), "loadCaneb"));
    });
}
const std::vector<RuntimeTextureRequest>& RuntimeLoadPlan::texture_requests() const noexcept { return state_->requests; }
const std::vector<RuntimeLoadWarning>& RuntimeLoadPlan::warnings() const noexcept { return state_->warnings; }
RuntimeData RuntimeLoadPlan::create_data(const std::vector<DecodedTextureDimensions>& decoded) const {
    return detail::operation("completeLoad", [&] {
        auto options = state_->options; options.decoded_textures = decoded;
        auto data = detail::RuntimeDataAccess::load(state_->document, options, state_->warnings, state_->load_operation.c_str());
        if (state_->options.decoded_textures) data.validate_decoded_texture_sizes(*state_->options.decoded_textures);
        return data;
    });
}
}
