#pragma once
#include "follower.hpp"

namespace cane_godot {
class CanePoint2D : public CaneFollower2D {
    GDCLASS(CanePoint2D, CaneFollower2D)
    std::string attachment_id_;
    bool require_selected_ = false;
protected:
    static void _bind_methods();
    FollowerTarget read_target(const cane::RuntimePlayer& player) override;
    const char* operation_id() const override { return "godotPointFollower"; }
    const std::string& target_id() const override { return attachment_id_; }
public:
    void set_attachment_id(const godot::String& value);
    godot::String get_attachment_id() const;
    void set_require_selected(bool value);
    bool is_require_selected() const { return require_selected_; }
};
}
