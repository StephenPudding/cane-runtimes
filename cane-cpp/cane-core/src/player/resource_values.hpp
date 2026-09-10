#pragma once
#include "cane/runtime_resources.hpp"
#include "format/format.hpp"

namespace cane::detail {
struct ResourceValue {
    format::Json document;
    std::string id, name, type, slot;
    std::vector<std::string> required_features;
};
struct ResourceAccess {
    [[nodiscard]] static const ResourceValue& get(const RuntimeImageResource& value) { return *value.value_; }
    [[nodiscard]] static const ResourceValue& get(const RuntimeAtlasResource& value) { return *value.value_; }
    [[nodiscard]] static const ResourceValue& get(const RuntimeAttachmentResource& value) { return *value.value_; }
    [[nodiscard]] static const ResourceValue& get(const RuntimeSkinResource& value) { return *value.value_; }
    [[nodiscard]] static RuntimeImageResource image(format::Json row);
    [[nodiscard]] static RuntimeAtlasResource atlas(format::Json reference, format::Json atlas);
    [[nodiscard]] static RuntimeAttachmentResource attachment(format::Json row);
    [[nodiscard]] static RuntimeSkinResource skin(format::Json row);
};
void resource_id(std::string_view id, const char* operation, const char* field);
}
