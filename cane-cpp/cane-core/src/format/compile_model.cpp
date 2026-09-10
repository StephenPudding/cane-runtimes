#include "compile_model.hpp"
#include <numeric>

namespace cane::format {
namespace {
using namespace detail;
Rgb color(const Json& row, const char* field) {
    const auto& value = ModelValidation::get(row, field);
    if (value.is_null()) return {255, 255, 255};
    const auto& hex = value.get_ref<const std::string&>(); const auto start = hex.front() == '#' ? 1u : 0u;
    const auto nibble = [](char c) { return c <= '9' ? c - '0' : c <= 'F' ? c - 'A' + 10 : c - 'a' + 10; };
    Rgb result{};
    for (std::size_t i = 0; i < result.size(); ++i) result[i] = static_cast<std::uint8_t>(16 * nibble(hex[start + 2 * i]) + nibble(hex[start + 2 * i + 1]));
    return result;
}
std::optional<std::string> optional_string(const Json& row, const char* field) {
    const auto& value = ModelValidation::get(row, field);
    return value.is_null() ? std::nullopt : std::optional<std::string>(value.get<std::string>());
}
}
detail::RuntimeModel compile_model(const Json& document, const ModelIndex& index) {
    using namespace detail;
    RuntimeModel model;
    const auto ref = [&](CatalogKind kind, const Json& value) { return index.catalogs[static_cast<std::size_t>(kind)].at(value.get<std::string>()); };
    for (const auto& row : document["slots"]) {
        SlotDefinition slot; slot.bone = ref(CatalogKind::bone, row["boneId"]);
        slot.attachment_key = optional_string(row, "attachmentId"); slot.z_index = row["zIndex"].get<std::int64_t>();
        const auto mode = row["blendMode"].get<std::string>();
        slot.blend = mode == "add" ? BlendMode::add : mode == "multiply" ? BlendMode::multiply : mode == "screen" ? BlendMode::screen : BlendMode::normal;
        slot.color = color(row, "color"); slot.alpha = row.value("alpha", 1.0f);
        if (!ModelValidation::get(row, "darkColor").is_null()) slot.dark = color(row, "darkColor");
        model.slots.push_back(std::move(slot));
    }
    for (const auto& row : document["attachments"]) {
        AttachmentDefinition a; const auto i = model.attachments.size(); const auto type = row["type"].get<std::string>();
        a.kind = type == "mesh" ? AttachmentKind::mesh : type == "path" ? AttachmentKind::path : type == "point" ? AttachmentKind::point : type == "boundingbox" ? AttachmentKind::bounding_box : type == "clipping" ? AttachmentKind::clipping : AttachmentKind::region;
        a.slot = ref(CatalogKind::slot, row["slotId"]); a.geometry_owner = index.geometry_owner[i]; a.deform_owner = index.deform_owner[i];
        a.local = {row.value("x", 0.0f), row.value("y", 0.0f), row.value("rotation", 0.0f), row.value("scaleX", 1.0f), row.value("scaleY", 1.0f), 0, 0};
        if (row.contains("imageId")) a.image = ref(CatalogKind::image, row["imageId"]);
        a.color = color(row, "color"); a.alpha = row.value("alpha", 1.0f);
        if (!ModelValidation::get(row, "sequence").is_null()) {
            for (const auto& image : row["sequence"]["imageIds"]) a.sequence_images.push_back(ref(CatalogKind::image, image));
            a.sequence_setup = row["sequence"].value("setupIndex", 0u);
        }
        a.closed = row.value("closed", false); a.constant_speed = row.value("constantSpeed", true);
        a.convex = row.value("convex", false); a.inverse = row.value("inverse", false);
        if (row.contains("lengths")) a.lengths = row["lengths"].get<std::vector<float>>();
        if (!ModelValidation::get(row, "endSlotId").is_null()) a.end_slot = ref(CatalogKind::slot, row["endSlotId"]);
        auto& g = a.geometry;
        if (row.contains("vertices")) g.positions = row["vertices"].get<std::vector<float>>();
        if (row.contains("uvs")) g.uvs = row["uvs"].get<std::vector<float>>();
        if (row.contains("indices")) g.indices = row["indices"].get<std::vector<std::uint32_t>>();
        const auto& weights = ModelValidation::get(row, "weights");
        if (!weights.empty()) {
            for (std::size_t point = 0; point < weights.size(); ++point) {
                g.influence_starts.push_back(g.influences.size());
                for (const auto& weight : weights[point]) {
                    Influence influence; influence.bone = ref(CatalogKind::bone, weight["boneId"]); influence.weight = weight["weight"].get<float>();
                    if (ModelValidation::get(weight, "x").is_null()) {
                        const auto& b = row["bindInverses"][weight["boneId"].get<std::string>()];
                        influence.bind_inverse = Affine{b["a"].get<float>(), b["b"].get<float>(), b["c"].get<float>(), b["d"].get<float>(), b["tx"].get<float>(), b["ty"].get<float>()};
                        influence.setup_local = influence.bind_inverse->transform({g.positions[2 * point], g.positions[2 * point + 1]});
                    } else influence.setup_local = {weight["x"].get<float>(), weight["y"].get<float>()};
                    g.influences.push_back(influence);
                }
            }
            g.influence_starts.push_back(g.influences.size());
        }
        model.attachments.push_back(std::move(a));
    }
    model.bone_skins.resize(document["bones"].size()); model.constraint_skins.resize(document["constraints"].size());
    for (const auto& row : document["skins"]) {
        SkinDefinition skin; const auto i = model.skins.size();
        if (i == 0) model.default_skin = i;
        for (const auto& id : row["boneIds"]) { const auto bone = ref(CatalogKind::bone, id); skin.bones.push_back(bone); model.bone_skins[bone].push_back(i); }
        for (const auto& id : row["constraintIds"]) { const auto constraint = ref(CatalogKind::constraint, id); skin.constraints.push_back(constraint); model.constraint_skins[constraint].push_back(i); }
        for (const auto& mapping : row["attachments"]) {
            SkinMapping m; m.slot = ref(CatalogKind::slot, mapping["slotId"]); m.placeholder = optional_string(mapping, "name");
            if (!mapping["attachmentId"].is_null()) m.attachment = ref(CatalogKind::attachment, mapping["attachmentId"]);
            skin.mappings.push_back(std::move(m));
        }
        model.skins.push_back(std::move(skin));
    }
    model.setup_order.resize(model.slots.size()); std::iota(model.setup_order.begin(), model.setup_order.end(), std::size_t{0});
    std::stable_sort(model.setup_order.begin(), model.setup_order.end(), [&](std::size_t a, std::size_t b) { return model.slots[a].z_index < model.slots[b].z_index; });
    compile_constraints(document, index, model); return model;
}
}
