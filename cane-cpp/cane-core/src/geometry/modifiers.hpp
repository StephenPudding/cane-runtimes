#pragma once
#include "cane/geometry_modifiers.hpp"
#include "cane/runtime_data.hpp"

namespace cane::geometry {
void validate_modifiers(const RuntimeData& data, const GeometryModifiers& modifiers, const char* operation);
class ModifierStage {
    static void modify(std::vector<RenderAttachment>& attachments, const GeometryModifiers& persistent,
        const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats);
public:
    [[nodiscard]] static RenderPacket apply(std::vector<RenderAttachment> attachments, const GeometryModifiers& persistent,
        const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats);
    [[nodiscard]] static RenderPacket apply(std::shared_ptr<std::vector<RenderAttachment>> attachments, const GeometryModifiers& persistent,
        const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats);
};
}
