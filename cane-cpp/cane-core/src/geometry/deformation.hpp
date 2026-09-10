#pragma once
#include "animation/pose.hpp"
#include "cane/vertex_geometry.hpp"

namespace cane::geometry {
// Shared by animation sampling and host geometry edits. Caller owns exact-sized buffers.
void positions_to_offsets(const detail::VertexDefinition& geometry, const float* positions, float* offsets,
                          const char* operation, std::string_view id, const char* field);

// Reads a published pose and performs geometry math only; never samples or changes the pose.
class VertexSource {
    const animation::Pose& pose_;
    std::size_t index_;
    const char* operation_;
    [[nodiscard]] Point inverse_delta(const Affine& matrix, Point delta, const char* field) const;
    [[nodiscard]] Affine world_linear(std::size_t vertex) const;
public:
    VertexSource(const animation::Pose& pose, std::size_t index, const char* operation);
    [[nodiscard]] const detail::AttachmentDefinition& attachment() const;
    [[nodiscard]] const detail::VertexDefinition& geometry() const;
    [[nodiscard]] const std::string& id() const;
    void check(Point value, const char* field) const;
    void validate_space(VertexDeformSpace space, const char* field) const;
    void validate_values(VertexDeformSpace space, const std::vector<float>& values, const char* field) const;
    void validate_vertex(std::uint32_t vertex) const;
    [[nodiscard]] std::vector<float> canonical(VertexDeformSpace space, const std::vector<float>& values, const char* field) const;
    [[nodiscard]] std::vector<float> current(VertexDeformSpace space) const;
    [[nodiscard]] std::vector<float> positions(const std::vector<float>& offsets) const;
    [[nodiscard]] std::vector<float> world(const std::vector<float>* canonical_deform) const;
    [[nodiscard]] Point position_for_target(std::size_t vertex, Point target, const std::vector<float>& setup_world) const;
    void write_offsets_for_target(std::size_t vertex, Point target, const std::vector<float>& current_world, std::vector<float>& offsets) const;
    [[nodiscard]] std::vector<Point> weight_local_for_target(std::size_t vertex, Point target) const;
    [[nodiscard]] std::vector<float> offsets_after_edit(const std::vector<float>& current, const std::vector<float>& before, const std::vector<float>& after) const;
};
}
