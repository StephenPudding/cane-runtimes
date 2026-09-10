#include "model_validation.hpp"
#include "cane/error.hpp"
#include <cmath>

namespace cane::format {
void ModelValidation::check_attachment_shape(const Json& row, const std::string& field) {
    const auto type = choice(get(row, "type"), field + ".type", "region mesh path point boundingbox clipping");
    const std::string common = "type id name slotId ";
    if (type == "region") object(row, field, common + "imageId x y rotation scaleX scaleY color alpha sequence", common + "imageId x y rotation scaleX scaleY");
    else if (type == "mesh") object(row, field, common + "imageId rows cols vertices uvs indices weights bindInverses edges hull color alpha sequence link", common + "imageId rows cols vertices uvs indices weights bindInverses edges hull");
    else if (type == "point") object(row, field, common + "x y rotation", common);
    else if (type == "path") object(row, field, common + "closed constantSpeed lengths vertices weights bindInverses", common);
    else if (type == "boundingbox") object(row, field, common + "vertices weights bindInverses", common);
    else object(row, field, common + "endSlotId convex inverse vertices weights bindInverses", common);
    (void)string(row["name"], field + ".name"); const auto slot = reference(row["slotId"], CatalogKind::slot, field + ".slotId");
    used_features_.insert("attachment." + (type == "boundingbox" ? "bounding-box" : type));
    if (type == "region" || type == "mesh") {
        (void)reference(row["imageId"], CatalogKind::image, field + ".imageId");
        if (row.contains("color")) color(row["color"], field + ".color");
        (void)number(row, "alpha", field, 1, 0, 1);
        if (!get(row, "sequence").is_null()) {
            const auto& sequence = row["sequence"]; object(sequence, field + ".sequence", "imageIds setupIndex", "imageIds");
            array(sequence["imageIds"], field + ".sequence.imageIds"); if (sequence["imageIds"].empty()) fail(field + ".sequence", "Sequence must contain images.");
            for (const auto& id : sequence["imageIds"]) (void)reference(id, CatalogKind::image, field + ".sequence.imageIds");
            const auto setup = sequence.contains("setupIndex") ? unsigned_integer(sequence["setupIndex"], field + ".sequence.setupIndex") : 0;
            if (setup >= sequence["imageIds"].size()) fail(field + ".sequence.setupIndex", "Sequence index is outside its image list.");
            used_features_.insert("attachment.sequence");
        }
    }
    if (type == "region" || type == "point") {
        for (const auto* key : {"x", "y", "rotation"}) (void)number(row, key, field);
        if (type == "region" && (number(row, "scaleX", field) == 0 || number(row, "scaleY", field) == 0)) fail(field, "Region setup scales must be non-zero.");
        return;
    }
    if (!get(row, "link").is_null()) {
        const auto& link = row["link"]; object(link, field + ".link", "parentMeshId inheritDeform", "parentMeshId");
        const auto parent = reference(link["parentMeshId"], CatalogKind::attachment, field + ".link.parentMeshId");
        if (!detached_ && get(document_["attachments"][parent], "type") != "mesh") fail(field + ".link.parentMeshId", "Linked source must be a mesh.");
        (void)boolean(link, "inheritDeform", field + ".link", true);
        if (unsigned_integer(row["rows"], field + ".rows") != 0 || unsigned_integer(row["cols"], field + ".cols") != 0) fail(field, "Linked mesh grid metadata must be zero.");
        for (const auto* key : {"vertices", "uvs", "indices", "weights"}) { array(row[key], field + '.' + key); if (!row[key].empty()) fail(field + '.' + key, "Linked mesh cannot contain independent geometry."); }
        for (const auto* key : {"bindInverses", "edges", "hull"}) if (!row[key].is_null()) fail(field + '.' + key, "Linked mesh geometry fields must be null.");
        return;
    }
    vertices(row, field, type);
    if (type == "path") {
        (void)boolean(row, "closed", field); (void)boolean(row, "constantSpeed", field, true);
        if (row.contains("lengths")) {
            const auto& lengths = row["lengths"]; array(lengths, field + ".lengths");
            if (!lengths.empty() && lengths.size() != get(row, "vertices").size() / 6) fail(field + ".lengths", "Path needs one cumulative length per knot.");
            float previous = 0;
            for (const auto& length : lengths) { const auto value = scalar(length, field + ".lengths", 0); if (value < previous) fail(field + ".lengths", "Path cumulative lengths must not decrease."); previous = value; }
        }
    } else if (type == "clipping") {
        (void)boolean(row, "convex", field); (void)boolean(row, "inverse", field);
        if (!get(row, "endSlotId").is_null()) {
            const auto end = reference(row["endSlotId"], CatalogKind::slot, field + ".endSlotId");
            if (!detached_) {
                const auto start_order = std::make_pair(signed_integer(document_["slots"][slot]["zIndex"], field), slot);
                const auto end_order = std::make_pair(signed_integer(document_["slots"][end]["zIndex"], field), end);
                if (end_order < start_order) fail(field + ".endSlotId", "Clipping end precedes its setup slot.");
            }
        }
    }
}
void ModelValidation::attachments() {
    const auto& entries = document_["attachments"];
    for (std::size_t i = 0; i < entries.size(); ++i) check_attachment_shape(entries[i], "attachments[" + std::to_string(i) + "]");
    index_.geometry_owner.resize(entries.size()); index_.deform_owner.resize(entries.size());
    std::vector<unsigned char> resolved(entries.size(), 0);
    for (std::size_t i = 0; i < entries.size(); ++i) {
        if (resolved[i] == 2) continue;
        std::vector<std::size_t> chain; auto current = i;
        while (resolved[current] == 0) {
            resolved[current] = 1; chain.push_back(current); const auto& link = get(entries[current], "link");
            if (link.is_null()) { index_.geometry_owner[current] = current; index_.deform_owner[current] = current; resolved[current] = 2; break; }
            current = reference(link["parentMeshId"], CatalogKind::attachment, "attachments.link.parentMeshId");
        }
        if (resolved[current] == 1) fail("attachments.link", "Linked mesh parent cycle.");
        for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
            if (resolved[*it] == 2) continue;
            const auto& link = entries[*it]["link"]; const auto parent = reference(link["parentMeshId"], CatalogKind::attachment, "attachments.link.parentMeshId");
            index_.geometry_owner[*it] = index_.geometry_owner[parent];
            index_.deform_owner[*it] = boolean(link, "inheritDeform", "attachments.link", true) ? index_.deform_owner[parent] : *it;
            resolved[*it] = 2;
        }
    }
}
void ModelValidation::vertices(const Json& row, const std::string& field, const std::string& type) {
    const auto& points = get(row, "vertices");
    if (row.contains("vertices")) array(points, field + ".vertices");
    const auto count = points.size() / 2;
    if (count > 65536) throw Error(ErrorCode::resource_limit, operation_, "Source geometry exceeds 65536 vertices.", field + ".vertices");
    if (points.size() % 2 != 0) fail(field + ".vertices", "Source vertices must be XY pairs.");
    for (const auto& component : points) (void)scalar(component, field + ".vertices");
    if (type == "mesh") {
        const std::uint64_t rows = unsigned_integer(row["rows"], field + ".rows"), cols = unsigned_integer(row["cols"], field + ".cols");
        if (rows == 0 || cols == 0 || (rows * cols != count && (rows >= 65536 || cols >= 65536 || (rows + 1) * (cols + 1) != count))) fail(field, "Non-linked mesh grid dimensions must be positive and match its source vertex count.");
        array(row["uvs"], field + ".uvs"); if (row["uvs"].size() != points.size()) fail(field + ".uvs", "Mesh UV count differs from source positions.");
        for (const auto& value : row["uvs"]) (void)scalar(value, field + ".uvs");
        array(row["indices"], field + ".indices"); if (row["indices"].size() % 3 != 0) fail(field + ".indices", "Mesh triangles need three indices.");
        for (const auto* key : {"indices", "edges"}) if (!get(row, key).is_null()) {
            array(row[key], field + '.' + key);
            if (std::string_view(key) == "edges" && row[key].size() % 2 != 0) fail(field + ".edges", "Mesh edges must be index pairs.");
            for (const auto& index : row[key]) if (unsigned_integer(index, field + '.' + key, 65535) >= count) fail(field + '.' + key, "Mesh index is outside its source vertices.");
        }
        if (!get(row, "hull").is_null()) { array(row["hull"], field + ".hull"); if (row["hull"].size() % 2 != 0) fail(field + ".hull", "Hull needs XY pairs."); for (const auto& value : row["hull"]) (void)scalar(value, field + ".hull"); }
    }
    if (type == "path" && (points.size() < 12 || points.size() % 6 != 0)) fail(field + ".vertices", "Path needs at least two cubic knots.");
    if (type == "clipping") {
        if (count < 3) fail(field + ".vertices", "Clipping requires at least three points.");
        double area = 0;
        for (std::size_t i = 0; i < count; ++i) { const auto next = (i + 1) % count; area += points[i * 2].get<double>() * points[next * 2 + 1].get<double>() - points[next * 2].get<double>() * points[i * 2 + 1].get<double>(); }
        if (!std::isfinite(area) || area == 0) fail(field + ".vertices", "Clipping source polygon is degenerate.");
    }
    const auto& inverses = get(row, "bindInverses");
    if (!inverses.is_null()) {
        if (!inverses.is_object()) fail(field + ".bindInverses", "Bind inverses must be keyed by bone ID.");
        for (const auto& entry : inverses.items()) {
            (void)reference(Json(entry.key()), CatalogKind::bone, field + ".bindInverses");
            object(entry.value(), field + ".bindInverses." + entry.key(), "a b c d tx ty", "a b c d tx ty");
            for (const auto& component : entry.value()) (void)scalar(component, field + ".bindInverses." + entry.key());
        }
    }
    const auto& weights = get(row, "weights"); if (row.contains("weights")) array(weights, field + ".weights");
    if (!weights.empty() && weights.size() != count) fail(field + ".weights", "Weight rows must match source vertices.");
    if (!weights.empty()) used_features_.insert("mesh.weighted");
    for (const auto& influences : weights) {
        array(influences, field + ".weights"); if (influences.empty() || influences.size() > 16) fail(field + ".weights", "A vertex needs one to sixteen influences.");
        float sum = 0;
        for (const auto& influence : influences) {
            object(influence, field + ".weights", "boneId weight x y", "boneId weight");
            (void)reference(influence["boneId"], CatalogKind::bone, field + ".weights.boneId"); sum += scalar(influence["weight"], field + ".weights.weight", 0);
            const bool x_missing = get(influence, "x").is_null(), y_missing = get(influence, "y").is_null();
            if (x_missing != y_missing) fail(field + ".weights", "Influence local coordinates must be supplied as a pair.");
            if (x_missing) { if (get(inverses, influence["boneId"].get<std::string>()).is_null()) fail(field + ".weights", "Influence requires a bind inverse when local coordinates are absent."); }
            else { (void)scalar(influence["x"], field + ".weights.x"); (void)scalar(influence["y"], field + ".weights.y"); }
        }
        if (!std::isfinite(sum) || std::abs(sum - 1) > .001f) fail(field + ".weights", "Influence weights must sum to one within 0.001.");
    }
}
}
