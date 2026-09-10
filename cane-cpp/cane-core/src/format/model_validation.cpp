#include "model_validation.hpp"
#include "cane/error.hpp"
#include "cane/runtime_capabilities.hpp"
#include <algorithm>
#include <cmath>

namespace cane::format {
namespace {
bool word(std::string_view list, std::string_view value) {
    if (value.empty() || value.find(' ') != std::string_view::npos) return false;
    std::size_t start = 0;
    while (start < list.size()) {
        const auto end = list.find(' ', start); const auto size = end == std::string_view::npos ? list.size() - start : end - start;
        if (list.substr(start, size) == value) return true;
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
    return false;
}
constexpr std::array<const char*, 11> catalogs{"atlases", "images", "audios", "fonts", "bones", "slots", "attachments", "constraints", "skins", "events", "animations"};
}
[[noreturn]] void ModelValidation::fail(const std::string& field, const std::string& message) const { throw Error(ErrorCode::validation_failed, operation_, message, field); }
const Json& ModelValidation::get(const Json& object, std::string_view key) {
    static const Json absent; const auto found = object.find(std::string(key)); return found == object.end() ? absent : *found;
}
void ModelValidation::object(const Json& value, const std::string& field, std::string_view allowed, std::string_view required) const {
    if (!value.is_object()) fail(field, "Expected an object.");
    for (const auto& item : value.items()) if (!word(allowed, item.key())) fail(field + '.' + item.key(), "Unknown Runtime Model member.");
    std::size_t start = 0;
    while (start < required.size()) {
        const auto end = required.find(' ', start); const auto key = required.substr(start, end == std::string_view::npos ? required.size() - start : end - start);
        if (!key.empty() && !value.contains(std::string(key))) fail(field + '.' + std::string(key), "Missing required Runtime Model member.");
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
}
void ModelValidation::array(const Json& value, const std::string& field) const { if (!value.is_array()) fail(field, "Expected an array."); }
std::string ModelValidation::string(const Json& value, const std::string& field, bool nonempty, bool nul_free) const {
    if (!value.is_string()) fail(field, "Expected a string.");
    const auto& text = value.get_ref<const std::string&>();
    if ((nonempty && text.empty()) || !valid_utf8(text, nul_free)) fail(field, "Invalid UTF-8 string or empty identity/name.");
    return text;
}
float ModelValidation::scalar(const Json& value, const std::string& field, float low, float high) const {
    if (!value.is_number()) fail(field, "Expected a finite scalar.");
    const auto number = value.get<float>();
    if (!std::isfinite(number) || number < low || number > high) fail(field, "Scalar is outside its finite range.");
    return number;
}
float ModelValidation::number(const Json& value, std::string_view key, const std::string& field, float fallback, float low, float high) const {
    return value.contains(std::string(key)) ? scalar(get(value, key), field + '.' + std::string(key), low, high) : fallback;
}
std::uint32_t ModelValidation::unsigned_integer(const Json& value, const std::string& field, std::uint32_t high) const {
    if (!value.is_number()) fail(field, "Expected an unsigned integer.");
    const auto number = value.get<double>();
    if (!std::isfinite(number) || number < 0 || number > high || std::floor(number) != number) fail(field, "Unsigned integer is outside its range.");
    return static_cast<std::uint32_t>(number);
}
std::int64_t ModelValidation::signed_integer(const Json& value, const std::string& field) const {
    if (value.is_number_unsigned()) {
        const auto number = value.get<std::uint64_t>();
        if (number > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) fail(field, "Signed integer is outside 64-bit range.");
        return static_cast<std::int64_t>(number);
    }
    if (value.is_number_integer()) return value.get<std::int64_t>();
    if (!value.is_number()) fail(field, "Expected a signed integer.");
    const auto number = value.get<double>();
    if (!std::isfinite(number) || number < -9223372036854775808.0 || number >= 9223372036854775808.0 || std::floor(number) != number) fail(field, "Signed integer is outside 64-bit range.");
    return static_cast<std::int64_t>(number);
}
bool ModelValidation::boolean(const Json& value, std::string_view key, const std::string& field, bool fallback) const {
    if (!value.contains(std::string(key))) return fallback;
    const auto& result = get(value, key); if (!result.is_boolean()) fail(field + '.' + std::string(key), "Expected a boolean.");
    return result.get<bool>();
}
std::string ModelValidation::choice(const Json& value, const std::string& field, std::string_view options) const {
    auto selected = string(value, field); if (!word(options, selected)) fail(field, "Unknown Runtime Model enum value."); return selected;
}
void ModelValidation::optional_choice(const Json& value, std::string_view key, const std::string& field, std::string_view options) const {
    if (value.contains(std::string(key))) (void)choice(get(value, key), field + '.' + std::string(key), options);
}
void ModelValidation::color(const Json& value, const std::string& field) const {
    auto selected = string(value, field); if (selected.front() == '#') selected.erase(selected.begin());
    if (selected.size() != 6 || !std::all_of(selected.begin(), selected.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); })) fail(field, "Expected six hexadecimal RGB digits.");
}
std::string ModelValidation::path(const Json& value, const std::string& field) const {
    auto selected = string(value, field); if (selected.find_first_of(":\\") != std::string::npos) fail(field, "Resource path must be portable and relative.");
    std::size_t start = 0;
    for (;;) {
        const auto slash = selected.find('/', start); const auto part = std::string_view(selected).substr(start, slash == std::string::npos ? selected.size() - start : slash - start);
        if (part.empty() || part == "." || part == "..") fail(field, "Invalid resource path component.");
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    for (auto& c : selected) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return selected;
}
std::size_t ModelValidation::reference(const Json& id, CatalogKind kind, const std::string& field) const {
    const auto name = string(id, field); if (detached_) return 0;
    const auto& catalog = index_.catalogs[static_cast<std::size_t>(kind)];
    const auto found = catalog.find(name); if (found == catalog.end()) fail(field, "Unresolved reference: " + name); return found->second;
}
void ModelValidation::references(const Json& values, CatalogKind kind, const std::string& field, bool nonempty) const {
    array(values, field); if (nonempty && values.empty()) fail(field, "Reference list cannot be empty.");
    if (detached_) {
        std::unordered_set<std::string> ids;
        for (const auto& id : values) if (!ids.insert(string(id, field)).second) fail(field, "Duplicate reference.");
        return;
    }
    std::unordered_set<std::size_t> unique;
    for (const auto& id : values) if (!unique.insert(reference(id, kind, field)).second) fail(field, "Duplicate reference.");
}
ModelIndex ModelValidation::validate() {
    root(); resources_and_setup(); attachments(); constraints(); skins_and_events(); animations();
    for (const auto& feature : used_features_) if (declared_features_.find(feature) == declared_features_.end()) fail("requiredFeatures", "Document uses an undeclared feature: " + feature);
    return std::move(index_);
}
std::vector<std::string> ModelValidation::validate_resource(CatalogKind kind, const Json& value) {
    detached_ = true;
    const auto field = kind == CatalogKind::image ? "image" : kind == CatalogKind::atlas ? "reference" : kind == CatalogKind::skin ? "skin" : "attachment";
    const auto id = kind == CatalogKind::image ? "imageId" : kind == CatalogKind::atlas ? "atlasId" : "id";
    (void)string(get(value, id), std::string(field) + "." + id);
    if (kind == CatalogKind::image) check_image_shape(value, field);
    else if (kind == CatalogKind::attachment) check_attachment_shape(value, field);
    else if (kind == CatalogKind::skin) { check_skin_shape(value, field); used_features_.insert("skin"); }
    else if (kind == CatalogKind::atlas) { object(value, field, "atlasId path", "atlasId path"); (void)path(value["path"], "reference.path"); }
    else fail("kind", "Unsupported runtime resource kind.");
    return {used_features_.begin(), used_features_.end()};
}
void ModelValidation::root() {
    constexpr auto fields = "format formatVersion runtimeApiVersion generator requiredFeatures skeleton atlases images audios fonts bones slots attachments constraints skins events animations";
    object(document_, "$", fields, fields);
    if (document_["format"] != "cane-runtime") throw Error(ErrorCode::malformed_input, operation_, "Expected cane-runtime data.", "format");
    for (const auto* name : {"formatVersion", "runtimeApiVersion"}) {
        const auto& version = document_[name]; object(version, name, "major minor", "major minor");
        const auto major = unsigned_integer(version["major"], std::string(name) + ".major", 65535);
        const auto minor = unsigned_integer(version["minor"], std::string(name) + ".minor", 65535);
        if (major != 1 || minor > (std::string_view(name) == "formatVersion" ? 0u : 3u)) throw Error(ErrorCode::unsupported_version, operation_, "Unsupported Runtime format/API version.", name);
    }
    const auto& generator = document_["generator"]; object(generator, "generator", "name version", "name version");
    (void)string(generator["name"], "generator.name"); (void)string(generator["version"], "generator.version");
    const auto& skeleton = document_["skeleton"]; object(skeleton, "skeleton", "skeletonId name unit angleUnit referenceScale", "skeletonId name unit angleUnit referenceScale");
    (void)string(skeleton["skeletonId"], "skeleton.skeletonId"); (void)string(skeleton["name"], "skeleton.name");
    (void)choice(skeleton["unit"], "skeleton.unit", "px"); (void)choice(skeleton["angleUnit"], "skeleton.angleUnit", "deg");
    (void)scalar(skeleton["referenceScale"], "skeleton.referenceScale", std::numeric_limits<float>::denorm_min());
    array(document_["requiredFeatures"], "requiredFeatures"); std::string previous;
    for (const auto& feature : document_["requiredFeatures"]) {
        const auto name = string(feature, "requiredFeatures");
        if (!supports_runtime_feature(name)) throw Error(ErrorCode::unsupported_feature, operation_, "Unknown required feature: " + name, "requiredFeatures");
        if (!previous.empty() && !utf8_less(previous, name)) fail("requiredFeatures", "Required features must be sorted and unique.");
        previous = name; declared_features_.insert(name);
    }
    for (std::size_t kind = 0; kind < catalogs.size(); ++kind) {
        const auto* name = catalogs[kind]; const auto& entries = document_[name]; array(entries, name);
        const auto* id = kind == 0 ? "atlasId" : kind == 1 ? "imageId" : kind == 2 ? "audioId" : kind == 3 ? "fontId" : "id";
        for (std::size_t i = 0; i < entries.size(); ++i) {
            const auto field = std::string(name) + '[' + std::to_string(i) + ']';
            if (!entries[i].is_object()) fail(field, "Catalog row must be an object.");
            const auto identity = string(get(entries[i], id), field + '.' + id);
            if (!index_.catalogs[kind].emplace(identity, i).second) fail(field + '.' + id, "Duplicate catalog identity.");
        }
    }
}
void ModelValidation::check_image_shape(const Json& row, const std::string& field) {
    object(row, field, "imageId name mimeType path atlasId width height", "imageId name mimeType");
    (void)string(row["name"], field + ".name"); (void)string(row["mimeType"], field + ".mimeType");
    if (row.contains("path") == row.contains("atlasId")) fail(field, "Image requires exactly one path or Atlas source.");
    if (row.contains("atlasId")) (void)reference(row["atlasId"], CatalogKind::atlas, field + ".atlasId");
    if (row.contains("path")) (void)path(row["path"], field + ".path");
    for (const auto* dimension : {"width", "height"}) if (row.contains(dimension) && unsigned_integer(row[dimension], field + '.' + dimension) == 0) fail(field, "Image dimensions must be positive.");
}
void ModelValidation::resources_and_setup() {
    for (std::size_t kind = 0; kind < 4; ++kind) {
        const auto* name = catalogs[kind]; std::size_t ordinal = 0;
        for (const auto& row : document_[name]) {
            const auto field = std::string(name) + '[' + std::to_string(ordinal++) + ']';
            if (kind == 0) object(row, field, "atlasId path", "atlasId path");
            else if (kind == 1) check_image_shape(row, field);
            else {
                const auto fields = kind == 2 ? "audioId name path mimeType" : "fontId name path mimeType";
                object(row, field, fields, fields);
                (void)string(row["name"], field + ".name"); (void)string(row["mimeType"], field + ".mimeType");
            }
            if (row.contains("path") && !resource_paths_.insert(path(row["path"], field + ".path")).second) fail(field + ".path", "Resource paths collide after ASCII case folding.");
        }
    }
    std::size_t ordinal = 0;
    for (const auto& bone : document_["bones"]) {
        const auto field = "bones[" + std::to_string(ordinal) + ']';
        constexpr auto fields = "id name parentId x y length rotation shearX shearY scaleX scaleY transformMode"; object(bone, field, fields, fields);
        (void)string(bone["name"], field + ".name");
        if (!bone["parentId"].is_null() && reference(bone["parentId"], CatalogKind::bone, field + ".parentId") >= ordinal) fail(field + ".parentId", "Bones must be acyclic and parent-before-child.");
        for (const auto* key : {"x", "y", "rotation", "shearX", "shearY", "scaleX", "scaleY"}) (void)scalar(bone[key], field + '.' + key);
        if (scalar(bone["scaleX"], field + ".scaleX") == 0 || scalar(bone["scaleY"], field + ".scaleY") == 0) fail(field, "Setup bone scales must be non-zero.");
        (void)scalar(bone["length"], field + ".length", 0); (void)choice(bone["transformMode"], field + ".transformMode", bone_modes); ++ordinal;
    }
    ordinal = 0;
    for (const auto& slot : document_["slots"]) {
        const auto field = "slots[" + std::to_string(ordinal++) + ']';
        object(slot, field, "id name boneId attachmentId zIndex blendMode color alpha darkColor", "id name boneId attachmentId zIndex blendMode");
        (void)string(slot["name"], field + ".name"); (void)reference(slot["boneId"], CatalogKind::bone, field + ".boneId");
        if (!slot["attachmentId"].is_null()) (void)string(slot["attachmentId"], field + ".attachmentId");
        (void)signed_integer(slot["zIndex"], field + ".zIndex"); const auto blend = choice(slot["blendMode"], field + ".blendMode", "normal add multiply screen");
        if (blend != "normal") used_features_.insert("blend." + blend);
        if (slot.contains("color")) color(slot["color"], field + ".color");
        if (!get(slot, "darkColor").is_null()) { color(slot["darkColor"], field + ".darkColor"); used_features_.insert("tint.two-color"); }
        (void)number(slot, "alpha", field, 1, 0, 1);
    }
}
}
