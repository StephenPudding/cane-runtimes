#include "model_validation.hpp"
#include "curves.hpp"
#include "cane/error.hpp"
#include <tuple>

namespace cane::format {
void ModelValidation::keys(const Json& source, float duration, const std::string& field, std::string_view fields, std::string_view required,
                           const std::function<void(const Json&, const std::string&)>& check) const {
    if (source.is_null()) return;
    array(source, field); float previous = -1; std::size_t ordinal = 0;
    for (const auto& key : source) {
        const auto path = field + '[' + std::to_string(ordinal++) + ']';
        object(key, path, "time curve " + std::string(fields), "time " + std::string(required));
        const auto time = scalar(key["time"], path + ".time", 0, duration);
        if (time < previous) fail(path + ".time", "Key times must be in declaration-time order.");
        previous = time;
        try { (void)parse_curve(get(key, "curve"), path + ".curve"); }
        catch (const Error& error) { throw Error(error.code, operation_, error.what(), error.field, error.entity_id, error.detail); }
        check(key, path);
    }
}
void ModelValidation::animations() {
    for (const auto& animation : document_["animations"]) {
        const auto field = "animations." + animation["id"].get<std::string>();
        constexpr auto fields = "id name duration fps boneTimelines slotTimelines attachmentTimelines constraintTimelines events drawOrder drawOrderFolders skins";
        object(animation, field, fields, fields); (void)string(animation["name"], field + ".name");
        const auto duration = scalar(animation["duration"], field + ".duration", 0);
        (void)scalar(animation["fps"], field + ".fps", std::numeric_limits<float>::denorm_min());
        for (const auto* key : {"boneTimelines", "slotTimelines", "attachmentTimelines", "constraintTimelines", "events", "drawOrder", "drawOrderFolders", "skins"}) array(animation[key], field + '.' + key);
        std::set<std::tuple<int, std::string, std::string>> claimed;
        auto claim = [&](int kind, const std::string& id, const std::string& channel) {
            if (!claimed.emplace(kind, id, channel).second) fail(field, "Duplicate animation target/channel.");
        };
        for (const auto& timeline : animation["boneTimelines"]) {
            const auto path = field + ".boneTimelines";
            object(timeline, path, "boneId translate translateX translateY rotate scale scaleX scaleY shear shearX shearY inherit", "boneId");
            (void)reference(timeline["boneId"], CatalogKind::bone, path + ".boneId"); const auto id = timeline["boneId"].get<std::string>();
            for (const auto& channel : timeline.items()) {
                if (channel.key() == "boneId" || channel.value().is_null()) continue;
                claim(0, id, channel.key()); const auto key_path = path + '.' + channel.key();
                const bool pair = channel.key() == "translate" || channel.key() == "scale" || channel.key() == "shear";
                const auto value_fields = channel.key() == "inherit" ? "inherit" : channel.key() == "rotate" ? "angle" : pair ? "x y" : "value";
                keys(channel.value(), duration, key_path, value_fields, value_fields, [&](const Json& key, const std::string& at) {
                    if (channel.key() == "inherit") { (void)choice(key["inherit"], at + ".inherit", bone_modes); return; }
                    for (const auto& value : key.items()) {
                        if (value.key() == "time" || value.key() == "curve") continue;
                        (void)scalar(value.value(), at + '.' + value.key());
                    }
                });
            }
        }
        for (const auto& timeline : animation["slotTimelines"]) {
            const auto path = field + ".slotTimelines"; object(timeline, path, "slotId attachment color alpha", "slotId");
            (void)reference(timeline["slotId"], CatalogKind::slot, path + ".slotId"); const auto id = timeline["slotId"].get<std::string>();
            for (const auto* channel : {"attachment", "color", "alpha"}) if (!get(timeline, channel).is_null()) claim(1, id, channel);
            keys(get(timeline, "attachment"), duration, path + ".attachment", "attachmentId", "attachmentId", [&](const Json& key, const std::string& at) { logical_attachment(key["attachmentId"], id, at + ".attachmentId"); });
            keys(get(timeline, "color"), duration, path + ".color", "color alpha darkColor", "color alpha darkColor", [&](const Json& key, const std::string& at) {
                color(key["color"], at + ".color"); (void)scalar(key["alpha"], at + ".alpha", 0, 1);
                if (!key["darkColor"].is_null()) { color(key["darkColor"], at + ".darkColor"); used_features_.insert("tint.two-color"); }
            });
            keys(get(timeline, "alpha"), duration, path + ".alpha", "alpha", "alpha", [&](const Json& key, const std::string& at) { (void)scalar(key["alpha"], at + ".alpha", 0, 1); });
        }
        for (const auto& timeline : animation["attachmentTimelines"]) {
            const auto path = field + ".attachmentTimelines"; object(timeline, path, "attachmentId region deform deformSpace sequence", "attachmentId");
            const auto attachment = reference(timeline["attachmentId"], CatalogKind::attachment, path + ".attachmentId"); const auto id = timeline["attachmentId"].get<std::string>();
            const auto& definition = document_["attachments"][attachment]; const auto& geometry = document_["attachments"][index_.geometry_owner[attachment]];
            optional_choice(timeline, "deformSpace", path, "vertexPositions weightedInfluenceOffsets");
            for (const auto* channel : {"region", "deform", "sequence"}) if (!get(timeline, channel).is_null()) claim(2, id, channel);
            if (!get(timeline, "region").is_null() && definition["type"] != "region") fail(path + ".region", "Region timeline requires a Region target.");
            keys(get(timeline, "region"), duration, path + ".region", "x y rotation scaleX scaleY", "x y rotation scaleX scaleY", [&](const Json& key, const std::string& at) {
                for (const auto* name : {"x", "y", "rotation", "scaleX", "scaleY"}) {
                    const auto value = scalar(key[name], at + '.' + name);
                    if ((std::string_view(name) == "scaleX" || std::string_view(name) == "scaleY") && value == 0) fail(at, "Region key scales must be non-zero.");
                }
            });
            if (!get(timeline, "deform").empty()) {
                if (definition["type"] == "region" || definition["type"] == "point" || index_.deform_owner[attachment] != attachment) fail(path + ".deform", "Attachment is not an independent deform owner.");
                used_features_.insert("mesh.deform");
            }
            std::size_t components = get(geometry, "vertices").size();
            if (get(timeline, "deformSpace") == "weightedInfluenceOffsets") {
                if (get(geometry, "weights").empty()) fail(path + ".deformSpace", "Weighted influence offsets require weighted source geometry.");
                components = 0; for (const auto& influences : geometry["weights"]) components += influences.size() * 2;
            }
            keys(get(timeline, "deform"), duration, path + ".deform", "vertices", "vertices", [&](const Json& key, const std::string& at) {
                array(key["vertices"], at + ".vertices"); if (key["vertices"].size() != components) fail(at + ".vertices", "Deform component count differs from its source space.");
                for (const auto& value : key["vertices"]) (void)scalar(value, at + ".vertices");
            });
            if (!get(timeline, "sequence").empty() && (get(definition, "sequence").is_null() || (definition["type"] != "region" && definition["type"] != "mesh"))) fail(path + ".sequence", "Sequence timeline requires setup image sequence.");
            keys(get(timeline, "sequence"), duration, path + ".sequence", "mode index delay", "mode index delay", [&](const Json& key, const std::string& at) {
                (void)choice(key["mode"], at + ".mode", "hold once loop pingpong onceReverse loopReverse pingpongReverse");
                if (unsigned_integer(key["index"], at + ".index") >= get(get(definition, "sequence"), "imageIds").size()) fail(at + ".index", "Sequence key image index is outside setup sequence.");
                (void)scalar(key["delay"], at + ".delay", 0);
            });
        }
        for (const auto& timeline : animation["constraintTimelines"]) {
            const auto path = field + ".constraintTimelines"; object(timeline, path, "type constraintId keys", "type constraintId keys");
            const auto type = choice(timeline["type"], path + ".type", "ik transform path physics slider"); const auto id = string(timeline["constraintId"], path + ".constraintId");
            if (!(type == "physics" && id == "*")) {
                const auto target = reference(timeline["constraintId"], CatalogKind::constraint, path + ".constraintId");
                if (document_["constraints"][target]["type"] != type) fail(path + ".type", "Constraint timeline type does not match its target.");
            }
            array(timeline["keys"], path + ".keys");
            const auto constraint_fields = type == "ik" ? "targetX targetY mix bendPositive compress stretch softness" : type == "transform" ? "mixRotate mixX mixY mixScaleX mixScaleY mixShearY"
                : type == "path" ? "position spacing mixRotate mixX mixY" : type == "physics" ? "mix inertia strength damping mass wind gravity reset" : "sliderTime mix";
            std::set<std::string> owned;
            keys(timeline["keys"], duration, path + ".keys", constraint_fields, "", [&](const Json& key, const std::string& at) {
                for (const auto& property : key.items()) {
                    const auto& name = property.key(); if (name == "time" || name == "curve") continue; owned.insert(name);
                    if (name == "bendPositive" || name == "compress" || name == "stretch" || name == "reset") { (void)boolean(key, name, at); continue; }
                    float low = -std::numeric_limits<float>::max(), high = std::numeric_limits<float>::max();
                    if ((type == "ik" && name == "mix") || (type == "path" && (name == "mixRotate" || name == "mixX" || name == "mixY"))
                        || (type == "physics" && (name == "mix" || name == "inertia" || name == "damping"))) { low = 0; high = 1; }
                    if (name == "softness" || name == "strength") low = 0;
                    if (name == "mass") low = std::numeric_limits<float>::denorm_min();
                    (void)scalar(property.value(), at + '.' + name, low, high);
                }
            });
            for (const auto& property : owned) claim(3, id, property);
        }
        keys(animation["events"], duration, field + ".events", "eventId name integerValue stringValue numberValue audioId volume balance", "eventId name", [&](const Json& key, const std::string& at) {
            if (!key["eventId"].is_null()) (void)reference(key["eventId"], CatalogKind::event, at + ".eventId");
            (void)string(key["name"], at + ".name"); event_values(key, at);
        });
        if (!animation["events"].empty()) used_features_.insert("event");
        auto order = [&](const Json& value, const std::string& at, const std::set<std::size_t>& expected) {
            references(value, CatalogKind::slot, at); std::set<std::size_t> actual;
            for (const auto& id : value) actual.insert(reference(id, CatalogKind::slot, at));
            if (actual != expected) fail(at, "Draw order must include each required slot exactly once.");
        };
        std::set<std::size_t> all_slots; for (std::size_t i = 0; i < document_["slots"].size(); ++i) all_slots.insert(i);
        keys(animation["drawOrder"], duration, field + ".drawOrder", "slotIds", "slotIds", [&](const Json& key, const std::string& at) { order(key["slotIds"], at + ".slotIds", all_slots); });
        for (const auto& folder : animation["drawOrderFolders"]) {
            const auto at = field + ".drawOrderFolders"; object(folder, at, "folderPath slotIds keys", "folderPath slotIds keys");
            (void)string(folder["folderPath"], at + ".folderPath", false, false); references(folder["slotIds"], CatalogKind::slot, at + ".slotIds"); array(folder["keys"], at + ".keys");
            std::set<std::size_t> members; for (const auto& id : folder["slotIds"]) members.insert(reference(id, CatalogKind::slot, at + ".slotIds"));
            keys(folder["keys"], duration, at + ".keys", "slotIds", "slotIds", [&](const Json& key, const std::string& key_at) { order(key["slotIds"], key_at + ".slotIds", members); });
        }
        if (!animation["drawOrder"].empty() || !animation["drawOrderFolders"].empty()) used_features_.insert("timeline.draw-order");
        keys(animation["skins"], duration, field + ".skins", "skinId", "skinId", [&](const Json& key, const std::string& at) { if (!key["skinId"].is_null()) (void)reference(key["skinId"], CatalogKind::skin, at + ".skinId"); });
        if (!animation["skins"].empty()) used_features_.insert("timeline.skin");
    }
}
}
