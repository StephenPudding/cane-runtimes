#pragma once
#include <cane/runtime_resources.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/dictionary.hpp>

namespace cane_godot {
class CaneRuntimeSkin : public godot::RefCounted {
    GDCLASS(CaneRuntimeSkin, godot::RefCounted)
    std::unique_ptr<cane::RuntimeSkinBuilder> builder_;
    godot::Dictionary last_error_;
    cane::RuntimeSkinBuilder& live();
    bool run(const std::function<void()>& action);
protected:
    static void _bind_methods();
public:
    bool initialize(const godot::String& id, const godot::Variant& name = {}, bool export_skin = false);
    bool copy_from_json(const godot::String& json, const godot::String& id, const godot::Variant& name = {});
    godot::Ref<CaneRuntimeSkin> copy_skin(const godot::String& id, const godot::Variant& name = {});
    bool rename(const godot::String& name);
    bool set_export(bool value);
    bool set_attachment(const godot::String& slot_id, const godot::Variant& name, const godot::Variant& attachment_id);
    godot::Dictionary get_attachment(const godot::String& slot_id, const godot::Variant& name);
    bool remove_attachment(const godot::String& slot_id, const godot::Variant& name);
    bool add_bone(const godot::String& id);
    bool remove_bone(const godot::String& id);
    bool add_constraint(const godot::String& id);
    bool remove_constraint(const godot::String& id);
    bool merge_skin(const godot::Ref<CaneRuntimeSkin>& other);
    bool merge_json(const godot::String& json);
    bool clear();
    void dispose();
    bool is_disposed() const { return builder_ && builder_->disposed(); }
    godot::String get_id();
    godot::String get_snapshot_json();
    godot::Dictionary get_last_error() const { return last_error_.duplicate(true); }
    cane::RuntimeSkinResource native_snapshot();
};
}
