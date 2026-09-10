#pragma once
#include "model_validation.hpp"
#include "model.hpp"
namespace cane::format {
[[nodiscard]] detail::RuntimeModel compile_model(const Json& document, const ModelIndex& index);
void compile_constraints(const Json& document, const ModelIndex& index, detail::RuntimeModel& model);
}
