#pragma once
#include "format.hpp"
#include "animation/curves.hpp"

namespace cane::format {
// Validation includes every bundle member, including properties not queried by a channel.
[[nodiscard]] animation::PropertyCurves parse_curve(const Json& source, const std::string& path = "curve");
[[nodiscard]] animation::ScalarChannel scalar_channel(const Json& keys, std::string_view field, std::string_view property, bool sparse = false);
}
