#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cane {
struct RuntimeVersion { std::uint32_t major = 0, minor = 0; };
struct RuntimeVersionRange {
    RuntimeVersion minimum, maximum;
    [[nodiscard]] bool contains(std::uint32_t major, std::uint32_t minor) const noexcept;
};
struct RuntimeConformanceInfo {
    std::string suite_version, manifest_sha256;
    std::uint32_t required_case_count = 0;
};
struct RuntimeCapabilities {
    std::string implementation_name, implementation_version, numeric_precision;
    RuntimeVersionRange runtime_json, caneb, atlas, runtime_api;
    std::vector<std::string> supported_runtime_features;
    std::uint64_t api_feature_bits = 0;
    RuntimeConformanceInfo last_passed_conformance;
};
// Returns owned metadata. Core conformance does not certify an engine or complete SDK.
[[nodiscard]] RuntimeCapabilities runtime_capabilities();
[[nodiscard]] bool supports_runtime_feature(std::string_view name) noexcept;
}
