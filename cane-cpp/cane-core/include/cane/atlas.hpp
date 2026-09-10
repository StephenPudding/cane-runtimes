#pragma once
#include "math.hpp"
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace cane {
enum class ColorSpace { srgb, linear };
enum class AlphaMode { straight, premultiplied };
enum class TextureFilter { nearest, linear };
enum class TextureWrap { clamp, repeat, mirror };
enum class AtlasRotation { none, clockwise90 };

struct AtlasPage {
    std::string page_id, image_path;
    std::uint32_t width = 0, height = 0;
    TextureFilter min_filter = TextureFilter::linear, mag_filter = TextureFilter::linear;
    TextureWrap wrap_u = TextureWrap::clamp, wrap_v = TextureWrap::clamp;
};
struct AtlasRegion {
    std::string region_id, image_id, page_id;
    std::size_t page_index = 0;
    std::uint32_t x = 0, y = 0, width = 0, height = 0;
    std::uint32_t source_width = 0, source_height = 0, source_x = 0, source_y = 0, edge_extension = 0;
    AtlasRotation rotation = AtlasRotation::none;
    std::array<Point, 4> uvs{}; // Declared logical TL, TR, BR, BL corners. Top-left UV origin.
    [[nodiscard]] std::uint32_t logical_width() const noexcept { return rotation == AtlasRotation::none ? width : height; }
    [[nodiscard]] std::uint32_t logical_height() const noexcept { return rotation == AtlasRotation::none ? height : width; }
};
struct DecodedAtlasPage {
    std::string page_id;
    std::uint32_t width = 0, height = 0;
};

// Immutable owned metadata. Texture decoding and engine handles remain outside Core.
class AtlasData {
    struct State;
    std::shared_ptr<const State> state_;
    explicit AtlasData(std::shared_ptr<const State> state) : state_(std::move(state)) {}
public:
    [[nodiscard]] static AtlasData from_json(std::string_view utf8);
    [[nodiscard]] const std::string& atlas_id() const noexcept;
    [[nodiscard]] const std::string& name() const noexcept;
    [[nodiscard]] ColorSpace color_space() const noexcept;
    [[nodiscard]] AlphaMode alpha_mode() const noexcept;
    [[nodiscard]] const std::vector<AtlasPage>& pages() const noexcept;
    [[nodiscard]] const std::vector<AtlasRegion>& regions() const noexcept;
    [[nodiscard]] const AtlasRegion& region_for_image(std::string_view image_id) const;
    void validate_image_ids(const std::vector<std::string>& image_ids) const;
    void validate_decoded_page_sizes(const std::vector<DecodedAtlasPage>& decoded) const;
};
}
