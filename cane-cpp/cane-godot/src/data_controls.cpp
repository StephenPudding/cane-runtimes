#include "skeleton_data.hpp"
#include "data_values.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
namespace {
godot::Dictionary version(cane::RuntimeVersion value) {
    godot::Dictionary result; result["major"] = value.major; result["minor"] = value.minor; return result;
}
godot::Dictionary versions(const cane::RuntimeVersionRange& value) {
    godot::Dictionary result; result["minimum"] = version(value.minimum); result["maximum"] = version(value.maximum); return result;
}
godot::PackedStringArray names(const std::vector<std::string>& values) {
    godot::PackedStringArray result; for (const auto& value : values) result.push_back(text(value)); return result;
}
cane::RuntimeCatalogKind catalog_kind(const godot::String& kind) {
    const char* kinds[] = {"atlas", "image", "audio", "font", "bone", "slot", "attachment", "constraint", "skin", "event", "animation"};
    for (std::size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); ++i)
        if (kind == kinds[i]) return static_cast<cane::RuntimeCatalogKind>(i);
    require(false, "Unknown catalog kind.", "kind"); return {};
}
}
void CaneSkeletonData::bind_data_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_static_method("CaneSkeletonData", D_METHOD("get_capabilities"), &CaneSkeletonData::get_capabilities);
    ClassDB::bind_static_method("CaneSkeletonData", D_METHOD("supports_feature", "name"), &CaneSkeletonData::supports_feature);
    ClassDB::bind_method(D_METHOD("get_metadata"), &CaneSkeletonData::get_metadata);
    ClassDB::bind_method(D_METHOD("get_catalog", "kind"), &CaneSkeletonData::get_catalog);
    ClassDB::bind_method(D_METHOD("get_catalog_definition_json", "kind", "id"), &CaneSkeletonData::get_catalog_definition_json);
    ClassDB::bind_method(D_METHOD("get_load_warnings"), &CaneSkeletonData::get_load_warnings);
    ClassDB::bind_method(D_METHOD("get_texture_resources"), &CaneSkeletonData::get_texture_resources);
}
godot::Dictionary CaneSkeletonData::get_capabilities() {
    const auto value = cane::runtime_capabilities(); godot::Dictionary result, conformance;
    result["implementation_name"] = text(value.implementation_name); result["implementation_version"] = text(value.implementation_version);
    result["numeric_precision"] = text(value.numeric_precision); result["runtime_json"] = versions(value.runtime_json);
    result["caneb"] = versions(value.caneb); result["atlas"] = versions(value.atlas); result["runtime_api"] = versions(value.runtime_api);
    result["supported_runtime_features"] = names(value.supported_runtime_features);
    result["api_feature_bits"] = static_cast<std::int64_t>(value.api_feature_bits);
    conformance["suite_version"] = text(value.last_passed_conformance.suite_version);
    conformance["manifest_sha256"] = text(value.last_passed_conformance.manifest_sha256);
    conformance["required_case_count"] = value.last_passed_conformance.required_case_count;
    result["last_passed_core_conformance"] = conformance; return result;
}
bool CaneSkeletonData::supports_feature(const godot::String& name) { return cane::supports_runtime_feature(text(name)); }
godot::Dictionary CaneSkeletonData::get_metadata() {
    godot::Dictionary result;
    try {
        require(static_cast<bool>(loaded_), "No asset has been loaded.", "skeleton_data");
        const auto metadata = loaded_->data.query_metadata(); const auto& skeleton = loaded_->data.skeleton();
        result["format_version"] = version(metadata.format_version); result["runtime_api_version"] = version(metadata.runtime_api_version);
        result["generator_name"] = text(metadata.generator_name); result["generator_version"] = text(metadata.generator_version);
        result["skeleton_id"] = text(skeleton.skeleton_id); result["name"] = text(skeleton.name); result["reference_scale"] = skeleton.reference_scale;
        result["required_features"] = names(loaded_->data.required_features()); last_error_.clear();
    } catch (const std::exception& failure) { result.clear(); set_error(last_error_, failure); }
    return result;
}
godot::Array CaneSkeletonData::get_catalog(const godot::String& kind) {
    godot::Array result;
    try {
        require(static_cast<bool>(loaded_), "No asset has been loaded.", "skeleton_data");
        for (const auto& value : loaded_->data.catalog(catalog_kind(kind))) {
            godot::Dictionary row; row["id"] = text(value.id); row["name"] = text(value.name); row["type"] = text(value.type); result.push_back(row);
        }
        last_error_.clear();
    } catch (const std::exception& failure) { result.clear(); set_error(last_error_, failure); }
    return result;
}
godot::String CaneSkeletonData::get_catalog_definition_json(const godot::String& kind, const godot::String& id) {
    try {
        require(static_cast<bool>(loaded_), "No asset has been loaded.", "skeleton_data");
        auto result = text(loaded_->data.catalog_definition_json(catalog_kind(kind), text(id))); last_error_.clear(); return result;
    } catch (const std::exception& failure) { set_error(last_error_, failure); return {}; }
}
godot::Array CaneSkeletonData::get_load_warnings() {
    godot::Array result;
    try {
        require(static_cast<bool>(loaded_), "No asset has been loaded.", "skeleton_data");
        for (const auto& value : loaded_->data.warnings()) {
            godot::Dictionary row; row["code"] = text(value.code); row["operation"] = text(value.operation);
            row["section_tag"] = text(value.section_tag); row["message"] = text(value.message()); result.push_back(row);
        }
        last_error_.clear();
    } catch (const std::exception& failure) { result.clear(); set_error(last_error_, failure); }
    return result;
}
godot::Array CaneSkeletonData::get_texture_resources() {
    try {
        require(static_cast<bool>(loaded_), "No asset has been loaded.", "skeleton_data");
        auto result = texture_resources_value(loaded_->data, *loaded_); last_error_.clear(); return result;
    } catch (const std::exception& failure) { set_error(last_error_, failure); return {}; }
}
}
