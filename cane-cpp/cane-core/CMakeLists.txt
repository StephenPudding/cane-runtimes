add_library(cane-core STATIC
  src/math.cpp
  src/runtime_data.cpp
  src/runtime_catalog.cpp
  src/runtime_capabilities.cpp
  src/runtime_load_plan.cpp
  src/player/runtime_frame.cpp
  src/player/evaluation.cpp
  src/player/runtime_player.cpp
  src/player/resource_values.cpp
  src/player/skin_builder.cpp
  src/player/resource_overlay.cpp
  src/player/resource_controls.cpp
  src/player/project_reconciliation.cpp
  src/player/authoring.cpp
  src/player/playback_controls.cpp
  src/player/host_controls.cpp
  src/player/pose_queries.cpp
  src/player/vertex_queries.cpp
  src/player/pose_modifiers.cpp
  src/player/geometry_modifiers.cpp
  src/player/bounds_queries.cpp
  src/player/constraint_parameters.cpp
  src/player/constraint_controls.cpp
  src/player/constraint_queries.cpp
  src/animation/curves.cpp
  src/animation/clip.cpp
  src/animation/events.cpp
  src/animation/playback.cpp
  src/animation/playback_clock.cpp
  src/animation/playback_mixer.cpp
  src/animation/pose.cpp
  src/animation/sampling.cpp
  src/animation/source_geometry.cpp
  src/constraints/solvers.cpp
  src/constraints/ik.cpp
  src/constraints/transform.cpp
  src/constraints/path_sampler.cpp
  src/constraints/path_projection.cpp
  src/constraints/path.cpp
  src/constraints/slider.cpp
  src/constraints/physics_state.cpp
  src/constraints/physics.cpp
  src/constraints/dispatch.cpp
  src/geometry/clipping.cpp
  src/geometry/deformation.cpp
  src/geometry/bounds.cpp
  src/geometry/bounds_math.cpp
  src/geometry/packet_builder.cpp
  src/geometry/modifiers.cpp
  src/geometry/geometry_editor.cpp
  src/format/json.cpp
  src/format/caneb.cpp
  src/format/curves.cpp
  src/format/atlas.cpp
  src/format/model_validation.cpp
  src/format/model_attachments.cpp
  src/format/model_constraints.cpp
  src/format/model_animations.cpp
  src/format/compile_animation.cpp
  src/format/compile_model.cpp
  src/format/compile_constraints.cpp
)
add_library(Cane::Core ALIAS cane-core)
target_compile_features(cane-core PUBLIC cxx_std_17)
target_include_directories(cane-core PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>")
target_include_directories(cane-core PRIVATE src)
target_include_directories(cane-core SYSTEM PRIVATE ../third_party)
set_target_properties(cane-core PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_EXTENSIONS OFF)
if(MSVC)
  target_compile_options(cane-core PRIVATE /W4 /WX /permissive- /fp:strict /utf-8)
else()
  target_compile_options(cane-core PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()
