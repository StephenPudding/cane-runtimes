#include "bone.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <algorithm>

namespace cane_godot {
void CaneBone2D::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_bone_id", "id"), &CaneBone2D::set_bone_id);
    ClassDB::bind_method(D_METHOD("get_bone_id"), &CaneBone2D::get_bone_id);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::STRING, "bone_id"), "set_bone_id", "get_bone_id");
}
void CaneBone2D::set_bone_id(const godot::String& value) {
    if (!writable()) return;
    bone_id_ = text(value); bone_index_ = std::numeric_limits<std::size_t>::max(); (void)refresh_follow();
}
godot::String CaneBone2D::get_bone_id() const { return text(bone_id_); }
FollowerTarget CaneBone2D::read_target(const cane::RuntimePlayer& player) {
    const auto frame = player.frame(); const auto& bones = frame.bones();
    if (bone_index_ >= bones.size() || bones[bone_index_].bone_id != bone_id_) {
        const auto found = std::find_if(bones.begin(), bones.end(), [&](const cane::BonePose& bone) { return bone.bone_id == bone_id_; });
        if (found == bones.end()) throw cane::Error(cane::ErrorCode::not_found, operation_id(), "The published bone does not exist.", "bone_id", bone_id_);
        bone_index_ = static_cast<std::size_t>(found - bones.begin());
    }
    const auto& bone = bones[bone_index_]; return {bone.matrix, bone.active};
}
}
