#include "state.hpp"

namespace cane {
void RuntimePlayer::set_constraint_override(std::string_view id, const ConstraintOverride& parameters) {
    (void)apply_authoring({{SetConstraintOverride{std::string(id), parameters}}}, {}, "setConstraintOverride");
}
void RuntimePlayer::clear_constraint_override(std::string_view id) {
    (void)apply_authoring({{ClearConstraintOverride{std::string(id)}}}, {}, "clearConstraintOverride");
}
}
