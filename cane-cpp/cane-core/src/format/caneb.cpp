#include "format.hpp"
#include "cane/error.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <unordered_set>

namespace cane::format {
namespace {
class CanebReader {
    struct Section { std::size_t offset, length; std::uint32_t flags; };
    const std::vector<std::uint8_t>& bytes_;
    std::size_t cursor_ = 0, end_;
    std::vector<std::string> strings_;

    [[noreturn]] static void fail(const char* detail, const char* message, ErrorCode code = ErrorCode::malformed_input) {
        throw Error(code, "loadCaneb", message, {}, {}, detail);
    }
    void need(std::size_t count) const {
        if (cursor_ > end_ || count > end_ - cursor_) fail("truncatedInput", "CANEB input is truncated.");
    }
    std::uint8_t byte() { need(1); return bytes_[cursor_++]; }
    std::uint16_t u16() {
        const auto low = byte(); return static_cast<std::uint16_t>(low | static_cast<std::uint16_t>(byte()) << 8u);
    }
    std::uint32_t u32() {
        const auto low = u16(); return static_cast<std::uint32_t>(low) | static_cast<std::uint32_t>(u16()) << 16u;
    }
    std::uint64_t u64() {
        const auto low = u32(); return static_cast<std::uint64_t>(low) | static_cast<std::uint64_t>(u32()) << 32u;
    }
    std::uint64_t varint() {
        std::uint64_t value = 0;
        for (unsigned shift = 0; shift <= 63; shift += 7) {
            const auto next = byte();
            if (shift == 63 && next > 1) fail("invalidVarint", "CANEB varint overflows 64 bits.");
            value |= static_cast<std::uint64_t>(next & 0x7fu) << shift;
            if ((next & 0x80u) == 0) {
                if (shift != 0 && next == 0) fail("nonCanonicalEncoding", "CANEB varint is not shortest.");
                return value;
            }
        }
        fail("invalidVarint", "CANEB varint is too long.");
    }
    static std::size_t bounded(std::uint64_t value, std::size_t limit) {
        if (value > limit) fail("resourceLimit", "CANEB collection exceeds its resource limit.", ErrorCode::resource_limit);
        return static_cast<std::size_t>(value);
    }
    const std::string& string_at(std::uint64_t index) const {
        if (index >= strings_.size()) fail("invalidStringIndex", "CANEB string index is outside STRS.");
        return strings_[static_cast<std::size_t>(index)];
    }
    void section(const Section& value) { cursor_ = value.offset; end_ = value.offset + value.length; }
    void finish() const { if (cursor_ != end_) fail("nonCanonicalEncoding", "Trailing bytes inside CANEB section."); }
    void read_strings() {
        const auto count = bounded(u32(), 1000000);
        if (u32() != 0) fail("nonCanonicalEncoding", "Nonzero STRS reserved field.");
        need((count + 1) * 4);
        std::vector<std::size_t> offsets(count + 1);
        for (auto& offset : offsets) offset = bounded(u32(), std::size_t{512} * 1024 * 1024);
        const auto blob = cursor_, length = end_ - blob;
        if (offsets.front() != 0 || offsets.back() != length) fail("invalidStringOffsets", "STRS blob length or first offset differs.");
        strings_.reserve(count);
        for (std::size_t i = 0; i < count; ++i) {
            if (offsets[i + 1] < offsets[i] || offsets[i + 1] > length) fail("invalidStringOffsets", "STRS offsets are not bounded and ordered.");
            const auto size = bounded(offsets[i + 1] - offsets[i], std::size_t{16} * 1024 * 1024);
            const std::string_view value(reinterpret_cast<const char*>(bytes_.data() + blob + offsets[i]), size);
            if (!valid_utf8(value, true)) fail("invalidUtf8", "Invalid or NUL-containing CANEB string.", ErrorCode::invalid_utf8);
            if (i != 0 && !utf8_less(strings_.back(), value)) fail("nonCanonicalEncoding", "STRS strings are not sorted and unique.");
            strings_.emplace_back(value);
        }
        cursor_ = end_;
    }
    Json value(std::size_t depth) {
        switch (byte()) {
        case 0: return nullptr;
        case 1: return false;
        case 2: return true;
        case 3: {
            const auto raw = varint(); const auto magnitude = static_cast<std::int64_t>(raw >> 1u);
            return (raw & 1u) != 0 ? -magnitude - 1 : magnitude;
        }
        case 4: return varint();
        case 5: {
            const auto bits = u32(); float number; std::memcpy(&number, &bits, sizeof(number));
            if (!std::isfinite(number)) fail("nonFiniteNumber", "CANEB binary32 value is non-finite.");
            return static_cast<double>(number);
        }
        case 6: {
            const auto bits = u64(); double number; std::memcpy(&number, &bits, sizeof(number));
            if (!std::isfinite(number)) fail("nonFiniteNumber", "CANEB binary64 value is non-finite.");
            return number;
        }
        case 7: return string_at(varint());
        case 8: {
            if (depth >= max_nesting) fail("resourceLimit", "CANEB container nesting exceeds 256.", ErrorCode::resource_limit);
            const auto count = bounded(varint(), max_container_items); need(count);
            auto result = Json::array(); result.get_ref<Json::array_t&>().reserve(count);
            for (std::size_t i = 0; i < count; ++i) result.push_back(value(depth + 1));
            return result;
        }
        case 9: {
            if (depth >= max_nesting) fail("resourceLimit", "CANEB container nesting exceeds 256.", ErrorCode::resource_limit);
            const auto count = bounded(varint(), max_container_items); need(count * 2);
            auto result = Json::object(); std::string_view previous;
            for (std::size_t i = 0; i < count; ++i) {
                const auto& key = string_at(varint());
                if (i != 0 && !utf8_less(previous, key)) fail("nonCanonicalEncoding", "CANEB object keys are not sorted and unique.");
                previous = key; result.emplace(key, value(depth + 1));
            }
            return result;
        }
        default: fail("invalidDataToken", "Unknown CANEB DATA token.");
        }
    }
    void verify_ids(const Json& document) {
        const auto count = u32();
        if (u32() != 0 || static_cast<std::uint64_t>(count) * 16 != end_ - cursor_)
            fail("invalidDenseIndexMap", "IDMP record size or reserved field differs.");
        const std::array<const char*, 11> collections{"atlases", "images", "audios", "fonts", "bones", "slots", "attachments", "constraints", "skins", "events", "animations"};
        if (!document.is_object() || !document.contains("skeleton") || !document["skeleton"].is_object()
            || !document["skeleton"].contains("skeletonId") || !document["skeleton"]["skeletonId"].is_string())
            fail("invalidRuntimeDocument", "DATA has no skeleton identity.");
        std::size_t expected = 1;
        for (const auto* collection : collections) {
            if (!document.contains(collection) || !document[collection].is_array()) fail("invalidRuntimeDocument", "DATA catalog is not an array.");
            expected += document[collection].size();
        }
        if (count != expected) fail("invalidDenseIndexMap", "IDMP count differs from DATA catalogs.");
        auto record = [&](std::uint16_t kind, std::size_t index, const std::string& id) {
            if (u16() != kind || u16() != 0 || u32() != index) fail("invalidDenseIndexMap", "IDMP kind or declaration index differs from DATA.");
            const auto string_index = u32();
            if (string_index >= strings_.size() || strings_[string_index] != id || u32() != 0)
                fail("invalidDenseIndexMap", "IDMP stable identity or reserved field differs from DATA.");
        };
        record(1, 0, document["skeleton"]["skeletonId"].get_ref<const std::string&>());
        for (std::uint16_t kind = 2; kind <= 12; ++kind) {
            const char* key = kind == 2 ? "atlasId" : kind == 3 ? "imageId" : kind == 4 ? "audioId" : kind == 5 ? "fontId" : "id";
            std::unordered_set<std::string> unique; std::size_t index = 0;
            for (const auto& entry : document[collections[kind - 2]]) {
                if (!entry.is_object() || !entry.contains(key) || !entry[key].is_string()) fail("invalidRuntimeDocument", "DATA catalog entry has no stable identity.");
                const auto& id = entry[key].get_ref<const std::string&>();
                if (id.empty() || !unique.insert(id).second) fail("invalidDenseIndexMap", "DATA stable IDs are empty or duplicated within a kind.");
                record(kind, index++, id);
            }
        }
    }
public:
    explicit CanebReader(const std::vector<std::uint8_t>& bytes) : bytes_(bytes), end_(bytes.size()) {}
    DecodedDocument read() {
        if (bytes_.size() > max_document_bytes) fail("resourceLimit", "CANEB input exceeds 2 GiB.", ErrorCode::resource_limit);
        need(32);
        for (const auto expected : std::array<std::uint8_t, 8>{67, 65, 78, 69, 66, 13, 10, 26})
            if (byte() != expected) fail("invalidMagic", "CANEB magic differs.");
        const auto major = u16(), minor = u16();
        if (major != 1 || minor != 0) fail("unsupportedBinaryVersion", "Only CANEB 1.0 is supported.", ErrorCode::unsupported_version);
        if (byte() != 1) fail("unsupportedByteOrder", "CANEB must be little-endian.", ErrorCode::unsupported_version);
        if (byte() != 0 || u16() != 32) fail("invalidHeader", "Invalid CANEB flags/header size.");
        const auto count = u32();
        if (count == 0 || count > 64 || u32() != 32 || u64() != bytes_.size()) fail("invalidHeader", "Invalid CANEB section count/table offset/file size.");
        need(static_cast<std::size_t>(count) * 32); const auto table_end = 32 + static_cast<std::size_t>(count) * 32;
        std::map<std::string, Section> sections; std::vector<Section> ranges; std::string previous; DecodedDocument result;
        for (std::uint32_t i = 0; i < count; ++i) {
            std::string tag; for (unsigned j = 0; j < 4; ++j) { const auto c = byte(); if (c > 127) fail("invalidSectionTable", "Section tag is not ASCII."); tag.push_back(static_cast<char>(c)); }
            const auto flags = u32(); const auto offset = u64(), length = u64(), decoded_length = u64();
            if ((flags & ~1u) != 0 || !utf8_less(previous, tag) || length != decoded_length || offset < table_end || offset % 8 != 0
                || offset > bytes_.size() || length > bytes_.size() - offset) fail("invalidSectionTable", "CANEB section range, flags, or ordering is invalid.");
            previous = tag; const Section descriptor{static_cast<std::size_t>(offset), static_cast<std::size_t>(length), flags};
            sections.emplace(tag, descriptor); ranges.push_back(descriptor);
            if (tag != "DATA" && tag != "IDMP" && tag != "STRS") {
                if (flags == 1) fail("unsupportedRequiredSection", "Unknown required CANEB section.", ErrorCode::unsupported_feature);
                result.warnings.push_back({"unknownOptionalCanebSectionIgnored", "loadCaneb", tag});
            }
        }
        std::sort(ranges.begin(), ranges.end(), [](const Section& a, const Section& b) { return a.offset < b.offset; });
        auto consumed = table_end;
        for (const auto& range : ranges) {
            if (range.offset < consumed) fail("invalidSectionTable", "CANEB sections overlap.");
            for (auto i = consumed; i < range.offset; ++i) if (bytes_[i] != 0) fail("nonCanonicalEncoding", "CANEB alignment padding is not zero.");
            consumed = range.offset + range.length;
        }
        for (auto i = consumed; i < bytes_.size(); ++i) if (bytes_[i] != 0) fail("nonCanonicalEncoding", "CANEB trailing padding is not zero.");
        for (const auto* tag : {"DATA", "IDMP", "STRS"}) {
            const auto found = sections.find(tag);
            if (found == sections.end() || found->second.flags != 1) fail("invalidSectionTable", "Required CANEB section is missing or optional.");
        }
        section(sections.at("STRS")); read_strings(); finish();
        section(sections.at("DATA")); result.document = value(0); finish();
        section(sections.at("IDMP")); verify_ids(result.document); finish();
        return result;
    }
};
}
DecodedDocument decode_caneb(const std::vector<std::uint8_t>& bytes) {
    try { return CanebReader(bytes).read(); }
    catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, "loadCaneb", "Unable to allocate CANEB data.", {}, {}, "resourceLimit"); }
    catch (const Json::exception& error) { throw Error(ErrorCode::malformed_input, "loadCaneb", error.what(), {}, {}, "invalidRuntimeDocument"); }
}
}
