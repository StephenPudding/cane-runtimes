#include "cane/runtime_capabilities.hpp"
#include <algorithm>
#include <array>

namespace cane {
namespace {
constexpr std::array<std::string_view, 22> features{{
    "attachment.bounding-box", "attachment.clipping", "attachment.mesh", "attachment.path", "attachment.point",
    "attachment.region", "attachment.sequence", "blend.add", "blend.multiply", "blend.screen", "constraint.ik",
    "constraint.path", "constraint.physics", "constraint.slider", "constraint.transform", "event", "mesh.deform",
    "mesh.weighted", "skin", "timeline.draw-order", "timeline.skin", "tint.two-color"
}};
static_assert([] {
    for (std::size_t i = 1; i < features.size(); ++i) if (!(features[i - 1] < features[i])) return false;
    return true;
}(), "Supported feature names must be sorted and unique.");
}
bool RuntimeVersionRange::contains(std::uint32_t major, std::uint32_t minor) const noexcept {
    return (major > minimum.major || (major == minimum.major && minor >= minimum.minor))
        && (major < maximum.major || (major == maximum.major && minor <= maximum.minor));
}
bool supports_runtime_feature(std::string_view name) noexcept { return std::binary_search(features.begin(), features.end(), name); }
RuntimeCapabilities runtime_capabilities() {
    RuntimeCapabilities result;
    result.implementation_name = "cane-cpp-runtime"; result.implementation_version = "0.1.0"; result.numeric_precision = "binary32";
    result.runtime_json = {{1, 0}, {1, 0}}; result.caneb = result.runtime_json; result.atlas = result.runtime_json;
    result.runtime_api = {{1, 0}, {1, 3}};
    result.supported_runtime_features.assign(features.begin(), features.end());
    result.api_feature_bits = (std::uint64_t{1} << 42) - 1;
    result.last_passed_conformance = {"1.8.0", "ddcd7bb2b5e9dadc00a95d8997886e87c31bc4e5eb5d43811eeabbb2ce98b696", 95};
    return result;
}
}
