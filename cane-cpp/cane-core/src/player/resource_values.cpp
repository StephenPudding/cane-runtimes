#include "resource_values.hpp"
#include "format/model_validation.hpp"
#include "operation.hpp"

namespace cane::detail {
namespace {
std::shared_ptr<const ResourceValue> create(format::Json row, format::CatalogKind kind, const char* op) {
    return operation(op, [&] {
        format::ModelValidation validation(row, op);
        auto features = validation.validate_resource(kind, row);
        auto value = std::make_shared<ResourceValue>();
        value->id = row[kind == format::CatalogKind::image ? "imageId" : "id"].get<std::string>();
        value->name = row["name"].get<std::string>(); value->required_features = std::move(features);
        if (kind == format::CatalogKind::attachment) { value->type = row["type"].get<std::string>(); value->slot = row["slotId"].get<std::string>(); }
        value->document = std::move(row); return value;
    });
}
}
void resource_id(std::string_view id, const char* op, const char* field) {
    if (id.empty() || !format::valid_utf8(id, true)) throw Error(ErrorCode::invalid_argument, op, "Resource identity must be nonempty NUL-free UTF-8.", field);
}
RuntimeImageResource ResourceAccess::image(format::Json row) { return RuntimeImageResource(create(std::move(row), format::CatalogKind::image, "createRuntimeImage")); }
RuntimeAttachmentResource ResourceAccess::attachment(format::Json row) { return RuntimeAttachmentResource(create(std::move(row), format::CatalogKind::attachment, "createRuntimeAttachment")); }
RuntimeSkinResource ResourceAccess::skin(format::Json row) { return RuntimeSkinResource(create(std::move(row), format::CatalogKind::skin, "createRuntimeSkin")); }
RuntimeAtlasResource ResourceAccess::atlas(format::Json reference, format::Json atlas_document) {
    return operation("createRuntimeAtlas", [&] {
        format::ModelValidation validation(reference, "createRuntimeAtlas"); (void)validation.validate_resource(format::CatalogKind::atlas, reference);
        const auto atlas = AtlasData::from_json(atlas_document.dump());
        if (reference["atlasId"] != atlas.atlas_id()) throw Error(ErrorCode::validation_failed, "createRuntimeAtlas", "Atlas document and reference identities differ.", "reference.atlasId", atlas.atlas_id());
        auto value = std::make_shared<ResourceValue>(); value->id = atlas.atlas_id();
        value->document = {{"reference", std::move(reference)}, {"atlas", std::move(atlas_document)}};
        return RuntimeAtlasResource(std::move(value));
    });
}
}
namespace cane {
RuntimeImageResource RuntimeImageResource::from_json(std::string_view json) {
    return detail::operation("createRuntimeImage", [&] { return detail::ResourceAccess::image(format::parse_json(json)); });
}
RuntimeImageResource RuntimeImageResource::direct(std::string id, std::string name, std::string path, std::uint32_t width, std::uint32_t height, std::string mime) {
    return detail::operation("createRuntimeImage", [&] { return detail::ResourceAccess::image({{"imageId", std::move(id)}, {"name", std::move(name)}, {"path", std::move(path)}, {"width", width}, {"height", height}, {"mimeType", std::move(mime)}}); });
}
RuntimeImageResource RuntimeImageResource::atlas(std::string id, std::string name, std::string atlas_id, std::uint32_t width, std::uint32_t height, std::string mime) {
    return detail::operation("createRuntimeImage", [&] { return detail::ResourceAccess::image({{"imageId", std::move(id)}, {"name", std::move(name)}, {"atlasId", std::move(atlas_id)}, {"width", width}, {"height", height}, {"mimeType", std::move(mime)}}); });
}
const std::string& RuntimeImageResource::id() const noexcept { return value_->id; }
std::string RuntimeImageResource::to_json() const { return detail::operation("queryRuntimeImage", [&] { return value_->document.dump(); }); }
RuntimeAtlasResource RuntimeAtlasResource::from_json(std::string_view reference, std::string_view atlas) {
    return detail::operation("createRuntimeAtlas", [&] { return detail::ResourceAccess::atlas(format::parse_json(reference), format::parse_json(atlas)); });
}
const std::string& RuntimeAtlasResource::id() const noexcept { return value_->id; }
std::string RuntimeAtlasResource::to_json() const { return detail::operation("queryRuntimeAtlas", [&] { return value_->document.dump(); }); }
std::string RuntimeAtlasResource::reference_json() const { return detail::operation("queryRuntimeAtlas", [&] { return value_->document["reference"].dump(); }); }
std::string RuntimeAtlasResource::atlas_json() const { return detail::operation("queryRuntimeAtlas", [&] { return value_->document["atlas"].dump(); }); }
RuntimeAttachmentResource RuntimeAttachmentResource::from_json(std::string_view json) {
    return detail::operation("createRuntimeAttachment", [&] { return detail::ResourceAccess::attachment(format::parse_json(json)); });
}
RuntimeAttachmentResource RuntimeAttachmentResource::copy(std::optional<std::string> id, std::optional<std::string> name, std::optional<std::string> slot_id) const {
    return detail::operation("copyRuntimeAttachment", [&] {
        auto row = value_->document;
        if (id) row["id"] = *id;
        if (name) row["name"] = *name;
        if (slot_id) row["slotId"] = *slot_id;
        return detail::ResourceAccess::attachment(std::move(row));
    });
}
const std::string& RuntimeAttachmentResource::id() const noexcept { return value_->id; }
const std::string& RuntimeAttachmentResource::kind() const noexcept { return value_->type; }
const std::string& RuntimeAttachmentResource::slot_id() const noexcept { return value_->slot; }
std::string RuntimeAttachmentResource::to_json() const { return detail::operation("queryRuntimeAttachment", [&] { return value_->document.dump(); }); }
namespace {
RuntimeAttachmentResource attachment_factory(const char* type, std::string_view json) {
    return detail::operation("createRuntimeAttachment", [&] {
        auto row = format::parse_json(json);
        if (!row.is_object()) throw Error(ErrorCode::validation_failed, "createRuntimeAttachment", "Attachment properties must be an object.");
        row["type"] = type; return detail::ResourceAccess::attachment(std::move(row));
    });
}
}
RuntimeAttachmentResource RuntimeAttachmentFactory::region(std::string_view json) { return attachment_factory("region", json); }
RuntimeAttachmentResource RuntimeAttachmentFactory::mesh(std::string_view json) { return attachment_factory("mesh", json); }
RuntimeAttachmentResource RuntimeAttachmentFactory::path(std::string_view json) { return attachment_factory("path", json); }
RuntimeAttachmentResource RuntimeAttachmentFactory::point(std::string_view json) { return attachment_factory("point", json); }
RuntimeAttachmentResource RuntimeAttachmentFactory::bounding_box(std::string_view json) { return attachment_factory("boundingbox", json); }
RuntimeAttachmentResource RuntimeAttachmentFactory::clipping(std::string_view json) { return attachment_factory("clipping", json); }
RuntimeSkinResource RuntimeSkinResource::from_json(std::string_view json) {
    return detail::operation("createRuntimeSkin", [&] { return detail::ResourceAccess::skin(format::parse_json(json)); });
}
const std::string& RuntimeSkinResource::id() const noexcept { return value_->id; }
const std::string& RuntimeSkinResource::name() const noexcept { return value_->name; }
std::string RuntimeSkinResource::to_json() const { return detail::operation("queryRuntimeSkin", [&] { return value_->document.dump(); }); }
}
