#pragma once
#include "follower.hpp"
#include <limits>

namespace cane_godot {
class CaneBone2D : public CaneFollower2D {
    GDCLASS(CaneBone2D, CaneFollower2D)
    std::string bone_id_;
    std::size_t bone_index_ = std::numeric_limits<std::size_t>::max();
protected:
    static void _bind_methods();
    FollowerTarget read_target(const cane::RuntimePlayer& player) override;
    const char* operation_id() const override { return "godotBoneFollower"; }
    const std::string& target_id() const override { return bone_id_; }
public:
    void set_bone_id(const godot::String& value);
    godot::String get_bone_id() const;
};
}
