#pragma once
#include "cane/runtime_resources.hpp"

namespace cane::detail {
[[nodiscard]] RuntimeResourceSnapshot stage_resources(const RuntimeResourceSnapshot& previous, const RuntimeResourceChanges& changes, const char* operation);
[[nodiscard]] RuntimeData compose_resources(const RuntimeData& source, const RuntimeResourceSnapshot& resources, const char* operation);
}
