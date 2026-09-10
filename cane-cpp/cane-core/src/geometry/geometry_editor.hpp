#pragma once
#include "modifiers.hpp"

namespace cane::geometry {
struct GeometryEditorState {
    RenderAttachment* attachment = nullptr;
    GeometryModifierStats* stats = nullptr;
};
struct GeometryEditorAccess {
    [[nodiscard]] static GeometryEditor create(std::shared_ptr<GeometryEditorState> state) { return GeometryEditor(std::move(state)); }
};
}
