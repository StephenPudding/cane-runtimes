#pragma once
#include "cane/runtime_data.hpp"
#include "format/model_validation.hpp"
#include "animation/clip.hpp"
#include "model.hpp"

namespace cane::detail {
struct RuntimeDataState {
    format::Json document;
    format::ModelIndex index;
    RuntimeSkeletonInfo skeleton;
    std::array<std::vector<RuntimeCatalogEntry>, 11> catalogs;
    std::vector<RuntimeBoneDefinition> bones;
    std::vector<RuntimeImageDefinition> images;
    std::vector<AtlasData> atlases;
    std::map<std::string, std::string> atlas_sources;
    bool allow_unverified_features = false;
    std::vector<std::string> required_features;
    std::vector<RuntimeLoadWarning> warnings;
    std::vector<animation::Clip> clips;
    RuntimeModel model;
};
struct RuntimeDataAccess {
    using DirectSizes = std::map<std::string, std::pair<std::uint32_t, std::uint32_t>>;
    [[nodiscard]] static const RuntimeDataState& get(const RuntimeData& data) noexcept { return *data.state_; }
    [[nodiscard]] static RuntimeData load(format::Json document, const RuntimeLoadOptions& options, std::vector<RuntimeLoadWarning> warnings, const char* operation, const DirectSizes& inherited_sizes = {});
};
}
