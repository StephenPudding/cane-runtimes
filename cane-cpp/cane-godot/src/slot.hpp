#pragma once
#include <godot_cpp/classes/node2d.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <cane/pose_queries.hpp>
#include <string>

namespace cane_godot {
class CaneSkeleton;
// Direct-child scene node with a private identity RID anchor. Engine scene-order
// refreshes affect the node below that anchor, never the packet insertion index.
class CaneSlot2D : public godot::Node2D {
    GDCLASS(CaneSlot2D, godot::Node2D)
    std::string slot_id_;
    godot::Transform2D offset_;
    godot::RID anchor_;
    godot::Dictionary last_error_, slot_state_;
    bool before_ = false, hide_empty_ = true, enabled_ = true, resolved_ = false, updating_ = false;
protected:
    static void _bind_methods();
    void _notification(int what);
public:
    CaneSlot2D();
    ~CaneSlot2D() override;
    void set_slot_id(const godot::String& value);
    godot::String get_slot_id() const;
    void set_draw_before(bool value);
    bool is_draw_before() const { return before_; }
    void set_hide_when_empty(bool value);
    bool is_hide_when_empty() const { return hide_empty_; }
    void set_follow_enabled(bool value);
    bool is_follow_enabled() const { return enabled_; }
    void set_offset_transform(const godot::Transform2D& value);
    godot::Transform2D get_offset_transform() const { return offset_; }
    bool is_resolved() const { return resolved_; }
    godot::Dictionary get_slot_state() const { return slot_state_.duplicate(true); }
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
    bool refresh_follow();
    const std::string& native_slot_id() const { return slot_id_; }
    godot::RID native_anchor() const { return anchor_; }
    void project(CaneSkeleton& source, const cane::SlotState* state);
    void detach_projection(bool release = false);
};
}
