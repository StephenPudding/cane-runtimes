#pragma once
#include "cane/constraint_state.hpp"
#include "model.hpp"

namespace cane::detail {
[[nodiscard]] ConstraintKind public_constraint_kind(animation::ConstraintKind kind);
[[nodiscard]] ConstraintKind override_kind(const ConstraintOverride& parameters);
void apply_constraint_override(ConstraintParameters& sampled, const ConstraintOverride& parameters, const char* operation);
[[nodiscard]] cane::ConstraintParameters project_constraint_parameters(animation::ConstraintKind kind, const ConstraintParameters& sampled);
}
