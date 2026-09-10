#include "skeleton.hpp"
#include "follower.hpp"
#include <godot_cpp/core/object.hpp>
#include <algorithm>

namespace cane_godot {
void CaneSkeleton::register_pose_follower(std::uint64_t id) {
    if (std::find(pose_followers_.begin(), pose_followers_.end(), id) == pose_followers_.end()) pose_followers_.push_back(id);
}
void CaneSkeleton::unregister_pose_follower(std::uint64_t id) {
    for (auto& entry : pose_followers_) if (entry == id) entry = 0;
    if (!syncing_followers_) pose_followers_.erase(std::remove(pose_followers_.begin(), pose_followers_.end(), 0), pose_followers_.end());
}
void CaneSkeleton::sync_pose_followers() {
    if (syncing_followers_) return;
    syncing_followers_ = true;
    // IDs, indexed access and tombstones allow callbacks to free/rebind followers without invalidating iteration.
    const auto count = pose_followers_.size();
    for (std::size_t i = 0; i < count; ++i) {
        const auto id = pose_followers_[i];
        auto* follower = id ? godot::Object::cast_to<CaneFollower2D>(godot::ObjectDB::get_instance(id)) : nullptr;
        if (follower) (void)follower->refresh_follow(); else pose_followers_[i] = 0;
    }
    pose_followers_.erase(std::remove(pose_followers_.begin(), pose_followers_.end(), 0), pose_followers_.end());
    syncing_followers_ = false;
}
}
