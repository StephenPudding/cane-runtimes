#include "skeleton.hpp"
#include "bone.hpp"
#include "slot.hpp"
#include "point.hpp"
#include "bounds.hpp"
#include "geometry_editor.hpp"
#include "runtime_skin.hpp"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/godot.hpp>

namespace {
void initialize(godot::ModuleInitializationLevel level) {
    if (level != godot::MODULE_INITIALIZATION_LEVEL_SCENE) return;
    godot::ClassDB::register_class<cane_godot::CaneSkeletonData>();
    godot::ClassDB::register_class<cane_godot::CaneRuntimeSkin>();
    godot::ClassDB::register_class<cane_godot::CaneBounds>();
    godot::ClassDB::register_class<cane_godot::CaneGeometryEditor>();
    godot::ClassDB::register_class<cane_godot::CaneSkeleton>();
    godot::ClassDB::register_abstract_class<cane_godot::CaneFollower2D>();
    godot::ClassDB::register_class<cane_godot::CaneBone2D>();
    godot::ClassDB::register_class<cane_godot::CanePoint2D>();
    godot::ClassDB::register_class<cane_godot::CaneSlot2D>();
}
void terminate(godot::ModuleInitializationLevel) {}
}
extern "C" GDExtensionBool GDE_EXPORT cane_godot_library_init(GDExtensionInterfaceGetProcAddress get_proc_address,
    GDExtensionClassLibraryPtr library, GDExtensionInitialization* initialization) {
    godot::GDExtensionBinding::InitObject binding(get_proc_address, library, initialization);
    binding.register_initializer(initialize); binding.register_terminator(terminate);
    binding.set_minimum_library_initialization_level(godot::MODULE_INITIALIZATION_LEVEL_SCENE);
    return binding.init();
}
