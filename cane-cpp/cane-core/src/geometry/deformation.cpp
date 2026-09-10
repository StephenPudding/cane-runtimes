#include "deformation.hpp"

namespace cane::geometry {
namespace {
Point checked(Point value, const char* op, std::string_view id, const char* field) {
    if (!std::isfinite(value.x) || !std::isfinite(value.y))
        throw Error(ErrorCode::non_finite, op, "Vertex deformation must remain finite.", field, std::string(id));
    return value;
}
Point influence_delta(const detail::Influence& influence, Point delta) {
    return influence.bind_inverse ? influence.bind_inverse->transform_direction(delta) : delta;
}
}
void positions_to_offsets(const detail::VertexDefinition& g, const float* positions, float* offsets,
                          const char* op, std::string_view id, const char* field) {
    for (std::size_t i = 0; i < g.positions.size() / 2; ++i) {
        const auto delta = checked({positions[2 * i] - g.positions[2 * i], positions[2 * i + 1] - g.positions[2 * i + 1]}, op, id, field);
        for (std::size_t j = g.influence_starts[i]; j < g.influence_starts[i + 1]; ++j) {
            const auto value = checked(influence_delta(g.influences[j], delta), op, id, field);
            offsets[2 * j] = value.x; offsets[2 * j + 1] = value.y;
        }
    }
}
VertexSource::VertexSource(const animation::Pose& pose, std::size_t index, const char* op) : pose_(pose), index_(index), operation_(op) {
    const auto kind = attachment().kind;
    if (kind == detail::AttachmentKind::region || kind == detail::AttachmentKind::point)
        throw Error(ErrorCode::invalid_argument, op, "Attachment has no source vertices.", "attachmentId", id());
}
const detail::AttachmentDefinition& VertexSource::attachment() const { return pose_.model().attachments.at(index_); }
const detail::VertexDefinition& VertexSource::geometry() const { return pose_.model().attachments[attachment().geometry_owner].geometry; }
const std::string& VertexSource::id() const { return pose_.data().catalog(RuntimeCatalogKind::attachment)[index_].id; }
void VertexSource::check(Point value, const char* field) const { (void)checked(value, operation_, id(), field); }
void VertexSource::validate_space(VertexDeformSpace space, const char* field) const {
    if (space != VertexDeformSpace::vertex_positions && space != VertexDeformSpace::weighted_influence_offsets)
        throw Error(ErrorCode::invalid_argument, operation_, "Unknown vertex deform space.", field, id());
    if (space == VertexDeformSpace::weighted_influence_offsets && !geometry().weighted())
        throw Error(ErrorCode::invalid_argument, operation_, "Unweighted geometry has no influence offsets.", field, id());
}
void VertexSource::validate_values(VertexDeformSpace space, const std::vector<float>& values, const char* field) const {
    validate_space(space, "space");
    const auto count = space == VertexDeformSpace::vertex_positions ? geometry().positions.size() : geometry().deform_components();
    if (values.size() != count) throw Error(ErrorCode::invalid_argument, operation_, "Deform buffer must match the complete source geometry.", field, id());
    for (const auto value : values) check({value, 0}, field);
}
void VertexSource::validate_vertex(std::uint32_t vertex) const {
    if (vertex >= geometry().positions.size() / 2)
        throw Error(ErrorCode::invalid_argument, operation_, "Source vertex index is outside the attachment.", "sourceVertexIndex", id());
}
std::vector<float> VertexSource::canonical(VertexDeformSpace space, const std::vector<float>& values, const char* field) const {
    validate_values(space, values, field);
    if (!geometry().weighted() || space == VertexDeformSpace::weighted_influence_offsets) return values;
    std::vector<float> result(geometry().deform_components());
    positions_to_offsets(geometry(), values.data(), result.data(), operation_, id(), field); return result;
}
std::vector<float> VertexSource::current(VertexDeformSpace space) const {
    validate_space(space, "space");
    const auto& deform = pose_.deforms[attachment().deform_owner];
    if (!geometry().weighted()) return deform.enabled ? deform.values : geometry().positions;
    std::vector<float> result = deform.enabled ? deform.values : std::vector<float>(geometry().deform_components());
    return space == VertexDeformSpace::vertex_positions ? positions(result) : result;
}
Point VertexSource::inverse_delta(const Affine& matrix, Point delta, const char* field) const {
    check(delta, field);
    const auto determinant = matrix.determinant();
    if (!std::isfinite(determinant) || determinant == 0)
        throw Error(ErrorCode::invalid_state, operation_, "Vertex projection is singular or unavailable.", field, id());
    // Direct division preserves tiny nonzero determinants without an overflowing reciprocal.
    const Point result{(matrix.d * delta.x - matrix.c * delta.y) / determinant,
                       (-matrix.b * delta.x + matrix.a * delta.y) / determinant};
    check(result, field); return result;
}
std::vector<float> VertexSource::positions(const std::vector<float>& offsets) const {
    validate_values(VertexDeformSpace::weighted_influence_offsets, offsets, "values");
    const auto& g = geometry(); std::vector<float> result(g.positions.size());
    for (std::size_t i = 0; i < result.size() / 2; ++i) {
        Point sum{}; float total = 0;
        for (std::size_t j = g.influence_starts[i]; j < g.influence_starts[i + 1]; ++j) {
            const auto& influence = g.influences[j]; if (influence.weight == 0) continue;
            Point delta{offsets[2 * j], offsets[2 * j + 1]};
            if (influence.bind_inverse) delta = inverse_delta(*influence.bind_inverse, delta, "values");
            sum.x += delta.x * influence.weight; sum.y += delta.y * influence.weight; total += influence.weight;
        }
        if (!std::isfinite(total) || total <= matrix_epsilon)
            throw Error(ErrorCode::invalid_state, operation_, "Weighted position has no usable influences.", "values", id());
        const Point value{g.positions[2 * i] + sum.x / total, g.positions[2 * i + 1] + sum.y / total};
        check(value, "values"); result[2 * i] = value.x; result[2 * i + 1] = value.y;
    }
    return result;
}
std::vector<float> VertexSource::world(const std::vector<float>* deform) const {
    std::vector<float> result; pose_.source_vertices(index_, result, deform); return result;
}
Affine VertexSource::world_linear(std::size_t vertex) const {
    const auto& g = geometry();
    if (!g.weighted()) return pose_.world[pose_.model().slots[attachment().slot].bone];
    Affine sum{0, 0, 0, 0, 0, 0}; float total = 0;
    for (std::size_t j = g.influence_starts[vertex]; j < g.influence_starts[vertex + 1]; ++j) {
        const auto& influence = g.influences[j]; if (influence.weight == 0) continue;
        auto matrix = pose_.world[influence.bone];
        if (influence.bind_inverse) {
            // Only the linear mapping participates; unused translations must not overflow.
            matrix.tx = matrix.ty = 0; auto bind = *influence.bind_inverse; bind.tx = bind.ty = 0; matrix = matrix * bind;
        }
        sum.a += matrix.a * influence.weight; sum.b += matrix.b * influence.weight;
        sum.c += matrix.c * influence.weight; sum.d += matrix.d * influence.weight; total += influence.weight;
    }
    if (!std::isfinite(total) || total <= matrix_epsilon)
        throw Error(ErrorCode::invalid_state, operation_, "Geometry has no usable influences.", "targetWorld", id());
    return {sum.a / total, sum.b / total, sum.c / total, sum.d / total, 0, 0};
}
Point VertexSource::position_for_target(std::size_t vertex, Point target, const std::vector<float>& setup_world) const {
    const auto delta = inverse_delta(world_linear(vertex), {target.x - setup_world[2 * vertex], target.y - setup_world[2 * vertex + 1]}, "targetWorld");
    const Point result{geometry().positions[2 * vertex] + delta.x, geometry().positions[2 * vertex + 1] + delta.y};
    check(result, "targetWorld"); return result;
}
void VertexSource::write_offsets_for_target(std::size_t vertex, Point target, const std::vector<float>& current_world, std::vector<float>& offsets) const {
    const auto delta = inverse_delta(world_linear(vertex), {target.x - current_world[2 * vertex], target.y - current_world[2 * vertex + 1]}, "targetWorld");
    const auto& g = geometry();
    for (std::size_t j = g.influence_starts[vertex]; j < g.influence_starts[vertex + 1]; ++j) {
        const auto change = influence_delta(g.influences[j], delta);
        const Point result{offsets[2 * j] + change.x, offsets[2 * j + 1] + change.y};
        check(result, "targetWorld"); offsets[2 * j] = result.x; offsets[2 * j + 1] = result.y;
    }
}
std::vector<Point> VertexSource::weight_local_for_target(std::size_t vertex, Point target) const {
    const auto& g = geometry();
    if (!g.weighted() || g.influence_starts[vertex] == g.influence_starts[vertex + 1])
        throw Error(ErrorCode::invalid_argument, operation_, "Source vertex has no weight influences.", "sourceVertexIndex", id());
    std::vector<Point> result; result.reserve(g.influence_starts[vertex + 1] - g.influence_starts[vertex]);
    for (std::size_t j = g.influence_starts[vertex]; j < g.influence_starts[vertex + 1]; ++j) {
        const auto& matrix = pose_.world[g.influences[j].bone];
        result.push_back(inverse_delta(matrix, {target.x - matrix.tx, target.y - matrix.ty}, "targetWorld"));
    }
    return result;
}
std::vector<float> VertexSource::offsets_after_edit(const std::vector<float>& current, const std::vector<float>& before, const std::vector<float>& after) const {
    validate_values(VertexDeformSpace::weighted_influence_offsets, current, "currentWeightedOffsets");
    validate_values(VertexDeformSpace::vertex_positions, before, "beforePositions");
    validate_values(VertexDeformSpace::vertex_positions, after, "afterPositions");
    const auto& g = geometry(); auto result = current;
    for (std::size_t i = 0; i < g.positions.size() / 2; ++i) {
        const Point delta{after[2 * i] - before[2 * i], after[2 * i + 1] - before[2 * i + 1]}; check(delta, "afterPositions");
        for (std::size_t j = g.influence_starts[i]; j < g.influence_starts[i + 1]; ++j) {
            const auto change = influence_delta(g.influences[j], delta);
            const Point value{current[2 * j] + change.x, current[2 * j + 1] + change.y}; check(value, "afterPositions");
            result[2 * j] = value.x; result[2 * j + 1] = value.y;
        }
    }
    return result;
}
}
