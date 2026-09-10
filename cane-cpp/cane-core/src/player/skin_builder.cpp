#include "resource_values.hpp"
#include "operation.hpp"
#include <algorithm>

namespace cane {
namespace {
constexpr auto skin_operation = "runtimeSkin";
void mapping_key(std::string_view slot, const std::optional<std::string>& name) {
    detail::resource_id(slot, skin_operation, "slotId"); if (name) detail::resource_id(*name, skin_operation, "name");
}
template<class T> auto mapping(T& values, std::string_view slot, const std::optional<std::string>& name) {
    return std::find_if(values.begin(), values.end(), [&](const auto& value) { return value.slot_id == slot && value.name == name; });
}
void add_id(std::vector<std::string>& values, std::string id, const char* field) {
    detail::resource_id(id, skin_operation, field);
    if (std::find(values.begin(), values.end(), id) == values.end()) values.push_back(std::move(id));
}
bool remove_id(std::vector<std::string>& values, std::string_view id, const char* field) {
    detail::resource_id(id, skin_operation, field); const auto at = std::find(values.begin(), values.end(), id);
    if (at == values.end()) return false;
    values.erase(at); return true;
}
std::optional<std::string> nullable(const format::Json& row, const char* field) { return row[field].is_null() ? std::nullopt : std::optional<std::string>(row[field].get<std::string>()); }
}
RuntimeSkinBuilder::RuntimeSkinBuilder(std::string id, std::optional<std::string> name, bool export_skin)
    : id_(std::move(id)), name_(name ? std::move(*name) : id_), export_(export_skin) {
    detail::resource_id(id_, "createRuntimeSkin", "id"); detail::resource_id(name_, "createRuntimeSkin", "name");
}
RuntimeSkinBuilder RuntimeSkinBuilder::copy(const RuntimeSkinResource& source, std::string id, std::optional<std::string> name) {
    return detail::operation("copyRuntimeSkin", [&] {
        RuntimeSkinBuilder builder(std::move(id), name ? std::move(name) : std::optional<std::string>(source.name()), detail::ResourceAccess::get(source).document["export"].get<bool>());
        builder.merge(source); return builder;
    });
}
void RuntimeSkinBuilder::live() const {
    if (disposed_) throw Error(ErrorCode::invalid_state, skin_operation, "Skin builder is disposed.", {}, id_);
}
RuntimeSkinBuilder& RuntimeSkinBuilder::set_name(std::string name) { live(); detail::resource_id(name, skin_operation, "name"); name_ = std::move(name); return *this; }
RuntimeSkinBuilder& RuntimeSkinBuilder::set_export(bool value) { live(); export_ = value; return *this; }
RuntimeSkinBuilder& RuntimeSkinBuilder::set_attachment(std::string slot, std::optional<std::string> name, std::optional<std::string> attachment) {
    return detail::operation(skin_operation, [&]() -> RuntimeSkinBuilder& {
        live(); mapping_key(slot, name); if (attachment) detail::resource_id(*attachment, skin_operation, "attachmentId");
        auto at = mapping(mappings_, slot, name); RuntimeSkinMapping value{std::move(slot), std::move(name), std::move(attachment)};
        if (at == mappings_.end()) mappings_.push_back(std::move(value)); else *at = std::move(value);
        return *this;
    });
}
bool RuntimeSkinBuilder::try_get_attachment(std::string_view slot, const std::optional<std::string>& name, std::optional<std::string>& attachment) const {
    return detail::operation(skin_operation, [&] {
        live(); mapping_key(slot, name); const auto at = mapping(mappings_, slot, name);
        std::optional<std::string> value = at == mappings_.end() ? std::nullopt : at->attachment_id; attachment.swap(value); return at != mappings_.end();
    });
}
bool RuntimeSkinBuilder::remove_attachment(std::string_view slot, const std::optional<std::string>& name) {
    live(); mapping_key(slot, name); const auto at = mapping(mappings_, slot, name);
    if (at == mappings_.end()) return false;
    mappings_.erase(at); return true;
}
RuntimeSkinBuilder& RuntimeSkinBuilder::add_bone(std::string id) { return detail::operation(skin_operation, [&]() -> RuntimeSkinBuilder& { live(); add_id(bones_, std::move(id), "boneId"); return *this; }); }
bool RuntimeSkinBuilder::remove_bone(std::string_view id) { live(); return remove_id(bones_, id, "boneId"); }
RuntimeSkinBuilder& RuntimeSkinBuilder::add_constraint(std::string id) { return detail::operation(skin_operation, [&]() -> RuntimeSkinBuilder& { live(); add_id(constraints_, std::move(id), "constraintId"); return *this; }); }
bool RuntimeSkinBuilder::remove_constraint(std::string_view id) { live(); return remove_id(constraints_, id, "constraintId"); }
RuntimeSkinBuilder& RuntimeSkinBuilder::merge(const RuntimeSkinResource& source) {
    return detail::operation("mergeRuntimeSkin", [&]() -> RuntimeSkinBuilder& {
        live(); auto candidate = *this; const auto& row = detail::ResourceAccess::get(source).document;
        for (const auto& entry : row["attachments"]) candidate.set_attachment(entry["slotId"].get<std::string>(), nullable(entry, "name"), nullable(entry, "attachmentId"));
        for (const auto& id : row["boneIds"]) candidate.add_bone(id.get<std::string>());
        for (const auto& id : row["constraintIds"]) candidate.add_constraint(id.get<std::string>());
        mappings_.swap(candidate.mappings_); bones_.swap(candidate.bones_); constraints_.swap(candidate.constraints_); return *this;
    });
}
RuntimeSkinBuilder& RuntimeSkinBuilder::clear() { live(); mappings_.clear(); bones_.clear(); constraints_.clear(); return *this; }
RuntimeSkinResource RuntimeSkinBuilder::snapshot() const {
    return detail::operation("snapshotRuntimeSkin", [&] {
        live(); auto mappings = format::Json::array();
        for (const auto& m : mappings_) mappings.push_back({{"slotId", m.slot_id}, {"name", m.name ? format::Json(*m.name) : format::Json(nullptr)}, {"attachmentId", m.attachment_id ? format::Json(*m.attachment_id) : format::Json(nullptr)}});
        return detail::ResourceAccess::skin({{"id", id_}, {"name", name_}, {"export", export_}, {"attachments", std::move(mappings)}, {"boneIds", bones_}, {"constraintIds", constraints_}});
    });
}
void RuntimeSkinBuilder::dispose() noexcept { mappings_.clear(); bones_.clear(); constraints_.clear(); disposed_ = true; }
}
