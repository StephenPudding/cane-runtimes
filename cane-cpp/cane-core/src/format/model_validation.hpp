#pragma once
#include "format.hpp"
#include <array>
#include <functional>
#include <limits>
#include <optional>
#include <set>
#include <unordered_map>
#include <unordered_set>

namespace cane::format {
enum class CatalogKind : std::size_t { atlas, image, audio, font, bone, slot, attachment, constraint, skin, event, animation };
struct ModelIndex {
    std::array<std::unordered_map<std::string, std::size_t>, 11> catalogs;
    std::vector<std::size_t> geometry_owner, deform_owner;
    std::unordered_map<std::string, std::set<std::string>> placeholders;
};

// All container/schema/reference validation completes before any RuntimeData publication.
class ModelValidation {
    const Json& document_;
    ModelIndex index_;
    std::unordered_set<std::string> declared_features_, used_features_, resource_paths_;
    std::string operation_;
    bool detached_ = false;
    void root();
    void resources_and_setup();
    void attachments();
    void check_attachment_shape(const Json& value, const std::string& path);
    void check_image_shape(const Json& value, const std::string& path);
    void check_skin_shape(const Json& value, const std::string& path);
    void constraints();
    void skins_and_events();
    void animations();
    void vertices(const Json& attachment, const std::string& path, const std::string& type);
    void logical_attachment(const Json& key, const std::string& slot_id, const std::string& path) const;
    void event_values(const Json& row, const std::string& path) const;
    void keys(const Json& source, float duration, const std::string& path, std::string_view fields, std::string_view required,
              const std::function<void(const Json&, const std::string&)>& check) const;
public:
    explicit ModelValidation(const Json& document, std::string operation = "loadJson") : document_(document), operation_(std::move(operation)) {}
    [[nodiscard]] ModelIndex validate();
    // Shares the full loader's value/shape rules; references remain deferred until composition.
    [[nodiscard]] std::vector<std::string> validate_resource(CatalogKind kind, const Json& value);
    [[noreturn]] void fail(const std::string& field, const std::string& message) const;
    static const Json& get(const Json& object, std::string_view key);
    void object(const Json& value, const std::string& path, std::string_view allowed, std::string_view required = {}) const;
    void array(const Json& value, const std::string& path) const;
    [[nodiscard]] std::string string(const Json& value, const std::string& path, bool nonempty = true, bool nul_free = true) const;
    [[nodiscard]] float scalar(const Json& value, const std::string& path, float low = -std::numeric_limits<float>::max(), float high = std::numeric_limits<float>::max()) const;
    [[nodiscard]] float number(const Json& value, std::string_view key, const std::string& path, float fallback = 0,
                               float low = -std::numeric_limits<float>::max(), float high = std::numeric_limits<float>::max()) const;
    [[nodiscard]] std::uint32_t unsigned_integer(const Json& value, const std::string& path, std::uint32_t high = std::numeric_limits<std::uint32_t>::max()) const;
    [[nodiscard]] std::int64_t signed_integer(const Json& value, const std::string& path) const;
    [[nodiscard]] bool boolean(const Json& value, std::string_view key, const std::string& path, bool fallback = false) const;
    [[nodiscard]] std::string choice(const Json& value, const std::string& path, std::string_view options) const;
    void optional_choice(const Json& value, std::string_view key, const std::string& path, std::string_view options) const;
    void color(const Json& value, const std::string& path) const;
    [[nodiscard]] std::string path(const Json& value, const std::string& field) const;
    [[nodiscard]] std::size_t reference(const Json& id, CatalogKind kind, const std::string& path) const;
    void references(const Json& values, CatalogKind kind, const std::string& path, bool nonempty = false) const;
};
inline constexpr std::string_view bone_modes = "normal onlyTranslation noRotationOrReflection noScale noScaleOrReflection";
inline constexpr std::string_view mapping_properties = "rotate x y scaleX scaleY shearY";
}
