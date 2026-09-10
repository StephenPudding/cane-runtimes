#pragma once
#include "render_packet.hpp"
#include <functional>

namespace cane {
namespace geometry { struct GeometryEditorState; struct GeometryEditorAccess; }

struct GeometryModifierContext {
    std::uint64_t sequence = 0;
    float time_seconds = 0;
    bool persistent = false;
    std::uint32_t operation_index = 0;
};
struct GeometryModifierStats {
    std::uint32_t persistent_operations = 0, transient_operations = 0;
    std::uint64_t attachment_visits = 0, vertex_writes = 0, uv_writes = 0, tint_writes = 0;
};

// Copyable bounded handle. Copies expire together as soon as this callback returns, including
// exceptional exits. It exposes no mutable topology, texture, source transform or player state.
class GeometryEditor {
    std::shared_ptr<geometry::GeometryEditorState> state_;
    explicit GeometryEditor(std::shared_ptr<geometry::GeometryEditorState> state) : state_(std::move(state)) {}
    [[nodiscard]] geometry::GeometryEditorState& active() const;
    friend struct geometry::GeometryEditorAccess;
public:
    GeometryEditor() = default;
    [[nodiscard]] std::string attachment_id() const;
    [[nodiscard]] std::string slot_id() const;
    [[nodiscard]] std::uint32_t draw_index() const;
    [[nodiscard]] std::uint32_t vertex_count() const;
    [[nodiscard]] std::optional<Point> position(std::uint32_t vertex_index) const;
    [[nodiscard]] std::optional<Point> uv(std::uint32_t vertex_index) const;
    [[nodiscard]] FinalTint tint() const;
    void set_position(std::uint32_t vertex_index, Point value);
    void add_position(std::uint32_t vertex_index, Point delta);
    void set_uv(std::uint32_t vertex_index, Point value);
    void set_light_tint(std::array<std::uint8_t, 3> rgb, float alpha);
    void set_dark_tint(std::array<std::uint8_t, 3> rgb);
    void clear_dark_tint();
};

struct GeometryFilter {
    // Empty lists match all; nonempty attachment and slot filters are intersected.
    std::vector<std::string> attachment_ids, slot_ids;
};
struct DeterministicJitter {
    std::uint32_t seed = 0;
    double amplitude_x = 0, amplitude_y = 0, frequency_hz = 0;
};
struct RadialWave {
    double center_x = 0, center_y = 0, radial_amplitude = 0, angular_amplitude_degrees = 0;
    double wavelength = 1, phase_degrees = 0, speed_hz = 0, radius = 0;
};
struct CustomGeometryModifier {
    std::function<void(GeometryEditor, const GeometryModifierContext&)> apply;
};
struct GeometryModifier {
    std::variant<DeterministicJitter, RadialWave, CustomGeometryModifier> effect;
    GeometryFilter filter;
};
struct GeometryModifiers {
    // Installation and transient evaluation copy the list, including filters and callback values.
    std::vector<GeometryModifier> operations;
};
}
