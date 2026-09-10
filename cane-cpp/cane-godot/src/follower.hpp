#pragma once
#include <godot_cpp/classes/node2d.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <cane/runtime_player.hpp>
#include <cstdint>
#include <string>

namespace cane_godot {
class CaneSkeleton;
struct FollowerTarget { cane::Affine matrix; bool active; };
// Common engine-coordinate, source lifetime and scheduling bridge. Derived nodes
// only select an already-published Core target; they never evaluate animation.
class CaneFollower2D : public godot::Node2D {
    GDCLASS(CaneFollower2D, godot::Node2D)
    godot::NodePath skeleton_path_;
    godot::Transform2D offset_;
    godot::Dictionary last_error_;
    std::uint64_t source_id_ = 0;
    bool enabled_ = true, follow_visibility_ = true, resolved_ = false, updating_ = false;
    void disconnect_source();
    CaneSkeleton* resolve_source();
protected:
    static void _bind_methods();
    void _notification(int what);
    bool writable();
    virtual FollowerTarget read_target(const cane::RuntimePlayer& player) = 0;
    virtual const char* operation_id() const = 0;
    virtual const std::string& target_id() const = 0;
public:
    CaneFollower2D();
    ~CaneFollower2D() override;
    void _process(double delta) override;
    void set_skeleton_path(const godot::NodePath& value);
    godot::NodePath get_skeleton_path() const { return skeleton_path_; }
    void set_offset_transform(const godot::Transform2D& value);
    godot::Transform2D get_offset_transform() const { return offset_; }
    void set_follow_enabled(bool value);
    bool is_follow_enabled() const { return enabled_; }
    void set_follow_visibility(bool value);
    bool is_follow_visibility() const { return follow_visibility_; }
    bool is_resolved() const { return resolved_; }
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
    bool refresh_follow();
};
}
