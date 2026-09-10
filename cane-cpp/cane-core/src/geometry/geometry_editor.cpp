#include "geometry_editor.hpp"
#include "cane/error.hpp"
#include <cmath>

namespace cane {
namespace {
constexpr auto op = "geometryModifier";
void finite_point(Point value, const char* x, const char* y) {
    if (!std::isfinite(value.x)) throw Error(ErrorCode::invalid_argument, op, "Editor input must be finite.", x);
    if (!std::isfinite(value.y)) throw Error(ErrorCode::invalid_argument, op, "Editor input must be finite.", y);
}
std::size_t offset(const RenderAttachment& attachment, std::uint32_t index) {
    if (index >= attachment.world_vertices_xy.size() / 2)
        throw Error(ErrorCode::invalid_argument, op, "Vertex index is outside the attachment.", "vertexIndex", attachment.attachment_id);
    return static_cast<std::size_t>(index) * 2;
}
std::optional<Point> read(const std::vector<float>& values, std::uint32_t index) {
    if (index >= values.size() / 2) return std::nullopt;
    const auto i = static_cast<std::size_t>(index) * 2; return Point{values[i], values[i + 1]};
}
}
geometry::GeometryEditorState& GeometryEditor::active() const {
    if (!state_ || !state_->attachment) throw Error(ErrorCode::invalid_state, op, "Geometry editor is valid only during its callback.");
    return *state_;
}
std::string GeometryEditor::attachment_id() const { return active().attachment->attachment_id; }
std::string GeometryEditor::slot_id() const { return active().attachment->slot_id; }
std::uint32_t GeometryEditor::draw_index() const { return active().attachment->draw_index; }
std::uint32_t GeometryEditor::vertex_count() const { return static_cast<std::uint32_t>(active().attachment->world_vertices_xy.size() / 2); }
std::optional<Point> GeometryEditor::position(std::uint32_t index) const { return read(active().attachment->world_vertices_xy, index); }
std::optional<Point> GeometryEditor::uv(std::uint32_t index) const { return read(active().attachment->uvs, index); }
FinalTint GeometryEditor::tint() const { return active().attachment->tint; }
void GeometryEditor::set_position(std::uint32_t index, Point value) {
    auto& s = active(); const auto i = offset(*s.attachment, index); finite_point(value, "x", "y");
    auto& v = s.attachment->world_vertices_xy; v[i] = value.x; v[i + 1] = value.y; ++s.stats->vertex_writes;
}
void GeometryEditor::add_position(std::uint32_t index, Point delta) {
    auto& s = active(); const auto i = offset(*s.attachment, index); finite_point(delta, "deltaX", "deltaY");
    auto& v = s.attachment->world_vertices_xy; v[i] += delta.x; v[i + 1] += delta.y; ++s.stats->vertex_writes;
}
void GeometryEditor::set_uv(std::uint32_t index, Point value) {
    auto& s = active(); const auto i = offset(*s.attachment, index); finite_point(value, "u", "v");
    auto& v = s.attachment->uvs; v[i] = value.x; v[i + 1] = value.y; ++s.stats->uv_writes;
}
void GeometryEditor::set_light_tint(std::array<std::uint8_t, 3> rgb, float alpha) {
    auto& s = active();
    if (!std::isfinite(alpha) || alpha < 0 || alpha > 1) throw Error(ErrorCode::invalid_argument, op, "Tint alpha must be finite and in [0,1].", "alpha", s.attachment->attachment_id);
    s.attachment->tint.light = rgb; s.attachment->tint.alpha = alpha; ++s.stats->tint_writes;
}
void GeometryEditor::set_dark_tint(std::array<std::uint8_t, 3> rgb) {
    auto& s = active(); s.attachment->tint.dark = rgb; ++s.stats->tint_writes;
}
void GeometryEditor::clear_dark_tint() { auto& s = active(); s.attachment->tint.dark.reset(); ++s.stats->tint_writes; }
}
