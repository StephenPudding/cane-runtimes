#include "cane/atlas.hpp"
#include "cane/error.hpp"
#include "format.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <unordered_map>
#include <unordered_set>

namespace cane {
struct AtlasData::State {
    std::string id, name;
    ColorSpace color_space = ColorSpace::srgb;
    AlphaMode alpha_mode = AlphaMode::straight;
    std::vector<AtlasPage> pages;
    std::vector<AtlasRegion> regions;
    std::unordered_map<std::string, std::size_t> page_index, image_index;
};
namespace {
using format::Json;
[[noreturn]] void fail(const std::string& path, const char* detail, const char* message, ErrorCode code = ErrorCode::validation_failed) {
    throw Error(code, "loadAtlas", message, path, {}, detail);
}
void closed(const Json& value, const std::string& path, std::initializer_list<std::string_view> keys) {
    if (!value.is_object()) fail(path, "invalidObject", "Expected an Atlas object.");
    for (const auto& item : value.items())
        if (std::find(keys.begin(), keys.end(), item.key()) == keys.end()) fail(path + '.' + item.key(), "unknownMember", "Unknown Atlas member.");
    for (const auto key : keys) if (!value.contains(std::string(key))) fail(path + '.' + std::string(key), "missingMember", "Missing Atlas member.");
}
const std::string& text(const Json& value, const std::string& path) {
    if (!value.is_string() || value.get_ref<const std::string&>().empty() || !format::valid_utf8(value.get_ref<const std::string&>(), true))
        fail(path, "invalidString", "Atlas strings must be non-empty UTF-8 without NUL.");
    return value.get_ref<const std::string&>();
}
void array(const Json& value, const std::string& path) { if (!value.is_array()) fail(path, "invalidArray", "Expected an Atlas array."); }
std::uint32_t integer(const Json& value, const std::string& path, bool positive = false) {
    if (!value.is_number()) fail(path, "invalidInteger", "Expected an unsigned Atlas integer.");
    const auto number = value.get<double>();
    if (!std::isfinite(number) || number < (positive ? 1 : 0) || number > std::numeric_limits<std::uint32_t>::max() || std::floor(number) != number)
        fail(path, "invalidInteger", "Atlas integer is outside its permitted range.");
    return static_cast<std::uint32_t>(number);
}
std::string portable_path(const Json& value, const std::string& path) {
    const auto& source = text(value, path);
    if (source.find_first_of(":\\") != std::string::npos) fail(path, "unsafePagePath", "Atlas page path must be portable and relative.");
    std::size_t start = 0;
    for (;;) {
        const auto slash = source.find('/', start), end = slash == std::string::npos ? source.size() : slash;
        const auto component = std::string_view(source).substr(start, end - start);
        if (component.empty() || component == "." || component == "..") fail(path, "unsafePagePath", "Atlas page path contains an invalid component.");
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    auto folded = source;
    for (auto& c : folded) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return folded;
}
template<class Enum>
Enum enumeration(const Json& source, const std::string& path, std::initializer_list<std::pair<std::string_view, Enum>> choices) {
    const auto& value = text(source, path);
    for (const auto& entry : choices) if (entry.first == value) return entry.second;
    fail(path, "unsupportedMode", "Unsupported Atlas mode.");
}
struct Allocation { std::uint64_t left, top, right, bottom; std::size_t region; };
void disjoint(const std::vector<Allocation>& rectangles) {
    struct Event { std::uint64_t x; bool start; std::size_t rectangle; };
    std::vector<Event> events; events.reserve(rectangles.size() * 2);
    for (std::size_t i = 0; i < rectangles.size(); ++i) {
        events.push_back({rectangles[i].left, true, i}); events.push_back({rectangles[i].right, false, i});
    }
    std::sort(events.begin(), events.end(), [](const Event& a, const Event& b) {
        if (a.x != b.x) return a.x < b.x;
        if (a.start != b.start) return a.start < b.start; // Half-open edges can touch.
        return a.rectangle < b.rectangle;
    });
    std::map<std::pair<std::uint64_t, std::size_t>, std::uint64_t> active;
    for (const auto& event : events) {
        const auto& rectangle = rectangles[event.rectangle]; const auto key = std::make_pair(rectangle.top, event.rectangle);
        if (!event.start) { active.erase(key); continue; }
        const auto next = active.lower_bound(key);
        if ((next != active.end() && next->first.first < rectangle.bottom) || (next != active.begin() && std::prev(next)->second > rectangle.top))
            fail("regions[" + std::to_string(rectangle.region) + ']', "overlappingAllocation", "Atlas allocations overlap, including edge-extension texels.");
        active.emplace(key, rectangle.bottom);
    }
}
}
AtlasData AtlasData::from_json(std::string_view utf8) {
    try {
        const auto document = format::parse_json(utf8);
        closed(document, "$", {"format", "formatVersion", "atlasId", "name", "colorSpace", "alphaMode", "pages", "regions"});
        if (document["format"] != "cane-atlas") fail("format", "invalidFormat", "Expected cane-atlas format.");
        closed(document["formatVersion"], "formatVersion", {"major", "minor"});
        if (integer(document["formatVersion"]["major"], "formatVersion.major") != 1 || integer(document["formatVersion"]["minor"], "formatVersion.minor") != 0)
            fail("formatVersion", "unsupportedVersion", "Only Atlas Format 1.0 is supported.", ErrorCode::unsupported_version);
        auto state = std::make_shared<State>(); state->id = text(document["atlasId"], "atlasId"); state->name = text(document["name"], "name");
        state->color_space = enumeration<ColorSpace>(document["colorSpace"], "colorSpace", {{"srgb", ColorSpace::srgb}, {"linear", ColorSpace::linear}});
        state->alpha_mode = enumeration<AlphaMode>(document["alphaMode"], "alphaMode", {{"straight", AlphaMode::straight}, {"premultiplied", AlphaMode::premultiplied}});
        array(document["pages"], "pages"); array(document["regions"], "regions");
        std::unordered_set<std::string> paths, region_ids;
        for (const auto& row : document["pages"]) {
            const auto index = state->pages.size(); const auto path = "pages[" + std::to_string(index) + ']';
            closed(row, path, {"pageId", "image", "width", "height", "pixelFormat", "minFilter", "magFilter", "wrapU", "wrapV"});
            AtlasPage page; page.page_id = text(row["pageId"], path + ".pageId"); page.image_path = text(row["image"], path + ".image");
            if (!state->page_index.emplace(page.page_id, index).second) fail(path + ".pageId", "duplicateId", "Duplicate Atlas page ID.");
            if (!paths.insert(portable_path(row["image"], path + ".image")).second) fail(path + ".image", "pagePathCollision", "Atlas page paths collide after ASCII case folding.");
            const auto expected = state->name + (index == 0 ? "" : '-' + std::to_string(index + 1)) + ".png";
            if (page.image_path != expected) fail(path + ".image", "invalidPageName", "Atlas page name differs from its native name and page order.");
            page.width = integer(row["width"], path + ".width", true); page.height = integer(row["height"], path + ".height", true);
            if (row["pixelFormat"] != "rgba8") fail(path + ".pixelFormat", "unsupportedMode", "Atlas v1 requires rgba8 pixels.");
            page.min_filter = enumeration<TextureFilter>(row["minFilter"], path + ".minFilter", {{"nearest", TextureFilter::nearest}, {"linear", TextureFilter::linear}});
            page.mag_filter = enumeration<TextureFilter>(row["magFilter"], path + ".magFilter", {{"nearest", TextureFilter::nearest}, {"linear", TextureFilter::linear}});
            page.wrap_u = enumeration<TextureWrap>(row["wrapU"], path + ".wrapU", {{"clamp", TextureWrap::clamp}, {"repeat", TextureWrap::repeat}, {"mirror", TextureWrap::mirror}});
            page.wrap_v = enumeration<TextureWrap>(row["wrapV"], path + ".wrapV", {{"clamp", TextureWrap::clamp}, {"repeat", TextureWrap::repeat}, {"mirror", TextureWrap::mirror}});
            state->pages.push_back(std::move(page));
        }
        std::vector<std::vector<Allocation>> allocations(state->pages.size());
        for (const auto& row : document["regions"]) {
            const auto index = state->regions.size(); const auto path = "regions[" + std::to_string(index) + ']';
            closed(row, path, {"regionId", "imageId", "pageId", "x", "y", "width", "height", "sourceWidth", "sourceHeight", "sourceX", "sourceY", "rotation", "edgeExtension", "uvs"});
            AtlasRegion region; region.region_id = text(row["regionId"], path + ".regionId"); region.image_id = text(row["imageId"], path + ".imageId"); region.page_id = text(row["pageId"], path + ".pageId");
            if (!region_ids.insert(region.region_id).second || !state->image_index.emplace(region.image_id, index).second) fail(path, "duplicateId", "Duplicate Atlas region or image ID.");
            const auto page = state->page_index.find(region.page_id);
            if (page == state->page_index.end()) fail(path + ".pageId", "missingPage", "Atlas region page does not exist.");
            region.page_index = page->second; const auto& dimensions = state->pages[region.page_index];
            region.x = integer(row["x"], path + ".x"); region.y = integer(row["y"], path + ".y");
            region.width = integer(row["width"], path + ".width", true); region.height = integer(row["height"], path + ".height", true);
            region.source_width = integer(row["sourceWidth"], path + ".sourceWidth", true); region.source_height = integer(row["sourceHeight"], path + ".sourceHeight", true);
            region.source_x = integer(row["sourceX"], path + ".sourceX"); region.source_y = integer(row["sourceY"], path + ".sourceY");
            region.edge_extension = integer(row["edgeExtension"], path + ".edgeExtension");
            region.rotation = enumeration<AtlasRotation>(row["rotation"], path + ".rotation", {{"none", AtlasRotation::none}, {"clockwise90", AtlasRotation::clockwise90}});
            const std::uint64_t right = static_cast<std::uint64_t>(region.x) + region.width, bottom = static_cast<std::uint64_t>(region.y) + region.height;
            if (region.x < region.edge_extension || region.y < region.edge_extension || right + region.edge_extension > dimensions.width || bottom + region.edge_extension > dimensions.height)
                fail(path, "outOfBoundsRegion", "Atlas allocated rectangle does not fit its page.");
            if (static_cast<std::uint64_t>(region.source_x) + region.logical_width() > region.source_width || static_cast<std::uint64_t>(region.source_y) + region.logical_height() > region.source_height)
                fail(path, "invalidSourceTrim", "Atlas logical trim exceeds the source image extent.");
            array(row["uvs"], path + ".uvs"); if (row["uvs"].size() != 4) fail(path + ".uvs", "invalidUv", "Atlas region requires four UV pairs.");
            const double left_uv = static_cast<double>(region.x) / dimensions.width, right_uv = static_cast<double>(right) / dimensions.width;
            const double top_uv = static_cast<double>(region.y) / dimensions.height, bottom_uv = static_cast<double>(bottom) / dimensions.height;
            const std::array<std::array<double, 2>, 4> corners{{{left_uv, top_uv}, {right_uv, top_uv}, {right_uv, bottom_uv}, {left_uv, bottom_uv}}};
            for (std::size_t corner = 0; corner < 4; ++corner) {
                const auto& uv = row["uvs"][corner]; const auto& expected = corners[(corner + (region.rotation == AtlasRotation::clockwise90 ? 1 : 0)) % 4];
                if (!uv.is_array() || uv.size() != 2) fail(path + ".uvs", "invalidUv", "Atlas UV must be a pair.");
                std::array<float, 2> values{};
                for (std::size_t axis = 0; axis < 2; ++axis) {
                    if (!uv[axis].is_number()) fail(path + ".uvs", "invalidUv", "Atlas UV must be numeric.");
                    const auto value = uv[axis].get<double>();
                    if (!std::isfinite(value) || value < 0 || value > 1 || std::abs(value - expected[axis]) > 1e-7) fail(path + ".uvs", "invalidUv", "Declared Atlas UV disagrees with its rectangle and rotation.");
                    values[axis] = static_cast<float>(value);
                }
                region.uvs[corner] = {values[0], values[1]};
            }
            allocations[region.page_index].push_back({region.x - region.edge_extension, region.y - region.edge_extension, right + region.edge_extension, bottom + region.edge_extension, index});
            state->regions.push_back(std::move(region));
        }
        for (const auto& page : allocations) disjoint(page);
        return AtlasData(std::move(state));
    } catch (const Error& error) {
        if (error.operation == "loadAtlas") throw;
        throw Error(error.code, "loadAtlas", error.what(), error.field, error.entity_id, error.detail);
    } catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, "loadAtlas", "Unable to allocate Atlas data."); }
}
const std::string& AtlasData::atlas_id() const noexcept { return state_->id; }
const std::string& AtlasData::name() const noexcept { return state_->name; }
ColorSpace AtlasData::color_space() const noexcept { return state_->color_space; }
AlphaMode AtlasData::alpha_mode() const noexcept { return state_->alpha_mode; }
const std::vector<AtlasPage>& AtlasData::pages() const noexcept { return state_->pages; }
const std::vector<AtlasRegion>& AtlasData::regions() const noexcept { return state_->regions; }
const AtlasRegion& AtlasData::region_for_image(std::string_view image_id) const {
    const auto found = state_->image_index.find(std::string(image_id));
    if (found == state_->image_index.end()) throw Error(ErrorCode::not_found, "getAtlasRegion", "Atlas image ID does not exist.", "imageId", std::string(image_id));
    return state_->regions[found->second];
}
void AtlasData::validate_image_ids(const std::vector<std::string>& image_ids) const {
    std::unordered_set<std::string> known;
    for (const auto& id : image_ids) {
        if (id.empty() || !format::valid_utf8(id, true) || !known.insert(id).second) throw Error(ErrorCode::invalid_argument, "validateAtlasImages", "Image IDs must be valid and unique.", "imageIds");
    }
    for (const auto& region : state_->regions) if (known.find(region.image_id) == known.end())
        throw Error(ErrorCode::validation_failed, "validateAtlasImages", "Atlas region image is absent from the Runtime image catalog.", "imageId", region.image_id, "missingImage");
}
void AtlasData::validate_decoded_page_sizes(const std::vector<DecodedAtlasPage>& decoded) const {
    std::unordered_set<std::string> seen;
    for (const auto& fact : decoded) {
        const auto page = state_->page_index.find(fact.page_id);
        if (page == state_->page_index.end() || !seen.insert(fact.page_id).second) throw Error(ErrorCode::invalid_argument, "validateDecodedTextureSizes", "Decoded page identity is unknown or duplicated.", "pageId", fact.page_id);
        const auto& expected = state_->pages[page->second];
        if (fact.width != expected.width || fact.height != expected.height) throw Error(ErrorCode::validation_failed, "validateDecodedTextureSizes", "Decoded Atlas page dimensions differ from the declaration.", "dimensions", fact.page_id, "pageSizeMismatch");
    }
    if (seen.size() != state_->pages.size()) throw Error(ErrorCode::missing_resource, "validateDecodedTextureSizes", "Decoded dimensions are required for every Atlas page.", "pages");
}
}
