#include "compile_animation.hpp"
#include "curves.hpp"

namespace cane::format {
TransformMode decode_transform_mode(std::string_view name) {
    if (name == "normal") return TransformMode::normal;
    if (name == "onlyTranslation") return TransformMode::only_translation;
    if (name == "noRotationOrReflection") return TransformMode::no_rotation_or_reflection;
    if (name == "noScale") return TransformMode::no_scale;
    if (name == "noScaleOrReflection") return TransformMode::no_scale_or_reflection;
    throw Error(ErrorCode::validation_failed, "compileAnimation", "Unknown bone inheritance mode.", "inherit");
}
namespace {
using namespace animation;
const Json& get(const Json& value, std::string_view member) { return ModelValidation::get(value, member); }
struct RowGroup {
    std::size_t index = 0;
    std::vector<const Json*> rows;
    [[nodiscard]] const Json& field(std::string_view name) const {
        for (const auto* row : rows) if (!get(*row, name).is_null()) return get(*row, name);
        return get(Json(), name);
    }
};
std::vector<RowGroup> group_rows(const Json& rows, const char* id, const std::unordered_map<std::string, std::size_t>& catalog) {
    std::vector<RowGroup> groups; std::unordered_map<std::size_t, std::size_t> positions;
    for (const auto& row : rows) {
        const auto target = catalog.at(row[id].get<std::string>());
        const auto found = positions.emplace(target, groups.size());
        if (found.second) groups.push_back({target, {}});
        groups[found.first->second].rows.push_back(&row);
    }
    return groups;
}
template<class T, class Read> DiscreteChannel<T> discrete(const Json& source, Read read) {
    std::vector<DiscreteKey<T>> keys; keys.reserve(source.size());
    for (const auto& row : source) keys.push_back({row["time"].template get<float>(), read(row)});
    return DiscreteChannel<T>(std::move(keys));
}
void own(Clip& clip, PropertyDomain domain, std::size_t index, std::size_t component, bool has_keys) {
    if (has_keys) clip.properties.push_back({domain, index, component});
}
void bones(Clip& clip, const Json& source, const ModelIndex& indices) {
    for (const auto& group : group_rows(source, "boneId", indices.catalogs[4])) {
        BoneTimeline timeline; timeline.index = group.index;
        constexpr std::array<const char*, 7> pairs{"translate", "translate", "rotate", "scale", "scale", "shear", "shear"};
        constexpr std::array<const char*, 7> fields{"x", "y", "angle", "x", "y", "x", "y"};
        constexpr std::array<const char*, 7> axes{"translateX", "translateY", "", "scaleX", "scaleY", "shearX", "shearY"};
        constexpr std::array<const char*, 7> axis_properties{"x", "y", "rotation", "x", "y", "x", "y"};
        for (std::size_t i = 0; i < timeline.channels.size(); ++i) {
            const auto pair = scalar_channel(group.field(pairs[i]), fields[i], i == 2 ? "rotation" : fields[i]);
            timeline.channels[i] = i == 2 ? pair : ScalarChannel::merge(pair, scalar_channel(group.field(axes[i]), "value", axis_properties[i]));
            own(clip, PropertyDomain::bone, group.index, i, !timeline.channels[i].keys().empty());
        }
        timeline.inherit = discrete<TransformMode>(group.field("inherit"), [](const Json& key) { return decode_transform_mode(key["inherit"].get<std::string>()); });
        own(clip, PropertyDomain::bone, group.index, 7, !timeline.inherit.keys().empty());
        clip.bones.push_back(std::move(timeline));
    }
}
std::array<float, 3> rgb(const Json& value) {
    if (value.is_null()) return {0, 0, 0};
    const auto& color = value.get_ref<const std::string&>(); const auto start = color.front() == '#' ? 1u : 0u;
    const auto nibble = [](char c) -> unsigned { if (c >= '0' && c <= '9') return static_cast<unsigned>(c - '0'); if (c >= 'A' && c <= 'F') return static_cast<unsigned>(c - 'A' + 10); return static_cast<unsigned>(c - 'a' + 10); };
    std::array<float, 3> result{};
    for (std::size_t i = 0; i < 3; ++i) result[i] = static_cast<float>(nibble(color[start + i * 2]) * 16 + nibble(color[start + i * 2 + 1])) / 255.0f;
    return result;
}
void slots(Clip& clip, const Json& source, const ModelIndex& indices) {
    for (const auto& group : group_rows(source, "slotId", indices.catalogs[5])) {
        SlotTimeline timeline; timeline.index = group.index;
        std::array<std::vector<ScalarKey>, 7> channels;
        constexpr std::array<const char*, 7> properties{"color_r", "color_g", "color_b", "dark_r", "dark_g", "dark_b", "alpha"};
        for (const auto& key : group.field("color")) {
            const auto light = rgb(key["color"]), dark = rgb(key["darkColor"]); const auto curve = parse_curve(get(key, "curve"));
            for (std::size_t i = 0; i < 7; ++i) channels[i].push_back({key["time"].get<float>(), i < 3 ? light[i] : i < 6 ? dark[i - 3] : key["alpha"].get<float>(), curve.select(properties[i])});
        }
        for (std::size_t i = 0; i < 7; ++i) { timeline.color[i] = ScalarChannel(std::move(channels[i])); own(clip, PropertyDomain::slot, group.index, i, !timeline.color[i].keys().empty()); }
        timeline.alpha = scalar_channel(group.field("alpha"), "alpha", "alpha");
        own(clip, PropertyDomain::slot, group.index, 6, !timeline.alpha.keys().empty());
        timeline.dark_present = discrete<bool>(group.field("color"), [](const Json& key) { return !key["darkColor"].is_null(); });
        timeline.attachment = discrete<std::optional<std::string>>(group.field("attachment"), [](const Json& key) -> std::optional<std::string> {
            return key["attachmentId"].is_null() ? std::nullopt : std::optional<std::string>(key["attachmentId"].get<std::string>());
        });
        own(clip, PropertyDomain::slot, group.index, 7, !timeline.attachment.keys().empty()); clip.slots.push_back(std::move(timeline));
    }
}
void attachments(Clip& clip, const Json& source, const ModelIndex& indices) {
    for (const auto& group : group_rows(source, "attachmentId", indices.catalogs[6])) {
        AttachmentTimeline timeline; timeline.index = group.index;
        constexpr std::array<const char*, 5> fields{"x", "y", "rotation", "scaleX", "scaleY"}, properties{"x", "y", "rotation", "scale_x", "scale_y"};
        for (std::size_t i = 0; i < 5; ++i) { timeline.region[i] = scalar_channel(group.field("region"), fields[i], properties[i]); own(clip, PropertyDomain::attachment, group.index, i, !timeline.region[i].keys().empty()); }
        std::vector<VectorKey> vectors;
        for (const auto& key : group.field("deform")) {
            const auto curves = parse_curve(get(key, "curve"));
            vectors.push_back({key["time"].get<float>(), key["vertices"].get<std::vector<float>>(), {curves.select("x"), curves.select("y")}});
        }
        timeline.deform = VectorChannel(std::move(vectors));
        for (const auto* row : group.rows) if (!get(*row, "deform").is_null() && get(*row, "deformSpace") == "weightedInfluenceOffsets") timeline.deform_space = DeformSpace::weighted_influence_offsets;
        timeline.sequence = discrete<SequenceSelection>(group.field("sequence"), [](const Json& key) {
            constexpr std::array<const char*, 7> modes{"hold", "once", "loop", "pingpong", "onceReverse", "loopReverse", "pingpongReverse"};
            const auto mode = key["mode"].get<std::string>(); const auto found = std::find(modes.begin(), modes.end(), mode);
            return SequenceSelection{static_cast<SequenceMode>(found - modes.begin()), key["index"].get<std::uint32_t>(), key["delay"].get<float>()};
        });
        own(clip, PropertyDomain::attachment, group.index, 5, !timeline.deform.keys().empty());
        own(clip, PropertyDomain::attachment, group.index, 6, !timeline.sequence.keys().empty()); clip.attachments.push_back(std::move(timeline));
    }
}
void constraints(Clip& clip, const Json& source, const ModelIndex& indices) {
    constexpr std::array<const char*, 5> kinds{"ik", "transform", "path", "physics", "slider"};
    constexpr std::array<const char*, 23> fields{"targetX", "targetY", "mix", "softness", "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY",
        "position", "spacing", "inertia", "strength", "damping", "mass", "wind", "gravity", "sliderTime", "bendPositive", "compress", "stretch", "reset"};
    constexpr std::array<const char*, 19> properties{"target_x", "target_y", "mix", "softness", "mix_rotate", "mix_x", "mix_y", "mix_scale_x", "mix_scale_y", "mix_shear_y",
        "position", "spacing", "inertia", "strength", "damping", "mass", "wind", "gravity", "slider_time"};
    static_assert(fields.size() == static_cast<std::size_t>(ConstraintProperty::count));
    for (const auto& row : source) {
        ConstraintTimeline timeline; const auto type = row["type"].get<std::string>(), id = row["constraintId"].get<std::string>();
        timeline.kind = static_cast<ConstraintKind>(std::find(kinds.begin(), kinds.end(), type) - kinds.begin());
        if (id != "*" || timeline.kind != ConstraintKind::physics) timeline.index = indices.catalogs[7].at(id);
        for (std::size_t property = 0; property < fields.size(); ++property) {
            bool has_keys = false;
            if (property < properties.size()) {
                auto channel = scalar_channel(row["keys"], fields[property], properties[property], true); has_keys = !channel.keys().empty();
                if (has_keys) timeline.scalars.push_back({static_cast<ConstraintProperty>(property), std::move(channel)});
            } else if (property == static_cast<std::size_t>(ConstraintProperty::reset)) {
                std::size_t ordinal = 0;
                for (const auto& key : row["keys"]) {
                    if (key.contains("reset")) {
                        has_keys = true;
                        if (key["reset"].get<bool>()) timeline.reset_triggers.push_back({key["time"].get<float>(), ordinal});
                    }
                    ++ordinal;
                }
            } else {
                std::vector<DiscreteKey<bool>> values;
                for (const auto& key : row["keys"]) if (key.contains(fields[property])) values.push_back({key["time"].get<float>(), key[fields[property]].get<bool>()});
                has_keys = !values.empty();
                if (has_keys) timeline.booleans.push_back({static_cast<ConstraintProperty>(property), DiscreteChannel<bool>(std::move(values))});
            }
            own(clip, timeline.index ? PropertyDomain::constraint : PropertyDomain::physics_global, timeline.index.value_or(0), property, has_keys);
        }
        clip.constraints.push_back(std::move(timeline));
    }
}
std::vector<std::size_t> slot_indices(const Json& source, const ModelIndex& indices) {
    std::vector<std::size_t> result; result.reserve(source.size());
    for (const auto& id : source) result.push_back(indices.catalogs[5].at(id.get<std::string>()));
    return result;
}
void events_and_order(Clip& clip, const Json& source, const Json& document, const ModelIndex& indices) {
    ModelValidation scalars(document); std::size_t ordinal = 0;
    for (const auto& row : source["events"]) {
        EventKey key; key.time = row["time"].get<float>(); key.declaration_order = ordinal++; key.name = row["name"].get<std::string>();
        if (!row["eventId"].is_null()) key.event_index = indices.catalogs[9].at(row["eventId"].get<std::string>());
        const auto& defaults = key.event_index ? document["events"][*key.event_index] : get(Json(), "absent");
        const auto value = [&](const char* field) -> const Json& { return get(row, field).is_null() ? get(defaults, field) : get(row, field); };
        if (!value("integerValue").is_null()) key.integer_value = scalars.signed_integer(value("integerValue"), "events.integerValue");
        if (!value("stringValue").is_null()) key.string_value = value("stringValue").get<std::string>();
        if (!value("numberValue").is_null()) key.number_value = value("numberValue").get<float>();
        if (!value("audioId").is_null()) key.audio_index = indices.catalogs[2].at(value("audioId").get<std::string>());
        if (!value("volume").is_null()) key.volume = value("volume").get<float>();
        if (!value("balance").is_null()) key.balance = value("balance").get<float>();
        clip.events.push_back(std::move(key));
    }
    const auto read_order = [&](const Json& row) { return slot_indices(row["slotIds"], indices); };
    clip.draw_order = discrete<std::vector<std::size_t>>(source["drawOrder"], read_order);
    bool owns_order = !clip.draw_order.keys().empty();
    for (const auto& row : source["drawOrderFolders"]) {
        DrawOrderFolder folder; folder.path = row["folderPath"].get<std::string>(); folder.members = slot_indices(row["slotIds"], indices);
        folder.keys = discrete<std::vector<std::size_t>>(row["keys"], read_order); owns_order = owns_order || !folder.keys.keys().empty();
        clip.draw_order_folders.push_back(std::move(folder));
    }
    clip.skins = discrete<std::optional<std::size_t>>(source["skins"], [&](const Json& key) -> std::optional<std::size_t> {
        return key["skinId"].is_null() ? std::nullopt : std::optional<std::size_t>(indices.catalogs[8].at(key["skinId"].get<std::string>()));
    });
    own(clip, PropertyDomain::draw_order, 0, 0, owns_order);
    own(clip, PropertyDomain::skin, 0, 0, !clip.skins.keys().empty());
}
}
std::vector<animation::Clip> compile_animations(const Json& document, const ModelIndex& index) {
    std::vector<animation::Clip> clips; clips.reserve(document["animations"].size());
    for (const auto& row : document["animations"]) {
        animation::Clip clip; clip.id = row["id"].get<std::string>(); clip.name = row["name"].get<std::string>();
        clip.duration = row["duration"].get<float>(); clip.fps = row["fps"].get<float>();
        bones(clip, row["boneTimelines"], index); slots(clip, row["slotTimelines"], index);
        attachments(clip, row["attachmentTimelines"], index); constraints(clip, row["constraintTimelines"], index);
        events_and_order(clip, row, document, index);
        std::sort(clip.properties.begin(), clip.properties.end()); clip.properties.erase(std::unique(clip.properties.begin(), clip.properties.end()), clip.properties.end());
        clips.push_back(std::move(clip));
    }
    return clips;
}
}
