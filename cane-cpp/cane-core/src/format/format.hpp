#pragma once
#include <nlohmann/json.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cane::format {
using Json = nlohmann::json;
inline constexpr std::size_t max_document_bytes = std::size_t{2} * 1024 * 1024 * 1024;
inline constexpr std::size_t max_container_items = 16777216;
inline constexpr std::size_t max_nesting = 256;

struct LoadWarning {
    std::string code = "unknownOptionalCanebSectionIgnored";
    std::string operation = "loadCaneb";
    std::string section_tag;
};
struct DecodedDocument {
    Json document;
    std::vector<LoadWarning> warnings;
};

// Transport parsing is separate from Runtime Model validation and player construction.
[[nodiscard]] Json parse_json(std::string_view utf8);
[[nodiscard]] DecodedDocument decode_caneb(const std::vector<std::uint8_t>& bytes);
[[nodiscard]] bool valid_utf8(std::string_view text, bool reject_nul = false) noexcept;
[[nodiscard]] bool utf8_less(std::string_view left, std::string_view right) noexcept;
}
