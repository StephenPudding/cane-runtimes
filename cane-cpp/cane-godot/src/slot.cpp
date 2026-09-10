#include "slot.hpp"
#include "skeleton.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
CaneSlot2D::CaneSlot2D() { set_notify_local_transform(true); }
CaneSlot2D::~CaneSlot2D() { detach_projection(true); }
void CaneSlot2D::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("set_slot_id", "id"), &CaneSlot2D::set_slot_id);
    ClassDB::bind_method(D_METHOD("get_slot_id"), &CaneSlot2D::get_slot_id);
    ClassDB::bind_method(D_METHOD("set_draw_before", "before"), &CaneSlot2D::set_draw_before);
    ClassDB::bind_method(D_METHOD("is_draw_before"), &CaneSlot2D::is_draw_before);
    ClassDB::bind_method(D_METHOD("set_hide_when_empty", "hide"), &CaneSlot2D::set_hide_when_empty);
    ClassDB::bind_method(D_METHOD("is_hide_when_empty"), &CaneSlot2D::is_hide_when_empty);
    ClassDB::bind_method(D_METHOD("set_follow_enabled", "enabled"), &CaneSlot2D::set_follow_enabled);
    ClassDB::bind_method(D_METHOD("is_follow_enabled"), &CaneSlot2D::is_follow_enabled);
    ClassDB::bind_method(D_METHOD("set_offset_transform", "transform"), &CaneSlot2D::set_offset_transform);
    ClassDB::bind_method(D_METHOD("get_offset_transform"), &CaneSlot2D::get_offset_transform);
    ClassDB::bind_method(D_METHOD("is_resolved"), &CaneSlot2D::is_resolved);
    ClassDB::bind_method(D_METHOD("get_slot_state"), &CaneSlot2D::get_slot_state);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneSlot2D::get_last_error);
    ClassDB::bind_method(D_METHOD("refresh_follow"), &CaneSlot2D::refresh_follow);
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::STRING, "slot_id"), "set_slot_id", "get_slot_id");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "draw_before"), "set_draw_before", "is_draw_before");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "hide_when_empty"), "set_hide_when_empty", "is_hide_when_empty");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::BOOL, "follow_enabled"), "set_follow_enabled", "is_follow_enabled");
    ADD_PROPERTY(godot::PropertyInfo(godot::Variant::TRANSFORM2D, "offset_transform"), "set_offset_transform", "get_offset_transform");
}
void CaneSlot2D::set_slot_id(const godot::String& value) { if (!updating_) { slot_id_ = text(value); (void)refresh_follow(); } }
godot::String CaneSlot2D::get_slot_id() const { return text(slot_id_); }
void CaneSlot2D::set_draw_before(bool value) { if (!updating_) { before_ = value; (void)refresh_follow(); } }
void CaneSlot2D::set_hide_when_empty(bool value) { if (!updating_) { hide_empty_ = value; (void)refresh_follow(); } }
void CaneSlot2D::set_follow_enabled(bool value) { if (!updating_) { enabled_ = value; (void)refresh_follow(); } }
void CaneSlot2D::set_offset_transform(const godot::Transform2D& value) {
    if (updating_) return;
    if (!value.is_finite()) { last_error_ = error(cane::Error(cane::ErrorCode::non_finite, "godotSlot", "Slot offset must be finite.", "offset_transform")); return; }
    offset_ = value; (void)refresh_follow();
}
void CaneSlot2D::detach_projection(bool release) {
    auto* server = godot::RenderingServer::get_singleton();
    if (!server || !anchor_.is_valid()) return;
    if (release) {
        server->canvas_item_set_parent(get_canvas_item(), {});
        server->free_rid(anchor_); anchor_ = {};
    } else {
        auto* parent = godot::Object::cast_to<godot::CanvasItem>(get_parent());
        server->canvas_item_set_parent(anchor_, parent ? parent->get_canvas_item() : godot::RID());
    }
}
bool CaneSlot2D::refresh_follow() {
    if (updating_) return resolved_;
    if (!is_inside_tree()) { resolved_ = false; return false; }
    if (auto* source = godot::Object::cast_to<CaneSkeleton>(get_parent())) source->sync_slot_nodes();
    else {
        resolved_ = false; slot_state_.clear(); set_visible(false); detach_projection();
        last_error_ = error(cane::Error(cane::ErrorCode::invalid_argument, "godotSlot", "CaneSlot2D must be a direct child of CaneSkeleton.", "parent"));
    }
    return resolved_;
}
void CaneSlot2D::project(CaneSkeleton& source, const cane::SlotState* state) {
    if (updating_ || !is_inside_tree()) return;
    updating_ = true; resolved_ = false; slot_state_.clear();
    try {
        if (!enabled_) { set_visible(false); detach_projection(); last_error_.clear(); updating_ = false; return; }
        if (!source.bone_follow_source_available() || !source.native_player()) throw cane::Error(cane::ErrorCode::missing_reference, "godotSlot", "No loaded source skeleton is available.", "skeleton_data");
        if (!state) throw cane::Error(cane::ErrorCode::not_found, "godotSlot", "The published Slot does not exist.", "slot_id", slot_id_);
        require(!is_set_as_top_level() && get_z_index() == 0 && is_z_relative() && !is_draw_behind_parent_enabled() && !source.is_y_sort_enabled(),
            "Slot insertion requires relative Z zero, ordinary parent inheritance and disabled source Y sorting.", "canvas_order");
        const auto bone = source.native_player()->query_slot_bone_pose(slot_id_); const auto& m = bone.matrix;
        const auto transform = godot::Transform2D({m.a, -m.b}, {-m.c, m.d}, {m.tx, -m.ty}) * offset_;
        if (!transform.is_finite()) throw cane::Error(cane::ErrorCode::non_finite, "godotSlot", "Slot transform exceeds finite engine coordinates.", "transform", slot_id_);
        auto* server = godot::RenderingServer::get_singleton();
        if (!anchor_.is_valid()) anchor_ = server->canvas_item_create();
        server->canvas_item_set_parent(get_canvas_item(), anchor_);
        if (get_transform() != transform) set_transform(transform);
        slot_state_["slot_id"] = text(state->slot_id); slot_state_["draw_index"] = state->draw_index;
        slot_state_["attachment_key"] = state->attachment_key ? godot::Variant(text(*state->attachment_key)) : godot::Variant();
        slot_state_["attachment_id"] = state->attachment_id ? godot::Variant(text(*state->attachment_id)) : godot::Variant();
        // Expose Core's sampled tint without approximating two-color tint on host content.
        godot::PackedInt32Array light; for (auto c : state->tint.light) light.push_back(c); slot_state_["light_rgb"] = light;
        godot::PackedInt32Array dark; if (state->tint.dark) for (auto c : *state->tint.dark) dark.push_back(c);
        slot_state_["dark_rgb"] = state->tint.dark ? godot::Variant(dark) : godot::Variant(); slot_state_["alpha"] = state->tint.alpha;
        set_visible(bone.active && (!hide_empty_ || state->attachment_id.has_value()));
        resolved_ = true; last_error_.clear();
    } catch (const std::exception& failure) { last_error_ = error(failure); set_visible(false); detach_projection(); }
    updating_ = false;
}
void CaneSlot2D::_notification(int what) {
    if (what == NOTIFICATION_EXIT_TREE) { resolved_ = false; slot_state_.clear(); detach_projection(true); }
    else if (what == NOTIFICATION_ENTER_TREE || what == NOTIFICATION_ENTER_CANVAS || what == NOTIFICATION_LOCAL_TRANSFORM_CHANGED) (void)refresh_follow();
}
}
