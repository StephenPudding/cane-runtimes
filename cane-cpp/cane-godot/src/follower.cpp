#include "follower.hpp"
#include "skeleton.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/object.hpp>
#include <optional>
#include <cmath>

namespace cane_godot {
namespace {
struct BusyGuard {
    bool& flag; bool previous;
    explicit BusyGuard(bool& value) : flag(value), previous(value) { flag = true; }
    ~BusyGuard() { flag = previous; }
};
CaneSkeleton* skeleton_instance(std::uint64_t id) {
    return id ? godot::Object::cast_to<CaneSkeleton>(godot::ObjectDB::get_instance(id)) : nullptr;
}
}
CaneFollower2D::CaneFollower2D() { set_notify_transform(true); set_notify_local_transform(true); set_process(false); }
CaneFollower2D::~CaneFollower2D() { disconnect_source(); }
void CaneFollower2D::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_skeleton_path", "path"), &CaneFollower2D::set_skeleton_path);
    ClassDB::bind_method(D_METHOD("get_skeleton_path"), &CaneFollower2D::get_skeleton_path);
    ClassDB::bind_method(D_METHOD("set_offset_transform", "transform"), &CaneFollower2D::set_offset_transform);
    ClassDB::bind_method(D_METHOD("get_offset_transform"), &CaneFollower2D::get_offset_transform);
    ClassDB::bind_method(D_METHOD("set_follow_enabled", "enabled"), &CaneFollower2D::set_follow_enabled);
    ClassDB::bind_method(D_METHOD("is_follow_enabled"), &CaneFollower2D::is_follow_enabled);
    ClassDB::bind_method(D_METHOD("set_follow_visibility", "enabled"), &CaneFollower2D::set_follow_visibility);
    ClassDB::bind_method(D_METHOD("is_follow_visibility"), &CaneFollower2D::is_follow_visibility);
    ClassDB::bind_method(D_METHOD("is_resolved"), &CaneFollower2D::is_resolved);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneFollower2D::get_last_error);
    ClassDB::bind_method(D_METHOD("refresh_follow"), &CaneFollower2D::refresh_follow);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::NODE_PATH, "skeleton_path", godot::PROPERTY_HINT_NODE_PATH_VALID_TYPES, "CaneSkeleton"), "set_skeleton_path", "get_skeleton_path");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::TRANSFORM2D, "offset_transform"), "set_offset_transform", "get_offset_transform");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "follow_enabled"), "set_follow_enabled", "is_follow_enabled");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "follow_visibility"), "set_follow_visibility", "is_follow_visibility");
    ADD_SIGNAL(godot::MethodInfo("binding_changed", godot::PropertyInfo(godot::Variant::BOOL, "resolved")));
    ADD_SIGNAL(godot::MethodInfo("follow_error", godot::PropertyInfo(godot::Variant::DICTIONARY, "details")));
}
bool CaneFollower2D::writable() {
    if (!updating_) return true;
    set_error(last_error_, cane::Error(cane::ErrorCode::invalid_state, operation_id(), "Reentrant follower mutation.")); return false;
}
void CaneFollower2D::disconnect_source() {
    if (auto* source = skeleton_instance(source_id_)) source->unregister_pose_follower(get_instance_id());
    source_id_ = 0;
}
CaneSkeleton* CaneFollower2D::resolve_source() {
    if (auto* cached = skeleton_instance(source_id_); cached && cached->follow_source_available()) {
        if (is_ancestor_of(cached))
            throw cane::Error(cane::ErrorCode::invalid_argument, operation_id(), "A follower cannot move an ancestor of its source skeleton.", "skeleton_path");
        return cached;
    }
    CaneSkeleton* source = nullptr;
    if (skeleton_path_.is_empty()) {
        for (auto* node = get_parent(); node && !source; node = node->get_parent()) source = godot::Object::cast_to<CaneSkeleton>(node);
    } else source = godot::Object::cast_to<CaneSkeleton>(get_node_or_null(skeleton_path_));
    if (source && is_ancestor_of(source))
        throw cane::Error(cane::ErrorCode::invalid_argument, operation_id(), "A follower cannot move an ancestor of its source skeleton.", "skeleton_path");
    const std::uint64_t id = source ? source->get_instance_id() : 0;
    if (id != source_id_) {
        disconnect_source();
        if (source) { source->register_pose_follower(get_instance_id()); source_id_ = id; }
    }
    return source;
}
void CaneFollower2D::set_skeleton_path(const godot::NodePath& value) {
    if (!writable()) return;
    disconnect_source(); skeleton_path_ = value; (void)refresh_follow();
}
void CaneFollower2D::set_offset_transform(const godot::Transform2D& value) {
    if (!writable()) return;
    if (!value.is_finite()) {
        set_error(last_error_, cane::Error(cane::ErrorCode::non_finite, operation_id(), "Follower offset must be finite.", "offset_transform"));
        emit_signal("follow_error", last_error_.duplicate(true)); return;
    }
    offset_ = value; (void)refresh_follow();
}
void CaneFollower2D::set_follow_enabled(bool value) {
    if (!writable()) return;
    enabled_ = value; (void)refresh_follow();
}
void CaneFollower2D::set_follow_visibility(bool value) {
    if (!writable()) return;
    follow_visibility_ = value; (void)refresh_follow();
}
bool CaneFollower2D::refresh_follow() {
    if (updating_) return resolved_;
    if (!is_inside_tree()) { resolved_ = false; return false; }
    updating_ = true;
    std::optional<BusyGuard> source_guard;
    const bool was_resolved = resolved_;
    resolved_ = false;
    try {
        if (enabled_) {
            auto* source = resolve_source();
            if (!source || !source->follow_source_available() || !source->native_player())
                throw cane::Error(cane::ErrorCode::missing_reference, operation_id(), "No active loaded source skeleton is available.", "skeleton_path");
            source_guard.emplace(source->busy_);
            require(get_canvas() == source->get_canvas(), "Follower and skeleton must belong to the same canvas.", "skeleton_path");
            const auto target = read_target(*source->native_player()); const auto& m = target.matrix;
            const godot::Transform2D local = godot::Transform2D({m.a, -m.b}, {-m.c, m.d}, {m.tx, -m.ty}) * offset_;
            auto* parent = is_set_as_top_level() ? nullptr : godot::Object::cast_to<godot::CanvasItem>(get_parent());
            godot::Transform2D transform = local;
            if (parent != source) {
                transform = source->get_global_transform() * local;
                if (parent) {
                    const auto parent_transform = parent->get_global_transform();
                    const auto determinant = parent_transform.determinant();
                    if (!parent_transform.is_finite() || !std::isfinite(determinant) || determinant == 0)
                        throw cane::Error(cane::ErrorCode::invalid_state, operation_id(), "The follower parent transform cannot be inverted.", "parent.transform", target_id());
                    transform = parent_transform.affine_inverse() * transform;
                }
            }
            if (!transform.is_finite()) throw cane::Error(cane::ErrorCode::non_finite, operation_id(), "Follower transform exceeds finite engine coordinates.", "transform", target_id());
            if (get_transform() != transform) set_transform(transform);
            if (follow_visibility_) set_visible(target.active && source->is_visible_in_tree());
            resolved_ = true; last_error_.clear();
        }
    } catch (const std::exception& failure) {
        const auto details = error(failure);
        const bool changed = last_error_ != details; last_error_ = details;
        if (follow_visibility_) set_visible(false);
        if (changed) emit_signal("follow_error", last_error_.duplicate(true));
    }
    // Bound followers are updated by source publication/transform notifications, not a second per-frame solver.
    set_process(enabled_ && !resolved_);
    if (was_resolved != resolved_) emit_signal("binding_changed", resolved_);
    updating_ = false; return resolved_;
}
void CaneFollower2D::_process(double) { (void)refresh_follow(); }
void CaneFollower2D::_notification(int what) {
    if (what == NOTIFICATION_EXIT_TREE) { disconnect_source(); resolved_ = false; set_process(false); }
    else if (what == NOTIFICATION_ENTER_TREE || what == NOTIFICATION_TRANSFORM_CHANGED || what == NOTIFICATION_LOCAL_TRANSFORM_CHANGED)
        (void)refresh_follow();
}
}
