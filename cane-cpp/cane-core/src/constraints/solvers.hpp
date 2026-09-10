#pragma once
#include "animation/pose.hpp"
#include "path_sampler.hpp"

namespace cane::constraints {
// Reused per player/workspace, including full CCD fallback and descendant propagation.
struct Workspace {
    std::vector<unsigned char> affected;
    std::vector<float> rotations;
    PathSampler path;
    std::vector<float> path_vertices, path_lengths;
    std::vector<Affine> path_desired;
    std::vector<unsigned char> path_driven;
    explicit Workspace(std::size_t bone_count) : affected(bone_count), rotations(bone_count),
        path_lengths(bone_count), path_desired(bone_count), path_driven(bone_count) {}
};
struct Context {
    animation::Pose& pose;
    const Affine& root;
    Workspace& scratch;
    [[nodiscard]] Affine parent(std::size_t bone) const;
    [[nodiscard]] Affine compose(std::size_t bone, const BoneLocal& local) const;
    void refresh_descendants(std::size_t bone);
    void write_local(std::size_t bone, const BoneLocal& local);
    void set_world(std::size_t bone, const Affine& world);
    void write_world(std::size_t bone, const Affine& world);
};
[[nodiscard]] float x_angle(const Affine& matrix) noexcept;
[[nodiscard]] float y_angle(const Affine& matrix) noexcept;
[[nodiscard]] float x_scale(const Affine& matrix) noexcept;
[[nodiscard]] float y_scale(const Affine& matrix) noexcept;
[[nodiscard]] float world_shear_y(const Affine& matrix) noexcept;
[[nodiscard]] Affine rotate_axes(const Affine& matrix, float degrees) noexcept;
[[nodiscard]] std::optional<BoneLocal> reconstruct_local(const BoneLocal& previous, const Affine& world, const Affine& parent, TransformMode mode);
void solve_ik(Context& context, std::size_t constraint);
void solve_transform(Context& context, std::size_t constraint);
void solve_path(Context& context, std::size_t constraint);
void solve_slider(Context& context, std::size_t constraint, const animation::Sampling& sampling = {});
[[nodiscard]] std::optional<std::array<float, 6>> matched_transform_offsets(const Context& context, std::size_t constraint, ErrorCode* failure_code = nullptr);
}
