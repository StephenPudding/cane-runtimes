#include "runtime_skin.hpp"
#include "script_values.hpp"
#include <godot_cpp/core/class_db.hpp>

namespace cane_godot {
void CaneRuntimeSkin::_bind_methods() {
    using godot::ClassDB; using godot::D_METHOD;
    ClassDB::bind_method(D_METHOD("initialize", "id", "name", "export_skin"), &CaneRuntimeSkin::initialize, DEFVAL(godot::Variant()), DEFVAL(false));
    ClassDB::bind_method(D_METHOD("copy_from_json", "json", "id", "name"), &CaneRuntimeSkin::copy_from_json, DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("copy_skin", "id", "name"), &CaneRuntimeSkin::copy_skin, DEFVAL(godot::Variant()));
    ClassDB::bind_method(D_METHOD("rename", "name"), &CaneRuntimeSkin::rename);
    ClassDB::bind_method(D_METHOD("set_export", "value"), &CaneRuntimeSkin::set_export);
    ClassDB::bind_method(D_METHOD("set_attachment", "slot_id", "name", "attachment_id"), &CaneRuntimeSkin::set_attachment);
    ClassDB::bind_method(D_METHOD("get_attachment", "slot_id", "name"), &CaneRuntimeSkin::get_attachment);
    ClassDB::bind_method(D_METHOD("remove_attachment", "slot_id", "name"), &CaneRuntimeSkin::remove_attachment);
    ClassDB::bind_method(D_METHOD("add_bone", "id"), &CaneRuntimeSkin::add_bone);
    ClassDB::bind_method(D_METHOD("remove_bone", "id"), &CaneRuntimeSkin::remove_bone);
    ClassDB::bind_method(D_METHOD("add_constraint", "id"), &CaneRuntimeSkin::add_constraint);
    ClassDB::bind_method(D_METHOD("remove_constraint", "id"), &CaneRuntimeSkin::remove_constraint);
    ClassDB::bind_method(D_METHOD("merge_skin", "other"), &CaneRuntimeSkin::merge_skin);
    ClassDB::bind_method(D_METHOD("merge_json", "json"), &CaneRuntimeSkin::merge_json);
    ClassDB::bind_method(D_METHOD("clear"), &CaneRuntimeSkin::clear);
    ClassDB::bind_method(D_METHOD("dispose"), &CaneRuntimeSkin::dispose);
    ClassDB::bind_method(D_METHOD("is_disposed"), &CaneRuntimeSkin::is_disposed);
    ClassDB::bind_method(D_METHOD("get_id"), &CaneRuntimeSkin::get_id);
    ClassDB::bind_method(D_METHOD("get_snapshot_json"), &CaneRuntimeSkin::get_snapshot_json);
    ClassDB::bind_method(D_METHOD("get_last_error"), &CaneRuntimeSkin::get_last_error);
}
cane::RuntimeSkinBuilder& CaneRuntimeSkin::live() {
    if (!builder_ || builder_->disposed()) throw cane::Error(cane::ErrorCode::invalid_state, "runtimeSkin", "Skin builder is uninitialized or disposed.");
    return *builder_;
}
bool CaneRuntimeSkin::run(const std::function<void()>& action) {
    try { action(); last_error_.clear(); return true; }
    catch (const std::exception& failure) { set_error(last_error_, failure); return false; }
}
bool CaneRuntimeSkin::initialize(const godot::String& id, const godot::Variant& name, bool exported) {
    return run([&] {
        if (builder_) throw cane::Error(cane::ErrorCode::invalid_state, "createRuntimeSkin", "Skin builder is already initialized.");
        builder_ = std::make_unique<cane::RuntimeSkinBuilder>(text(id), optional_string(name, "name"), exported);
    });
}
bool CaneRuntimeSkin::copy_from_json(const godot::String& json, const godot::String& id, const godot::Variant& name) {
    return run([&] {
        if (builder_) throw cane::Error(cane::ErrorCode::invalid_state, "copyRuntimeSkin", "Skin builder is already initialized.");
        auto candidate = cane::RuntimeSkinBuilder::copy(cane::RuntimeSkinResource::from_json(text(json)), text(id), optional_string(name, "name"));
        builder_ = std::make_unique<cane::RuntimeSkinBuilder>(std::move(candidate));
    });
}
godot::Ref<CaneRuntimeSkin> CaneRuntimeSkin::copy_skin(const godot::String& id, const godot::Variant& name) {
    godot::Ref<CaneRuntimeSkin> result;
    run([&] {
        auto candidate = cane::RuntimeSkinBuilder::copy(live().snapshot(), text(id), optional_string(name, "name"));
        result.instantiate(); result->builder_ = std::make_unique<cane::RuntimeSkinBuilder>(std::move(candidate));
    }); return result;
}
bool CaneRuntimeSkin::rename(const godot::String& name) { return run([&] { live().set_name(text(name)); }); }
bool CaneRuntimeSkin::set_export(bool value) { return run([&] { live().set_export(value); }); }
bool CaneRuntimeSkin::set_attachment(const godot::String& slot, const godot::Variant& name, const godot::Variant& id) {
    return run([&] { live().set_attachment(text(slot), optional_string(name, "name"), optional_string(id, "attachment_id")); });
}
godot::Dictionary CaneRuntimeSkin::get_attachment(const godot::String& slot, const godot::Variant& name) {
    godot::Dictionary result;
    run([&] {
        std::optional<std::string> id; result["found"] = live().try_get_attachment(text(slot), optional_string(name, "name"), id);
        result["attachment_id"] = id ? godot::Variant(text(*id)) : godot::Variant();
    }); return result;
}
bool CaneRuntimeSkin::remove_attachment(const godot::String& slot, const godot::Variant& name) {
    bool removed = false; return run([&] { removed = live().remove_attachment(text(slot), optional_string(name, "name")); }) && removed;
}
bool CaneRuntimeSkin::add_bone(const godot::String& id) { return run([&] { live().add_bone(text(id)); }); }
bool CaneRuntimeSkin::remove_bone(const godot::String& id) { bool removed = false; return run([&] { removed = live().remove_bone(text(id)); }) && removed; }
bool CaneRuntimeSkin::add_constraint(const godot::String& id) { return run([&] { live().add_constraint(text(id)); }); }
bool CaneRuntimeSkin::remove_constraint(const godot::String& id) { bool removed = false; return run([&] { removed = live().remove_constraint(text(id)); }) && removed; }
bool CaneRuntimeSkin::merge_skin(const godot::Ref<CaneRuntimeSkin>& other) {
    return run([&] { require(other.is_valid(), "Skin builder is required.", "other"); live().merge(other->native_snapshot()); });
}
bool CaneRuntimeSkin::merge_json(const godot::String& json) { return run([&] { live().merge(cane::RuntimeSkinResource::from_json(text(json))); }); }
bool CaneRuntimeSkin::clear() { return run([&] { live().clear(); }); }
void CaneRuntimeSkin::dispose() { if (builder_) builder_->dispose(); last_error_.clear(); }
godot::String CaneRuntimeSkin::get_id() { godot::String result; run([&] { result = text(live().id()); }); return result; }
godot::String CaneRuntimeSkin::get_snapshot_json() { godot::String result; run([&] { result = text(live().snapshot().to_json()); }); return result; }
cane::RuntimeSkinResource CaneRuntimeSkin::native_snapshot() { return live().snapshot(); }
}
