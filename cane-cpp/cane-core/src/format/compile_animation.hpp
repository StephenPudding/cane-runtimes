#pragma once
#include "model_validation.hpp"
#include "animation/clip.hpp"

namespace cane::format {
[[nodiscard]] TransformMode decode_transform_mode(std::string_view name);
// Runs only after complete model validation; the result contains no JSON references.
[[nodiscard]] std::vector<animation::Clip> compile_animations(const Json& document, const ModelIndex& index);
}
