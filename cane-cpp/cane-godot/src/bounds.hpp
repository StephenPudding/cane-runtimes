#pragma once
#include <cane/runtime_player.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <functional>

namespace cane_godot {
class CaneBounds : public godot::RefCounted {
    GDCLASS(CaneBounds, godot::RefCounted)
    friend class CaneSkeleton;
    cane::RuntimeBounds bounds_;
    cane::BoundsHitBuffer hits_;
    godot::Dictionary last_error_;
    bool query(const std::function<void()>& action);
    void write(const cane::RuntimePlayer& player, const cane::BoundsOptions& options);
protected:
    static void _bind_methods();
public:
    godot::Dictionary get_snapshot();
    godot::Dictionary get_aabb();
    godot::Array get_polygons();
    godot::Dictionary get_polygon(const godot::String& attachment_id);
    std::int64_t get_frame_sequence() const { return static_cast<std::int64_t>(bounds_.frame_sequence()); }
    godot::Dictionary contains_point(const godot::Vector2& core_point);
    godot::Dictionary intersects_segment(const godot::Vector2& core_start, const godot::Vector2& core_end);
    godot::Variant get_point_hits(const godot::Vector2& core_point);
    godot::Variant get_segment_hits(const godot::Vector2& core_start, const godot::Vector2& core_end);
    godot::Variant aabb_contains_point(const godot::Vector2& core_point);
    godot::Variant aabb_intersects_segment(const godot::Vector2& core_start, const godot::Vector2& core_end);
    godot::Variant aabb_intersects_bounds(const godot::Ref<CaneBounds>& other);
    godot::Variant intersects_bounds(const godot::Ref<CaneBounds>& other);
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
};
}
