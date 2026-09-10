#pragma once
#include "runtime_data.hpp"

namespace cane {
namespace detail { struct RuntimeLoadPlanState; }
struct RuntimeTextureRequest {
    TextureResourceKind kind = TextureResourceKind::direct;
    std::optional<std::string> image_id, atlas_id, page_id, atlas_path;
    std::string path, pixel_format = "rgba8";
    std::optional<std::uint32_t> declared_width, declared_height;
    ColorSpace color_space = ColorSpace::srgb;
    AlphaMode alpha_mode = AlphaMode::straight;
    TextureFilter min_filter = TextureFilter::linear, mag_filter = TextureFilter::linear;
    TextureWrap wrap_u = TextureWrap::clamp, wrap_v = TextureWrap::clamp;
};

// Owns preparation input and resource requests, but is not a playable RuntimeData.
// Hosts decode every requested image, then complete validation with observed sizes.
class RuntimeLoadPlan {
    std::shared_ptr<const detail::RuntimeLoadPlanState> state_;
    explicit RuntimeLoadPlan(std::shared_ptr<const detail::RuntimeLoadPlanState> state) : state_(std::move(state)) {}
public:
    [[nodiscard]] static RuntimeLoadPlan from_json(std::string_view utf8, const RuntimeLoadOptions& options = {});
    [[nodiscard]] static RuntimeLoadPlan from_caneb(const std::vector<std::uint8_t>& bytes, const RuntimeLoadOptions& options = {});
    [[nodiscard]] const std::vector<RuntimeTextureRequest>& texture_requests() const noexcept;
    [[nodiscard]] const std::vector<RuntimeLoadWarning>& warnings() const noexcept;
    [[nodiscard]] RuntimeData create_data(const std::vector<DecodedTextureDimensions>& decoded) const;
};
}
