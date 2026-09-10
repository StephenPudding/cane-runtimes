#include "compile_model.hpp"

namespace cane::format {
namespace {
using namespace detail;
MappedProperty property(const std::string& p) {
    return p == "x" ? MappedProperty::x : p == "y" ? MappedProperty::y : p == "scaleX" ? MappedProperty::scale_x : p == "scaleY" ? MappedProperty::scale_y : p == "shearY" ? MappedProperty::shear_y : MappedProperty::rotate;
}
ScaleYMode scale_y(const std::string& mode) { return mode == "uniform" ? ScaleYMode::uniform : mode == "volume" ? ScaleYMode::volume : ScaleYMode::none; }
}
void compile_constraints(const Json& document, const ModelIndex& index, detail::RuntimeModel& model) {
    using namespace detail; using P = animation::ConstraintProperty; using K = animation::ConstraintKind;
    const auto ref = [&](CatalogKind kind, const Json& id) { return index.catalogs[static_cast<std::size_t>(kind)].at(id.get<std::string>()); };
    const auto bone_list = [&](const Json& values) { std::vector<std::size_t> result; for (const auto& id : values) result.push_back(ref(CatalogKind::bone, id)); return result; };
    for (const auto& row : document["constraints"]) {
        ConstraintDefinition c; const auto type = row["type"].get<std::string>(); auto& s = c.setup;
        const auto assign = [&](P p, const char* field, float fallback) { s[p] = row.value(field, fallback); };
        const auto mixes = [&] {
            constexpr std::array<const char*, 6> fields{"mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"};
            for (std::size_t i = 0; i < fields.size(); ++i) assign(static_cast<P>(static_cast<std::size_t>(P::mix_rotate) + i), fields[i], 1);
        };
        if (type == "ik") {
            c.kind = K::ik; IkDefinition d; d.bones = bone_list(row["chainBoneIds"]);
            if (!row["targetBoneId"].is_null()) d.target = ref(CatalogKind::bone, row["targetBoneId"]);
            s[P::target_x] = row["target"]["x"].get<float>(); s[P::target_y] = row["target"]["y"].get<float>();
            assign(P::mix, "mix", 1); assign(P::softness, "softness", 0);
            s.booleans = {row["bendPositive"].get<bool>(), row["compress"].get<bool>(), row["stretch"].get<bool>()};
            d.uniform = row["uniform"].is_boolean() ? row["uniform"].get<bool>() ? ScaleYMode::uniform : ScaleYMode::none : ScaleYMode::volume;
            d.iterations = row["iterations"].get<std::uint32_t>(); d.threshold = row["threshold"].get<float>(); c.definition = std::move(d);
        } else if (type == "transform") {
            c.kind = K::transform; TransformDefinition d; d.bones = bone_list(row["boneIds"]); d.target = ref(CatalogKind::bone, row["targetBoneId"]);
            d.local = row.value("local", false); d.relative = row.value("relative", false); mixes();
            constexpr std::array<const char*, 6> fields{"rotation", "x", "y", "scaleX", "scaleY", "shearY"};
            for (std::size_t i = 0; i < fields.size(); ++i) s.transform_offsets[i] = row.value(fields[i], 0.0f);
            const auto& mapping = ModelValidation::get(row, "mapping");
            if (!mapping.is_null()) {
                TransformMapping m; m.local_source = mapping.value("localSource", false); m.local_target = mapping.value("localTarget", false); m.clamp = mapping.value("clamp", false);
                for (const auto& source : mapping["properties"]) {
                    MappingSource p; p.property = property(source["property"].get<std::string>()); p.offset = source.value("offset", 0.0f);
                    for (const auto& target : source["targets"]) p.targets.push_back({property(target["property"].get<std::string>()), target.value("offset", 0.0f), target.value("max", 1.0f), target.value("scale", 1.0f)});
                    m.properties.push_back(std::move(p));
                }
                d.mapping = std::move(m);
            }
            c.definition = std::move(d);
        } else if (type == "path") {
            c.kind = K::path; PathDefinition d; d.bones = bone_list(row["boneIds"]); d.target_slot = ref(CatalogKind::slot, row["targetSlotId"]);
            d.position_mode = row["positionMode"] == "percent" ? PositionMode::percent : PositionMode::fixed;
            d.spacing_mode = row["spacingMode"] == "fixed" ? SpacingMode::fixed : row["spacingMode"] == "percent" ? SpacingMode::percent : row["spacingMode"] == "proportional" ? SpacingMode::proportional : SpacingMode::length;
            d.rotate_mode = row["rotateMode"] == "chain" ? RotateMode::chain : row["rotateMode"] == "chainScale" ? RotateMode::chain_scale : RotateMode::tangent;
            s.path_rotation = row["rotation"].get<float>(); mixes(); assign(P::position, "position", 0); assign(P::spacing, "spacing", 0); c.definition = std::move(d);
        } else if (type == "physics") {
            c.kind = K::physics; PhysicsDefinition d; d.bone = ref(CatalogKind::bone, row["boneId"]);
            s.physics.x = row.value("x", 0.0f); s.physics.y = row.value("y", 0.0f); s.physics.rotate = row.value("rotate", 0.0f); s.physics.scale_x = row.value("scaleX", 0.0f); s.physics.shear_x = row.value("shearX", 0.0f);
            s.physics.limit = row.value("limit", 5000.0f); s.physics.fps = row.value("fps", 60.0f); d.scale_y = scale_y(row.value("scaleYMode", "none"));
            constexpr std::array<const char*, 7> fields{"inertia", "strength", "damping", "mass", "wind", "gravity", "mix"};
            constexpr std::array<P, 7> properties{P::inertia, P::strength, P::damping, P::mass, P::wind, P::gravity, P::mix};
            constexpr std::array<float, 7> defaults{1, 100, 1, 1, 0, 0, 1};
            for (std::size_t i = 0; i < fields.size(); ++i) {
                assign(properties[i], fields[i], defaults[i]); d.globals[static_cast<std::size_t>(properties[i])] = row.value(std::string(fields[i]) + "Global", false);
            }
            c.definition = std::move(d);
        } else {
            c.kind = K::slider; SliderDefinition d; d.animation = ref(CatalogKind::animation, row["animationId"]);
            if (!ModelValidation::get(row, "sourceBoneId").is_null()) d.source_bone = ref(CatalogKind::bone, row["sourceBoneId"]);
            d.source_property = property(row.value("sourceProperty", "rotate")); d.looping = row.value("looping", false); d.additive = row.value("additive", false); d.local = row.value("local", false);
            s.slider.source_offset = row.value("sourceOffset", 0.0f); s.slider.time_offset = row.value("timeOffset", 0.0f); s.slider.time_scale = row.value("timeScale", 1.0f); s.slider.range_max = row.value("rangeMax", 0.0f);
            assign(P::slider_time, "time", 0); assign(P::mix, "mix", 1); c.definition = std::move(d);
        }
        model.constraints.push_back(std::move(c));
    }
}
}
