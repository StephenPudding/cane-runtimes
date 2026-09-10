#include "point.hpp"
#include "bridge.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
void CanePoint2D::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_attachment_id", "id"), &CanePoint2D::set_attachment_id);
    ClassDB::bind_method(D_METHOD("get_attachment_id"), &CanePoint2D::get_attachment_id);
    ClassDB::bind_method(D_METHOD("set_require_selected", "selected"), &CanePoint2D::set_require_selected);
    ClassDB::bind_method(D_METHOD("is_require_selected"), &CanePoint2D::is_require_selected);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::STRING, "attachment_id"), "set_attachment_id", "get_attachment_id");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "require_selected"), "set_require_selected", "is_require_selected");
}
void CanePoint2D::set_attachment_id(const godot::String& value) { if (writable()) { attachment_id_ = text(value); (void)refresh_follow(); } }
godot::String CanePoint2D::get_attachment_id() const { return text(attachment_id_); }
void CanePoint2D::set_require_selected(bool value) { if (writable()) { require_selected_ = value; (void)refresh_follow(); } }
FollowerTarget CanePoint2D::read_target(const cane::RuntimePlayer& player) {
    const auto point = player.query_point_attachment_pose(attachment_id_);
    return {point.matrix, point.active && (!require_selected_ || point.selected)};
}
}
