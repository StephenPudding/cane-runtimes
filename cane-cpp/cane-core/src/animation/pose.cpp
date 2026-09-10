#include "pose.hpp"
#include "runtime_data_internal.hpp"

namespace cane::animation {
float Layer::weight(PropertyDomain domain, std::size_t target, std::size_t component) const {
    const auto value = property_alpha ? property_alpha(weight_context, {domain, target, component}) : alpha;
    if (!std::isfinite(value)) throw Error(ErrorCode::non_finite, "apply", "Property layer weight must be finite.", "alpha");
    return value;
}
const detail::RuntimeModel& Pose::model() const noexcept { return detail::RuntimeDataAccess::get(data_).model; }
Pose::Pose(RuntimeData data) : data_(std::move(data)) {
    const auto& m = model(); const auto& bones = data_.bones();
    locals.resize(bones.size()); modes.resize(bones.size()); world.resize(bones.size()); active_bones.resize(bones.size());
    slots.resize(m.slots.size()); regions.resize(m.attachments.size()); deforms.resize(m.attachments.size()); sequence_indices.resize(m.attachments.size());
    constraints.resize(m.constraints.size()); diagnostics.resize(m.constraints.size()); active_constraints.resize(m.constraints.size()); skin_active_.resize(m.skins.size()); order_members_.resize(m.slots.size());
    std::size_t maximum_components = 0;
    for (std::size_t i = 0; i < m.attachments.size(); ++i) {
        const auto& attachment = m.attachments[i]; const auto& geometry = m.attachments[attachment.geometry_owner].geometry;
        maximum_components = std::max(maximum_components, std::max(geometry.positions.size(), geometry.deform_components()));
        if (attachment.deform_owner == i) deforms[i].values.resize(geometry.deform_components());
    }
    sampled_deform_.resize(maximum_components); canonical_deform_.resize(maximum_components);
    reset(m.default_skin ? std::vector<std::size_t>{*m.default_skin} : std::vector<std::size_t>{});
    resolve_attachments(); update_world();
}
void Pose::reset(const std::vector<std::size_t>& active_skins) {
    for (const auto skin : active_skins) if (skin >= model().skins.size()) throw Error(ErrorCode::invalid_argument, "apply", "Skin index is outside its catalog.", "skins");
    const auto& m = model(); const auto& bones = data_.bones(); skins = active_skins;
    for (std::size_t i = 0; i < bones.size(); ++i) { locals[i] = bones[i].setup; modes[i] = bones[i].transform_mode; }
    for (std::size_t i = 0; i < slots.size(); ++i) {
        const auto& setup = m.slots[i]; auto& slot = slots[i];
        slot.key = setup.attachment_key; slot.attachment.reset(); slot.color = setup.color; slot.dark = setup.dark; slot.alpha = setup.alpha;
    }
    for (std::size_t i = 0; i < regions.size(); ++i) { regions[i] = m.attachments[i].local; deforms[i].enabled = false; sequence_indices[i] = m.attachments[i].sequence_setup; }
    for (std::size_t i = 0; i < constraints.size(); ++i) { constraints[i] = m.constraints[i].setup; diagnostics[i] = std::monostate{}; }
    order = m.setup_order; order_sampled = false;
}
void Pose::resolve_attachments() {
    const auto& state = detail::RuntimeDataAccess::get(data_); const auto& m = state.model;
    std::fill(skin_active_.begin(), skin_active_.end(), false);
    for (const auto skin : skins) {
        if (skin >= skin_active_.size()) throw Error(ErrorCode::invalid_argument, "apply", "Skin index is outside its catalog.", "skins");
        skin_active_[skin] = true;
    }
    const auto active = [&](const std::vector<std::size_t>& membership) {
        return membership.empty() || std::any_of(membership.begin(), membership.end(), [&](std::size_t skin) { return skin_active_[skin]; });
    };
    for (std::size_t i = 0; i < active_bones.size(); ++i) active_bones[i] = active(m.bone_skins[i]);
    for (std::size_t i = 0; i < active_constraints.size(); ++i) active_constraints[i] = active(m.constraint_skins[i]);
    for (std::size_t i = 0; i < slots.size(); ++i) {
        auto& slot = slots[i]; slot.attachment.reset();
        if (!slot.key) continue;
        const auto direct = state.index.catalogs[6].find(*slot.key);
        if (direct != state.index.catalogs[6].end() && m.attachments[direct->second].slot == i) slot.attachment = direct->second;
    }
    const auto apply_skin = [&](std::size_t skin) {
        for (const auto& mapping : m.skins[skin].mappings) {
            auto& slot = slots[mapping.slot];
            if (slot.key && (!mapping.placeholder || mapping.placeholder == slot.key)) slot.attachment = mapping.attachment;
        }
    };
    if (!skins.empty() && m.default_skin && !skin_active_[*m.default_skin]) apply_skin(*m.default_skin);
    for (const auto skin : skins) apply_skin(skin);
}
void Pose::update_world(const Affine& root) {
    if (!root.finite()) throw Error(ErrorCode::non_finite, "apply", "Root matrix must be finite.", "rootTransform");
    const auto& bones = data_.bones();
    for (std::size_t i = 0; i < bones.size(); ++i) {
        world[i] = bones[i].parent_index ? Affine::child(world[*bones[i].parent_index], locals[i], modes[i]) : root * Affine::from_local(locals[i]);
        if (!world[i].finite()) throw Error(ErrorCode::non_finite, "apply", "Bone world matrix is non-finite.", "bones", bones[i].id);
    }
}
std::optional<std::size_t> Pose::selected_image(std::size_t attachment) const {
    const auto& a = model().attachments.at(attachment);
    return a.sequence_images.empty() ? a.image : std::optional<std::size_t>(a.sequence_images.at(sequence_indices.at(attachment)));
}
Affine Pose::attachment_affine(std::size_t attachment) const {
    const auto& a = model().attachments.at(attachment); const auto bone = model().slots[a.slot].bone;
    const auto result = a.kind == detail::AttachmentKind::region || a.kind == detail::AttachmentKind::point ? world[bone] * Affine::from_local(regions[attachment]) : world[bone];
    if (!result.finite()) throw Error(ErrorCode::non_finite, "apply", "Attachment affine matrix is non-finite.", "attachments", data_.catalog(RuntimeCatalogKind::attachment)[attachment].id);
    return result;
}
Tint Pose::attachment_tint(std::size_t attachment) const {
    const auto& a = model().attachments.at(attachment); const auto& slot = slots[a.slot];
    Tint result{slot.color, slot.dark, std::clamp(slot.alpha, 0.0f, 1.0f) * std::clamp(a.alpha, 0.0f, 1.0f)};
    for (std::size_t i = 0; i < result.light.size(); ++i) result.light[i] = static_cast<std::uint8_t>((static_cast<unsigned>(slot.color[i]) * a.color[i] + 127u) / 255u);
    return result;
}
}
