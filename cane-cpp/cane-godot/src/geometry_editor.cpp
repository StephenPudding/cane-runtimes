#include "geometry_editor.hpp"
#include "color_values.hpp"
#include "skeleton.hpp"
#include "script_values.hpp"
#include "constraint_values.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>

namespace cane_godot {
namespace {
cane::Point point_value(const godot::Variant& value, const char* field) {
    require(value.get_type() == godot::Variant::VECTOR2, "Expected a finite Vector2.", field);
    return core_point(static_cast<godot::Vector2>(value), field);
}
std::uint32_t index_value(const godot::Variant& value) {
    require(value.get_type() == godot::Variant::INT, "Expected an integer vertex index.", "vertex_index");
    const auto index = static_cast<std::int64_t>(value);
    require(index >= 0 && index <= std::numeric_limits<std::uint32_t>::max(), "Vertex index is outside uint32.", "vertex_index");
    return static_cast<std::uint32_t>(index);
}
}
std::array<std::uint8_t, 3> rgb_value(const godot::Variant& value) {
    std::array<std::uint8_t, 3> result{};
    if (value.get_type() == godot::Variant::PACKED_BYTE_ARRAY) {
        const godot::PackedByteArray bytes = value;
        require(bytes.size() == 3, "RGB needs three bytes.", "rgb");
        for (std::size_t i = 0; i < 3; ++i) result[i] = bytes[static_cast<std::int64_t>(i)];
    } else {
        require(value.get_type() == godot::Variant::ARRAY, "RGB needs PackedByteArray or Array of three byte integers.", "rgb");
        const godot::Array bytes = value; require(bytes.size() == 3, "RGB needs three bytes.", "rgb");
        for (std::size_t i = 0; i < 3; ++i) {
            const auto channel = bytes[static_cast<std::int64_t>(i)];
            require(channel.get_type() == godot::Variant::INT, "RGB channels must be integer bytes.", "rgb");
            const auto byte = static_cast<std::int64_t>(channel); require(byte >= 0 && byte <= 255, "RGB channel is outside byte range.", "rgb");
            result[i] = static_cast<std::uint8_t>(byte);
        }
    }
    return result;
}
godot::PackedByteArray rgb_bytes(const std::array<std::uint8_t, 3>& rgb) {
    godot::PackedByteArray result; result.resize(3); std::copy(rgb.begin(), rgb.end(), result.ptrw()); return result;
}
godot::Dictionary tint_value(const cane::FinalTint& tint) {
    godot::Dictionary result; result["light"] = rgb_bytes(tint.light); result["alpha"] = tint.alpha;
    result["dark"] = tint.dark ? godot::Variant(rgb_bytes(*tint.dark)) : godot::Variant(); return result;
}
cane::FinalTint tint_input(const godot::Dictionary& values) {
    fields(values, {"light", "dark", "alpha"}); cane::FinalTint result;
    if (values.has("light")) result.light = rgb_value(values["light"]);
    if (values.has("dark") && values["dark"].get_type() != godot::Variant::NIL) result.dark = rgb_value(values["dark"]);
    if (values.has("alpha")) result.alpha = number(values["alpha"], "alpha");
    return result;
}
void CaneGeometryEditor::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("get_attachment_id"), &CaneGeometryEditor::get_attachment_id);
    ClassDB::bind_method(D_METHOD("get_slot_id"), &CaneGeometryEditor::get_slot_id);
    ClassDB::bind_method(D_METHOD("get_draw_index"), &CaneGeometryEditor::get_draw_index);
    ClassDB::bind_method(D_METHOD("get_vertex_count"), &CaneGeometryEditor::get_vertex_count);
    ClassDB::bind_method(D_METHOD("get_position", "vertex_index"), &CaneGeometryEditor::get_position);
    ClassDB::bind_method(D_METHOD("get_uv", "vertex_index"), &CaneGeometryEditor::get_uv);
    ClassDB::bind_method(D_METHOD("get_tint"), &CaneGeometryEditor::get_tint);
    ClassDB::bind_method(D_METHOD("get_snapshot"), &CaneGeometryEditor::get_snapshot);
    ClassDB::bind_method(D_METHOD("set_position", "vertex_index", "core_position"), &CaneGeometryEditor::set_position);
    ClassDB::bind_method(D_METHOD("add_position", "vertex_index", "core_delta"), &CaneGeometryEditor::add_position);
    ClassDB::bind_method(D_METHOD("set_uv", "vertex_index", "uv"), &CaneGeometryEditor::set_uv);
    ClassDB::bind_method(D_METHOD("set_light_tint", "rgb", "alpha"), &CaneGeometryEditor::set_light_tint);
    ClassDB::bind_method(D_METHOD("set_dark_tint", "rgb"), &CaneGeometryEditor::set_dark_tint);
    ClassDB::bind_method(D_METHOD("clear_dark_tint"), &CaneGeometryEditor::clear_dark_tint);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneGeometryEditor::get_last_error);
}
bool CaneGeometryEditor::run(const std::function<void()>& action) {
    try { action(); if (!first_error_) last_error_.clear(); return true; }
    catch (const std::exception& failure) {
        set_error(last_error_, failure);
        if (callback_active_ && !first_error_) first_error_ = std::current_exception();
        return false;
    }
}
void CaneGeometryEditor::invoke(const godot::Callable& callback, cane::GeometryEditor editor,
    const cane::GeometryModifierContext& context, std::uint64_t owner_id) {
    if (!callback.is_valid()) throw cane::Error(cane::ErrorCode::invalid_state, "godotGeometryCallback", "Geometry callback no longer exists.", "callback");
    godot::Ref<CaneGeometryEditor> handle; handle.instantiate(); handle->editor_ = std::move(editor); handle->callback_active_ = true;
    struct ActiveScope { CaneGeometryEditor& editor; ~ActiveScope() { editor.callback_active_ = false; } } scope{*handle.ptr()};
    const auto* owner = godot::Object::cast_to<CaneSkeleton>(godot::ObjectDB::get_instance(owner_id));
    const auto blocked = owner ? owner->blocked_deletions() : 0;
    godot::Dictionary values; values["sequence"] = static_cast<std::int64_t>(context.sequence); values["time_seconds"] = context.time_seconds;
    values["persistent"] = context.persistent; values["operation_index"] = context.operation_index;
    godot::Variant callable = callback, result;
    const godot::Variant editor_arg = handle, context_arg = values;
    const godot::Variant* args[] = {&editor_arg, &context_arg};
    GDExtensionCallError call_error{};
    callable.callp("call", args, 2, result, call_error);
    if (handle->first_error_) std::rethrow_exception(handle->first_error_);
    const auto* current_owner = godot::Object::cast_to<CaneSkeleton>(godot::ObjectDB::get_instance(owner_id));
    if (owner && (!current_owner || current_owner->blocked_deletions() != blocked))
        throw cane::Error(cane::ErrorCode::invalid_state, "godotGeometryCallback", "Cannot free the evaluating skeleton; use queue_free after the callback.", "callback");
    if (call_error.error != GDEXTENSION_CALL_OK || result.get_type() != godot::Variant::BOOL || !static_cast<bool>(result))
        throw cane::Error(cane::ErrorCode::invalid_state, "godotGeometryCallback", "Geometry callback failed or did not return true.", "callback");
}
godot::Variant CaneGeometryEditor::get_attachment_id() { godot::Variant r; run([&] { r = text(editor_.attachment_id()); }); return r; }
godot::Variant CaneGeometryEditor::get_slot_id() { godot::Variant r; run([&] { r = text(editor_.slot_id()); }); return r; }
godot::Variant CaneGeometryEditor::get_draw_index() { godot::Variant r; run([&] { r = editor_.draw_index(); }); return r; }
godot::Variant CaneGeometryEditor::get_vertex_count() { godot::Variant r; run([&] { r = editor_.vertex_count(); }); return r; }
godot::Variant CaneGeometryEditor::get_position(const godot::Variant& i) {
    godot::Variant r; run([&] { if (const auto p = editor_.position(index_value(i))) r = godot::Vector2(p->x, p->y); }); return r;
}
godot::Variant CaneGeometryEditor::get_uv(const godot::Variant& i) {
    godot::Variant r; run([&] { if (const auto p = editor_.uv(index_value(i))) r = godot::Vector2(p->x, p->y); }); return r;
}
godot::Dictionary CaneGeometryEditor::get_tint() { godot::Dictionary r; run([&] { assign_dictionary(r, tint_value(editor_.tint())); }); return r; }
godot::Dictionary CaneGeometryEditor::get_snapshot() {
    godot::Dictionary r;
    run([&] {
        const auto count = editor_.vertex_count(); godot::PackedFloat32Array positions, uvs;
        positions.resize(static_cast<std::int64_t>(count) * 2); uvs.resize(positions.size());
        auto* p = positions.ptrw(); auto* u = uvs.ptrw();
        for (std::uint32_t i = 0; i < count; ++i) {
            const auto xy = *editor_.position(i), uv = *editor_.uv(i);
            p[i * 2] = xy.x; p[i * 2 + 1] = xy.y; u[i * 2] = uv.x; u[i * 2 + 1] = uv.y;
        }
        r["attachment_id"] = text(editor_.attachment_id()); r["slot_id"] = text(editor_.slot_id()); r["draw_index"] = editor_.draw_index();
        r["vertex_count"] = count; r["world_vertices_xy"] = positions; r["uvs"] = uvs; r["tint"] = tint_value(editor_.tint());
    }); return r;
}
bool CaneGeometryEditor::set_position(const godot::Variant& i, const godot::Variant& p) { return run([&] { editor_.set_position(index_value(i), point_value(p, "core_position")); }); }
bool CaneGeometryEditor::add_position(const godot::Variant& i, const godot::Variant& p) { return run([&] { editor_.add_position(index_value(i), point_value(p, "core_delta")); }); }
bool CaneGeometryEditor::set_uv(const godot::Variant& i, const godot::Variant& uv) { return run([&] { editor_.set_uv(index_value(i), point_value(uv, "uv")); }); }
bool CaneGeometryEditor::set_light_tint(const godot::Variant& rgb, const godot::Variant& alpha) {
    return run([&] {
        require(alpha.get_type() == godot::Variant::INT || alpha.get_type() == godot::Variant::FLOAT, "Alpha must be a finite number in 0..1.", "alpha");
        editor_.set_light_tint(rgb_value(rgb), scalar(static_cast<double>(alpha), "alpha"));
    });
}
bool CaneGeometryEditor::set_dark_tint(const godot::Variant& rgb) { return run([&] { editor_.set_dark_tint(rgb_value(rgb)); }); }
bool CaneGeometryEditor::clear_dark_tint() { return run([&] { editor_.clear_dark_tint(); }); }
}
