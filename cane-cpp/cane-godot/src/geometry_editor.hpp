#pragma once
#include <cane/geometry_modifiers.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/callable.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <exception>

namespace cane_godot {
class CaneGeometryEditor : public godot::RefCounted {
    GDCLASS(CaneGeometryEditor, godot::RefCounted)
    cane::GeometryEditor editor_;
    godot::Dictionary last_error_;
    std::exception_ptr first_error_;
    bool callback_active_ = false;
    bool run(const std::function<void()>& action);
protected:
    static void _bind_methods();
public:
    // Only native Core creates an active handle. Copies expire with its callback scope.
    static void invoke(const godot::Callable& callback, cane::GeometryEditor editor,
        const cane::GeometryModifierContext& context, std::uint64_t owner_id);
    godot::Variant get_attachment_id();
    godot::Variant get_slot_id();
    godot::Variant get_draw_index();
    godot::Variant get_vertex_count();
    godot::Variant get_position(const godot::Variant& vertex_index);
    godot::Variant get_uv(const godot::Variant& vertex_index);
    godot::Dictionary get_tint();
    godot::Dictionary get_snapshot();
    bool set_position(const godot::Variant& vertex_index, const godot::Variant& core_position);
    bool add_position(const godot::Variant& vertex_index, const godot::Variant& core_delta);
    bool set_uv(const godot::Variant& vertex_index, const godot::Variant& uv);
    bool set_light_tint(const godot::Variant& rgb, const godot::Variant& alpha);
    bool set_dark_tint(const godot::Variant& rgb);
    bool clear_dark_tint();
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
};

// A copied callback keeps its Callable, while lifetime checks follow the skeleton
// currently evaluating it. Nested operations on another skeleton restore the owner.
class GeometryOwnerScope {
    inline static thread_local std::uint64_t current_ = 0;
    std::uint64_t previous_;
public:
    explicit GeometryOwnerScope(std::uint64_t owner) : previous_(current_) { current_ = owner; }
    ~GeometryOwnerScope() { current_ = previous_; }
    GeometryOwnerScope(const GeometryOwnerScope&) = delete;
    GeometryOwnerScope& operator=(const GeometryOwnerScope&) = delete;
    static std::uint64_t current(std::uint64_t fallback) { return current_ ? current_ : fallback; }
};
struct ScriptGeometryCallback {
    godot::Callable callback;
    std::uint64_t owner_id = 0;
    void operator()(cane::GeometryEditor editor, const cane::GeometryModifierContext& context) const {
        CaneGeometryEditor::invoke(callback, std::move(editor), context, GeometryOwnerScope::current(owner_id));
    }
};
}
