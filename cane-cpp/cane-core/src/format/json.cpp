#include "format.hpp"
#include "cane/error.hpp"
#include <algorithm>
#include <unordered_set>

namespace cane::format {
bool utf8_less(std::string_view left, std::string_view right) noexcept {
    return std::lexicographical_compare(left.begin(), left.end(), right.begin(), right.end(),
        [](char a, char b) { return static_cast<unsigned char>(a) < static_cast<unsigned char>(b); });
}
bool valid_utf8(std::string_view text, bool reject_nul) noexcept {
    std::size_t i = 0;
    while (i < text.size()) {
        const auto c = static_cast<unsigned char>(text[i++]);
        if (c < 0x80) { if (c == 0 && reject_nul) return false; continue; }
        std::uint32_t point; std::size_t trailing; std::uint32_t minimum;
        if (c >= 0xc2 && c <= 0xdf) { point = c & 0x1fu; trailing = 1; minimum = 0x80; }
        else if (c >= 0xe0 && c <= 0xef) { point = c & 0x0fu; trailing = 2; minimum = 0x800; }
        else if (c >= 0xf0 && c <= 0xf4) { point = c & 0x07u; trailing = 3; minimum = 0x10000; }
        else return false;
        if (trailing > text.size() - i) return false;
        for (std::size_t j = 0; j < trailing; ++j) {
            const auto next = static_cast<unsigned char>(text[i++]);
            if ((next & 0xc0u) != 0x80u) return false;
            point = (point << 6u) | (next & 0x3fu);
        }
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return false;
    }
    return true;
}
Json parse_json(std::string_view input) {
    constexpr const char* op = "loadJson";
    if (input.size() > max_document_bytes) throw Error(ErrorCode::resource_limit, op, "JSON input exceeds the 2 GiB limit.");
    if (!valid_utf8(input)) throw Error(ErrorCode::invalid_utf8, op, "Invalid JSON UTF-8.");
    if (input.size() >= 3 && input.substr(0, 3) == std::string_view("\xef\xbb\xbf", 3))
        throw Error(ErrorCode::invalid_json, op, "Runtime JSON must not contain a byte-order mark.");
    struct Container { bool object; std::size_t count = 0; std::unordered_set<std::string> keys; };
    std::vector<Container> containers;
    auto next_item = [&] {
        if (containers.back().count == max_container_items) throw Error(ErrorCode::resource_limit, op, "JSON container exceeds the item limit.");
        ++containers.back().count;
    };
    auto callback = [&](int, Json::parse_event_t event, Json& parsed) {
        if (event == Json::parse_event_t::object_start || event == Json::parse_event_t::array_start) {
            if (containers.size() >= max_nesting) throw Error(ErrorCode::resource_limit, op, "JSON container nesting exceeds 256.");
            if (!containers.empty() && !containers.back().object) next_item();
            containers.push_back({event == Json::parse_event_t::object_start, 0, {}});
        } else if (event == Json::parse_event_t::key) {
            next_item();
            if (!containers.back().keys.insert(parsed.get<std::string>()).second)
                throw Error(ErrorCode::invalid_json, op, "Duplicate JSON object key.");
        } else if (event == Json::parse_event_t::object_end || event == Json::parse_event_t::array_end) {
            containers.pop_back();
        } else if (event == Json::parse_event_t::value && !containers.empty() && !containers.back().object) {
            next_item();
        }
        return true;
    };
    try { return Json::parse(input.begin(), input.end(), callback, true, false); }
    catch (const Json::exception& error) { throw Error(ErrorCode::invalid_json, op, error.what()); }
    catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, op, "Unable to allocate JSON data."); }
}
}
