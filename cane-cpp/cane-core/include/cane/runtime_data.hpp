#pragma once
#include "atlas.hpp"
#include "runtime_capabilities.hpp"
#include <array>
#include <map>
#include <optional>

namespace cane {
namespace detail { struct RuntimeDataState; struct RuntimeDataAccess; }
enum class RuntimeCatalogKind : std::size_t { atlas, image, audio, font, bone, slot, attachment, constraint, skin, event, animation };
enum class TextureResourceKind { direct, atlas_page };
struct DecodedTextureDimensions {
    TextureResourceKind kind = TextureResourceKind::direct;
    std::string image_id, atlas_id, page_id;
    std::uint32_t width = 0, height = 0;
};
struct RuntimeLoadOptions {
    std::map<std::string, std::string> atlas_json;
    std::optional<std::vector<DecodedTextureDimensions>> decoded_textures;
    // Retained for source compatibility. Known features load by default; unknown features always fail.
    bool allow_unverified_features = false;
};
struct RuntimeSkeletonInfo { std::string skeleton_id, name; float reference_scale = 100; };
struct RuntimeDocumentMetadata {
    RuntimeVersion format_version, runtime_api_version;
    std::string generator_name, generator_version;
};
struct RuntimeCatalogEntry { std::string id, name, type; };
struct RuntimeBoneDefinition {
    std::string id, name;
    std::optional<std::string> parent_id;
    std::optional<std::size_t> parent_index;
    BoneLocal setup;
    float length = 0;
    TransformMode transform_mode = TransformMode::normal;
};
struct RuntimeImageDefinition {
    std::string image_id, name, mime_type;
    std::optional<std::string> path, atlas_id;
    std::uint32_t width = 0, height = 0;
    std::optional<std::size_t> atlas_index, region_index;
};
struct RuntimeLoadWarning {
    std::string code, operation, section_tag;
    [[nodiscard]] std::string message() const;
};
// One decoded external image, including Atlas pages unused by the current pose.
// Owned metadata only; texture objects and resource acquisition belong to the host.
struct RuntimeTextureResource {
    TextureResourceKind kind = TextureResourceKind::direct;
    std::optional<std::string> image_id, atlas_id, page_id, atlas_path;
    std::string path, pixel_format = "rgba8";
    std::uint32_t width = 0, height = 0;
    ColorSpace color_space = ColorSpace::srgb;
    AlphaMode alpha_mode = AlphaMode::straight;
    TextureFilter min_filter = TextureFilter::linear, mag_filter = TextureFilter::linear;
    TextureWrap wrap_u = TextureWrap::clamp, wrap_v = TextureWrap::clamp;
};

class RuntimeData {
    std::shared_ptr<const detail::RuntimeDataState> state_;
    explicit RuntimeData(std::shared_ptr<const detail::RuntimeDataState> state) : state_(std::move(state)) {}
    friend struct detail::RuntimeDataAccess;
public:
    [[nodiscard]] static RuntimeData from_json(std::string_view utf8, const RuntimeLoadOptions& options = {});
    [[nodiscard]] static RuntimeData from_caneb(const std::vector<std::uint8_t>& bytes, const RuntimeLoadOptions& options = {});
    [[nodiscard]] const RuntimeSkeletonInfo& skeleton() const noexcept;
    [[nodiscard]] RuntimeDocumentMetadata query_metadata() const;
    [[nodiscard]] const std::vector<RuntimeCatalogEntry>& catalog(RuntimeCatalogKind kind) const;
    // Returns the complete authored definition, preserving optional fields and integer values.
    [[nodiscard]] std::string catalog_definition_json(RuntimeCatalogKind kind, std::string_view id) const;
    [[nodiscard]] std::vector<RuntimeTextureResource> query_texture_resources() const;
    [[nodiscard]] const std::vector<RuntimeBoneDefinition>& bones() const noexcept;
    [[nodiscard]] const std::vector<RuntimeImageDefinition>& images() const noexcept;
    [[nodiscard]] const std::vector<AtlasData>& atlases() const noexcept;
    [[nodiscard]] const std::vector<std::string>& required_features() const noexcept;
    [[nodiscard]] const std::vector<RuntimeLoadWarning>& warnings() const noexcept;
    void validate_decoded_texture_sizes(const std::vector<DecodedTextureDimensions>& decoded) const;
};
}
