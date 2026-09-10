#pragma once
#include "runtime_data.hpp"
#include <functional>
#include <variant>

namespace cane {
namespace detail { struct ResourceValue; struct ResourceAccess; }

// Immutable, independently owned Runtime Format values. JSON stays a serialization boundary;
// the public API never exposes its parser or mutable project/renderer objects.
class RuntimeImageResource {
    std::shared_ptr<const detail::ResourceValue> value_;
    explicit RuntimeImageResource(std::shared_ptr<const detail::ResourceValue> value) : value_(std::move(value)) {}
    friend struct detail::ResourceAccess;
public:
    [[nodiscard]] static RuntimeImageResource from_json(std::string_view json);
    [[nodiscard]] static RuntimeImageResource direct(std::string id, std::string name, std::string path, std::uint32_t width, std::uint32_t height, std::string mime_type = "image/png");
    [[nodiscard]] static RuntimeImageResource atlas(std::string id, std::string name, std::string atlas_id, std::uint32_t width, std::uint32_t height, std::string mime_type = "image/png");
    [[nodiscard]] const std::string& id() const noexcept;
    [[nodiscard]] std::string to_json() const;
};
class RuntimeAtlasResource {
    std::shared_ptr<const detail::ResourceValue> value_;
    explicit RuntimeAtlasResource(std::shared_ptr<const detail::ResourceValue> value) : value_(std::move(value)) {}
    friend struct detail::ResourceAccess;
public:
    [[nodiscard]] static RuntimeAtlasResource from_json(std::string_view reference_json, std::string_view atlas_json);
    [[nodiscard]] const std::string& id() const noexcept;
    [[nodiscard]] std::string reference_json() const;
    [[nodiscard]] std::string atlas_json() const;
    [[nodiscard]] std::string to_json() const;
};
class RuntimeAttachmentResource {
    std::shared_ptr<const detail::ResourceValue> value_;
    explicit RuntimeAttachmentResource(std::shared_ptr<const detail::ResourceValue> value) : value_(std::move(value)) {}
    friend struct detail::ResourceAccess;
public:
    [[nodiscard]] static RuntimeAttachmentResource from_json(std::string_view json);
    [[nodiscard]] RuntimeAttachmentResource copy(std::optional<std::string> id = {}, std::optional<std::string> name = {}, std::optional<std::string> slot_id = {}) const;
    [[nodiscard]] const std::string& id() const noexcept;
    [[nodiscard]] const std::string& kind() const noexcept;
    [[nodiscard]] const std::string& slot_id() const noexcept;
    [[nodiscard]] std::string to_json() const;
};
struct RuntimeAttachmentFactory {
    [[nodiscard]] static RuntimeAttachmentResource region(std::string_view properties_json);
    [[nodiscard]] static RuntimeAttachmentResource mesh(std::string_view properties_json);
    [[nodiscard]] static RuntimeAttachmentResource path(std::string_view properties_json);
    [[nodiscard]] static RuntimeAttachmentResource point(std::string_view properties_json);
    [[nodiscard]] static RuntimeAttachmentResource bounding_box(std::string_view properties_json);
    [[nodiscard]] static RuntimeAttachmentResource clipping(std::string_view properties_json);
};
class RuntimeSkinResource {
    std::shared_ptr<const detail::ResourceValue> value_;
    explicit RuntimeSkinResource(std::shared_ptr<const detail::ResourceValue> value) : value_(std::move(value)) {}
    friend struct detail::ResourceAccess;
public:
    [[nodiscard]] static RuntimeSkinResource from_json(std::string_view json);
    [[nodiscard]] const std::string& id() const noexcept;
    [[nodiscard]] const std::string& name() const noexcept;
    [[nodiscard]] std::string to_json() const;
};

struct RemoveRuntimeImage { std::string image_id; };
struct RemoveRuntimeAtlas { std::string atlas_id; };
struct RemoveRuntimeAttachment { std::string attachment_id; };
struct RemoveRuntimeSkin { std::string skin_id; };
using RuntimeResourceOperation = std::variant<RuntimeImageResource, RuntimeAtlasResource, RuntimeAttachmentResource, RuntimeSkinResource,
    RemoveRuntimeImage, RemoveRuntimeAtlas, RemoveRuntimeAttachment, RemoveRuntimeSkin>;
struct RuntimeResourceChanges {
    std::vector<RuntimeResourceOperation> operations;
};
struct RuntimeResourceSnapshot {
    std::vector<RuntimeImageResource> images;
    std::vector<RuntimeAtlasResource> atlases;
    std::vector<RuntimeAttachmentResource> attachments;
    std::vector<RuntimeSkinResource> skins;
    [[nodiscard]] bool empty() const noexcept { return images.empty() && atlases.empty() && attachments.empty() && skins.empty(); }
};
class RuntimeFrame;
// Synchronous host preparation over owned, immutable candidate values. Throw to reject
// before publication. The source player stays readable and cannot be mutated/reentered.
using RuntimeResourceValidation = std::function<void(const RuntimeData&, const RuntimeFrame&, const RuntimeResourceSnapshot&)>;

struct RuntimeSkinMapping {
    std::string slot_id;
    std::optional<std::string> name, attachment_id;
};
// Detached builder. Installed resource snapshots never alias its mutable lists.
class RuntimeSkinBuilder {
    std::string id_, name_;
    bool export_ = false, disposed_ = false;
    std::vector<RuntimeSkinMapping> mappings_;
    std::vector<std::string> bones_, constraints_;
    void live() const;
public:
    explicit RuntimeSkinBuilder(std::string id, std::optional<std::string> name = {}, bool export_skin = false);
    [[nodiscard]] static RuntimeSkinBuilder copy(const RuntimeSkinResource& source, std::string id, std::optional<std::string> name = {});
    [[nodiscard]] const std::string& id() const noexcept { return id_; }
    [[nodiscard]] bool disposed() const noexcept { return disposed_; }
    RuntimeSkinBuilder& set_name(std::string name);
    RuntimeSkinBuilder& set_export(bool export_skin);
    RuntimeSkinBuilder& set_attachment(std::string slot_id, std::optional<std::string> name, std::optional<std::string> attachment_id);
    [[nodiscard]] bool try_get_attachment(std::string_view slot_id, const std::optional<std::string>& name, std::optional<std::string>& attachment_id) const;
    bool remove_attachment(std::string_view slot_id, const std::optional<std::string>& name);
    RuntimeSkinBuilder& add_bone(std::string id);
    bool remove_bone(std::string_view id);
    RuntimeSkinBuilder& add_constraint(std::string id);
    bool remove_constraint(std::string_view id);
    RuntimeSkinBuilder& merge(const RuntimeSkinResource& source);
    RuntimeSkinBuilder& clear();
    [[nodiscard]] RuntimeSkinResource snapshot() const;
    void dispose() noexcept;
};
}
