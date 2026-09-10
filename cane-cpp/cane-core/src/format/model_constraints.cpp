#include "model_validation.hpp"

namespace cane::format {
void ModelValidation::constraints() {
    std::size_t ordinal = 0;
    for (const auto& row : document_["constraints"]) {
        const auto field = "constraints[" + std::to_string(ordinal++) + ']'; const std::string common = "type id name ";
        const auto type = choice(get(row, "type"), field + ".type", "ik transform path physics slider");
        (void)string(get(row, "name"), field + ".name"); used_features_.insert("constraint." + type);
        if (type == "ik") {
            const auto fields = common + "chainBoneIds targetBoneId target mix bendPositive compress stretch uniform softness iterations threshold"; object(row, field, fields, fields);
            references(row["chainBoneIds"], CatalogKind::bone, field + ".chainBoneIds", true);
            for (std::size_t i = 1; i < row["chainBoneIds"].size(); ++i) {
                const auto bone = reference(row["chainBoneIds"][i], CatalogKind::bone, field + ".chainBoneIds");
                if (document_["bones"][bone]["parentId"] != row["chainBoneIds"][i - 1]) fail(field + ".chainBoneIds", "IK chain must be direct parent-to-child order.");
            }
            if (!row["targetBoneId"].is_null()) (void)reference(row["targetBoneId"], CatalogKind::bone, field + ".targetBoneId");
            object(row["target"], field + ".target", "x y", "x y"); (void)scalar(row["target"]["x"], field + ".target.x"); (void)scalar(row["target"]["y"], field + ".target.y");
            (void)number(row, "mix", field, 1, 0, 1); (void)number(row, "softness", field, 0, 0); (void)number(row, "threshold", field, 0, 0);
            for (const auto* key : {"bendPositive", "compress", "stretch"}) (void)boolean(row, key, field);
            if (!row["uniform"].is_boolean() && row["uniform"] != "volume") fail(field + ".uniform", "IK uniform must be a boolean or volume.");
            if (unsigned_integer(row["iterations"], field + ".iterations") == 0) fail(field + ".iterations", "IK iterations must be positive.");
        } else if (type == "transform") {
            object(row, field, common + "boneIds targetBoneId local relative rotation x y scaleX scaleY shearY mixRotate mixX mixY mixScaleX mixScaleY mixShearY mapping", common + "boneIds targetBoneId");
            references(row["boneIds"], CatalogKind::bone, field + ".boneIds", true); (void)reference(row["targetBoneId"], CatalogKind::bone, field + ".targetBoneId");
            std::unordered_set<std::size_t> driven;
            for (const auto& id : row["boneIds"]) driven.insert(reference(id, CatalogKind::bone, field + ".boneIds"));
            auto ancestor = reference(row["targetBoneId"], CatalogKind::bone, field + ".targetBoneId");
            for (;;) {
                if (driven.count(ancestor)) fail(field + ".targetBoneId", "Transform target cannot be driven or descend from a driven bone.");
                const auto& parent = document_["bones"][ancestor]["parentId"]; if (parent.is_null()) break;
                ancestor = reference(parent, CatalogKind::bone, field + ".targetBoneId");
            }
            (void)boolean(row, "local", field); (void)boolean(row, "relative", field);
            for (const auto* key : {"rotation", "x", "y", "scaleX", "scaleY", "shearY", "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"}) (void)number(row, key, field);
            if (!get(row, "mapping").is_null()) {
                const auto& mapping = row["mapping"]; object(mapping, field + ".mapping", "localSource localTarget clamp properties", "properties");
                for (const auto* key : {"localSource", "localTarget", "clamp"}) (void)boolean(mapping, key, field + ".mapping");
                array(mapping["properties"], field + ".mapping.properties");
                std::set<std::string> source_properties;
                for (const auto& source : mapping["properties"]) {
                    object(source, field + ".mapping.source", "property offset targets", "property targets"); (void)choice(source["property"], field + ".mapping.source.property", mapping_properties);
                    if (!source_properties.insert(source["property"].get<std::string>()).second) fail(field + ".mapping.source.property", "Mapping source properties must be unique.");
                    (void)number(source, "offset", field + ".mapping.source"); array(source["targets"], field + ".mapping.targets");
                    if (source["targets"].empty()) fail(field + ".mapping.targets", "Transform source mapping requires a target.");
                    std::set<std::string> target_properties;
                    for (const auto& target : source["targets"]) {
                        object(target, field + ".mapping.target", "property offset max scale", "property"); (void)choice(target["property"], field + ".mapping.target.property", mapping_properties);
                        if (!target_properties.insert(target["property"].get<std::string>()).second) fail(field + ".mapping.target.property", "Mapping targets must be unique within each source.");
                        for (const auto* key : {"offset", "max", "scale"}) (void)number(target, key, field + ".mapping.target");
                    }
                }
            }
        } else if (type == "path") {
            const auto fields = common + "boneIds targetSlotId positionMode spacingMode rotateMode rotation position spacing mixRotate mixX mixY"; object(row, field, fields, fields);
            references(row["boneIds"], CatalogKind::bone, field + ".boneIds", true); (void)reference(row["targetSlotId"], CatalogKind::slot, field + ".targetSlotId");
            (void)choice(row["positionMode"], field + ".positionMode", "fixed percent"); (void)choice(row["spacingMode"], field + ".spacingMode", "length fixed percent proportional");
            (void)choice(row["rotateMode"], field + ".rotateMode", "tangent chain chainScale");
            for (const auto* key : {"rotation", "position", "spacing"}) (void)number(row, key, field);
            for (const auto* key : {"mixRotate", "mixX", "mixY"}) (void)number(row, key, field, 1, 0, 1);
        } else if (type == "physics") {
            object(row, field, common + "boneId x y rotate scaleX scaleYMode shearX limit fps inertia strength damping mass wind gravity mix inertiaGlobal strengthGlobal dampingGlobal massGlobal windGlobal gravityGlobal mixGlobal", common + "boneId");
            (void)reference(row["boneId"], CatalogKind::bone, field + ".boneId"); optional_choice(row, "scaleYMode", field, "none uniform volume");
            for (const auto* key : {"x", "y", "rotate", "scaleX", "shearX", "inertia", "damping", "mix"}) (void)number(row, key, field, 0, 0, 1);
            for (const auto* key : {"limit", "strength"}) (void)number(row, key, field, 0, 0);
            for (const auto* key : {"fps", "mass"}) (void)number(row, key, field, 1, std::numeric_limits<float>::denorm_min());
            for (const auto* key : {"wind", "gravity"}) (void)number(row, key, field);
            for (const auto* key : {"inertiaGlobal", "strengthGlobal", "dampingGlobal", "massGlobal", "windGlobal", "gravityGlobal", "mixGlobal"}) (void)boolean(row, key, field);
        } else {
            object(row, field, common + "animationId looping additive sourceBoneId sourceProperty sourceOffset timeOffset timeScale rangeMax local time mix", common + "animationId");
            (void)reference(row["animationId"], CatalogKind::animation, field + ".animationId");
            if (!get(row, "sourceBoneId").is_null()) (void)reference(row["sourceBoneId"], CatalogKind::bone, field + ".sourceBoneId");
            optional_choice(row, "sourceProperty", field, mapping_properties);
            for (const auto* key : {"looping", "additive", "local"}) (void)boolean(row, key, field);
            for (const auto* key : {"sourceOffset", "timeOffset", "timeScale", "time", "mix"}) (void)number(row, key, field);
            (void)number(row, "rangeMax", field, 0, 0);
        }
    }
}
void ModelValidation::logical_attachment(const Json& key, const std::string& slot_id, const std::string& field) const {
    if (key.is_null()) return;
    const auto name = string(key, field); const auto& attachments = index_.catalogs[static_cast<std::size_t>(CatalogKind::attachment)];
    const auto found = attachments.find(name);
    if (found != attachments.end() && document_["attachments"][found->second]["slotId"] == slot_id) return;
    const auto placeholders = index_.placeholders.find(slot_id);
    if (placeholders != index_.placeholders.end() && placeholders->second.find(name) != placeholders->second.end()) return;
    fail(field, "Logical attachment key is neither an owned attachment nor a declared skin placeholder.");
}
void ModelValidation::event_values(const Json& row, const std::string& field) const {
    if (!get(row, "integerValue").is_null()) (void)signed_integer(row["integerValue"], field + ".integerValue");
    if (!get(row, "stringValue").is_null()) (void)string(row["stringValue"], field + ".stringValue", false, false);
    if (!get(row, "numberValue").is_null()) (void)scalar(row["numberValue"], field + ".numberValue");
    if (!get(row, "audioId").is_null()) (void)reference(row["audioId"], CatalogKind::audio, field + ".audioId");
    // Nullable key values mean that the event default remains applicable.
    if (!get(row, "volume").is_null()) (void)scalar(row["volume"], field + ".volume", 0, 1);
    if (!get(row, "balance").is_null()) (void)scalar(row["balance"], field + ".balance", -1, 1);
}
void ModelValidation::check_skin_shape(const Json& skin, const std::string& field) {
    constexpr auto fields = "id name attachments boneIds constraintIds export"; object(skin, field, fields, fields);
    (void)string(skin["name"], field + ".name"); (void)boolean(skin, "export", field);
    references(skin["boneIds"], CatalogKind::bone, field + ".boneIds"); references(skin["constraintIds"], CatalogKind::constraint, field + ".constraintIds");
    array(skin["attachments"], field + ".attachments"); std::set<std::pair<std::string, std::optional<std::string>>> unique;
    for (const auto& mapping : skin["attachments"]) {
        object(mapping, field + ".attachments", "slotId attachmentId name", "slotId attachmentId name");
        (void)reference(mapping["slotId"], CatalogKind::slot, field + ".slotId"); const auto slot_id = mapping["slotId"].get<std::string>(); std::optional<std::string> placeholder;
        if (!mapping["name"].is_null()) { placeholder = string(mapping["name"], field + ".name"); index_.placeholders[slot_id].insert(*placeholder); }
        if (!unique.emplace(slot_id, placeholder).second) fail(field + ".attachments", "Duplicate skin slot/placeholder mapping.");
        if (!mapping["attachmentId"].is_null()) {
            const auto attachment = reference(mapping["attachmentId"], CatalogKind::attachment, field + ".attachmentId");
            if (!detached_ && document_["attachments"][attachment]["slotId"] != mapping["slotId"]) fail(field + ".attachmentId", "Skin attachment belongs to another slot.");
        }
    }
}
void ModelValidation::skins_and_events() {
    for (const auto& value : document_["skins"]) check_skin_shape(value, "skins." + value["id"].get<std::string>());
    if (!document_["skins"].empty()) used_features_.insert("skin");
    for (const auto& slot : document_["slots"]) logical_attachment(slot["attachmentId"], slot["id"].get<std::string>(), "slots.attachmentId");
    for (const auto& event : document_["events"]) {
        const auto field = "events." + event["id"].get<std::string>();
        object(event, field, "id name integerValue stringValue numberValue audioId volume balance", "id name integerValue stringValue numberValue audioId");
        (void)string(event["name"], field + ".name"); event_values(event, field);
        if (event.contains("volume")) (void)number(event, "volume", field, 1, 0, 1);
        if (event.contains("balance")) (void)number(event, "balance", field, 0, -1, 1);
    }
    if (!document_["events"].empty()) used_features_.insert("event");
}
}
