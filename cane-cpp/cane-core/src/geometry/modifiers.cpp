#include "geometry_editor.hpp"
#include "runtime_data_internal.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <set>

namespace cane::geometry {
namespace {
void finite(double value, const char* op, const std::string& field) {
    if (!std::isfinite(value)) throw Error(ErrorCode::invalid_argument, op, "Geometry modifier parameter must be finite.", field);
}
void targets(const RuntimeData& data, const std::vector<std::string>& ids, RuntimeCatalogKind kind, const char* op, const std::string& field) {
    const auto& catalog = detail::RuntimeDataAccess::get(data).index.catalogs[static_cast<std::size_t>(kind)];
    std::set<std::string_view> seen;
    for (std::size_t i = 0; i < ids.size(); ++i) {
        const auto& id = ids[i]; const auto path = field + "[" + std::to_string(i) + "]";
        if (id.empty() || id.find('\0') != std::string::npos) throw Error(ErrorCode::invalid_argument, op, "Modifier target ID must be nonempty and NUL-free.", path, id);
        if (!seen.insert(id).second) throw Error(ErrorCode::invalid_argument, op, "Modifier target IDs must be unique.", path, id);
        if (!catalog.count(id)) throw Error(ErrorCode::not_found, op, "Modifier target is missing.", path, id);
    }
}
bool matches(const GeometryFilter& f, const RenderAttachment& a) {
    const auto member = [](const std::vector<std::string>& ids, const std::string& id) {
        return ids.empty() || std::find(ids.begin(), ids.end(), id) != ids.end();
    };
    return member(f.attachment_ids, a.attachment_id) && member(f.slot_ids, a.slot_id);
}
bool matches(const GeometryModifiers* list, const RenderAttachment& a) {
    return list && std::any_of(list->operations.begin(), list->operations.end(), [&](const auto& m) { return matches(m.filter, a); });
}
double area(const RenderAttachment& a, std::size_t triangle) {
    const auto& v = a.world_vertices_xy;
    const auto x = static_cast<std::size_t>(a.indices[triangle]) * 2;
    const auto y = static_cast<std::size_t>(a.indices[triangle + 1]) * 2;
    const auto z = static_cast<std::size_t>(a.indices[triangle + 2]) * 2;
    return (static_cast<double>(v[y]) - v[x]) * (static_cast<double>(v[z + 1]) - v[x + 1])
        - (static_cast<double>(v[y + 1]) - v[x + 1]) * (static_cast<double>(v[z]) - v[x]);
}
float binary32(double value) {
    // Avoid an out-of-range native floating conversion; publication validation rejects infinity.
    if (value > std::numeric_limits<float>::max()) return std::numeric_limits<float>::infinity();
    if (value < -std::numeric_limits<float>::max()) return -std::numeric_limits<float>::infinity();
    return static_cast<float>(value);
}
double signed_hash(std::uint32_t seed, std::uint32_t draw, std::uint32_t vertex, std::uint32_t tick, std::uint32_t salt) {
    std::uint32_t hash = seed ^ (draw + 1U) * 0x9e3779b9U ^ (vertex + 1U) * 0x85ebca6bU ^ tick * 0xc2b2ae35U ^ salt;
    hash ^= hash >> 16U; hash *= 0x7feb352dU; hash ^= hash >> 15U; hash *= 0x846ca68bU; hash ^= hash >> 16U;
    return static_cast<double>(hash) / 4294967295.0 * 2 - 1;
}
void jitter(RenderAttachment& a, const DeterministicJitter& m, float time, GeometryModifierStats& stats) {
    const double ticks = std::floor(static_cast<double>(time) * m.frequency_hz);
    double wrapped = std::isfinite(ticks) ? std::fmod(ticks, 4294967296.0) : 0;
    if (wrapped < 0) wrapped += 4294967296.0;
    const auto tick = static_cast<std::uint32_t>(wrapped);
    for (std::size_t i = 0; i < a.world_vertices_xy.size(); i += 2) {
        const auto vertex = static_cast<std::uint32_t>(i / 2);
        a.world_vertices_xy[i] = binary32(a.world_vertices_xy[i] + signed_hash(m.seed, a.draw_index, vertex, tick, 0x68bc21ebU) * m.amplitude_x);
        a.world_vertices_xy[i + 1] = binary32(a.world_vertices_xy[i + 1] + signed_hash(m.seed, a.draw_index, vertex, tick, 0x02e5be93U) * m.amplitude_y);
        ++stats.vertex_writes;
    }
}
void radial(RenderAttachment& a, const RadialWave& m, float time, GeometryModifierStats& stats) {
    constexpr double geometry_pi = 3.141592653589793238462643383279502884, tau = geometry_pi * 2, radians = geometry_pi / 180;
    const double phase = m.phase_degrees * radians + static_cast<double>(time) * m.speed_hz * tau;
    for (std::size_t i = 0; i < a.world_vertices_xy.size(); i += 2) {
        const double x = a.world_vertices_xy[i] - m.center_x, y = a.world_vertices_xy[i + 1] - m.center_y;
        const double distance = std::hypot(x, y), falloff = m.radius == 0 ? 1 : std::max(0.0, 1 - distance / m.radius);
        if (falloff <= 0) continue;
        const double wave = std::sin(phase + distance / m.wavelength * tau);
        const double next_distance = distance + m.radial_amplitude * wave * falloff;
        const double angle = std::atan2(y, x) + m.angular_amplitude_degrees * radians * wave * falloff;
        a.world_vertices_xy[i] = binary32(m.center_x + std::cos(angle) * next_distance);
        a.world_vertices_xy[i + 1] = binary32(m.center_y + std::sin(angle) * next_distance);
        ++stats.vertex_writes;
    }
}
struct CallbackScope {
    bool& callback_active;
    std::shared_ptr<GeometryEditorState> editor;
    CallbackScope(bool& active, RenderAttachment& a, GeometryModifierStats& stats)
        : callback_active(active), editor(std::make_shared<GeometryEditorState>(GeometryEditorState{&a, &stats})) {
        if (active) throw Error(ErrorCode::invalid_state, "geometryModifier", "A modifier callback cannot reenter its player.");
        callback_active = true;
    }
    ~CallbackScope() { editor->attachment = nullptr; editor->stats = nullptr; callback_active = false; }
};
void run(std::vector<RenderAttachment>& attachments, const GeometryModifiers& list, GeometryModifierContext context,
         bool& callback_active, GeometryModifierStats& stats) {
    for (std::size_t i = 0; i < list.operations.size(); ++i) {
        const auto& m = list.operations[i]; context.operation_index = static_cast<std::uint32_t>(i);
        for (auto& a : attachments) if (matches(m.filter, a)) {
            ++stats.attachment_visits;
            if (const auto* j = std::get_if<DeterministicJitter>(&m.effect)) jitter(a, *j, context.time_seconds, stats);
            else if (const auto* r = std::get_if<RadialWave>(&m.effect)) radial(a, *r, context.time_seconds, stats);
            else {
                CallbackScope scope(callback_active, a, stats);
                try { std::get<CustomGeometryModifier>(m.effect).apply(GeometryEditorAccess::create(scope.editor), context); }
                catch (const Error&) { throw; }
                catch (const std::bad_alloc&) { throw; }
                catch (const std::exception& error) { throw Error(ErrorCode::internal, "geometryModifier", "Geometry callback failed: " + std::string(error.what()), {}, a.attachment_id); }
                catch (...) { throw Error(ErrorCode::internal, "geometryModifier", "Geometry callback failed.", {}, a.attachment_id); }
            }
        }
    }
}
}
void validate_modifiers(const RuntimeData& data, const GeometryModifiers& list, const char* op) {
    if (list.operations.size() > 1000000) throw Error(ErrorCode::resource_limit, op, "Too many geometry modifier operations.", "geometryModifiers.operations");
    for (std::size_t i = 0; i < list.operations.size(); ++i) {
        const auto& m = list.operations[i]; const auto path = "geometryModifiers.operations[" + std::to_string(i) + "]";
        targets(data, m.filter.attachment_ids, RuntimeCatalogKind::attachment, op, path + ".attachmentIds");
        targets(data, m.filter.slot_ids, RuntimeCatalogKind::slot, op, path + ".slotIds");
        const auto f = [&](double value, const char* field) { finite(value, op, path + "." + field); };
        if (const auto* j = std::get_if<DeterministicJitter>(&m.effect)) {
            f(j->amplitude_x, "amplitudeX"); f(j->amplitude_y, "amplitudeY"); f(j->frequency_hz, "frequencyHz");
            if (j->frequency_hz < 0) throw Error(ErrorCode::invalid_argument, op, "Jitter frequency must be non-negative.", path + ".frequencyHz");
        } else if (const auto* r = std::get_if<RadialWave>(&m.effect)) {
            f(r->center_x, "centerX"); f(r->center_y, "centerY"); f(r->radial_amplitude, "radialAmplitude"); f(r->angular_amplitude_degrees, "angularAmplitudeDegrees");
            f(r->wavelength, "wavelength"); f(r->phase_degrees, "phaseDegrees"); f(r->speed_hz, "speedHz"); f(r->radius, "radius");
            if (r->wavelength <= 0) throw Error(ErrorCode::invalid_argument, op, "Radial wavelength must be positive.", path + ".wavelength");
            if (r->radius < 0) throw Error(ErrorCode::invalid_argument, op, "Radial radius must be non-negative.", path + ".radius");
        } else if (const auto* c = std::get_if<CustomGeometryModifier>(&m.effect)) {
            if (!c->apply) throw Error(ErrorCode::invalid_argument, op, "A custom geometry callback is required.", path + ".apply");
        } else throw Error(ErrorCode::invalid_argument, op, "Geometry operation has no active effect.", path + ".type");
    }
}
void ModifierStage::modify(std::vector<RenderAttachment>& attachments, const GeometryModifiers& persistent,
    const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats) {
    stats = {static_cast<std::uint32_t>(persistent.operations.size()), transient ? static_cast<std::uint32_t>(transient->operations.size()) : 0};
    if (stats.persistent_operations == 0 && stats.transient_operations == 0) return;
    // Keep only source triangle areas. Candidate vertices/UVs stay in their original owned
    // packet-builder buffers; there is no second full geometry copy for an effect pass.
    std::vector<std::size_t> offsets; offsets.reserve(attachments.size() + 1);
    std::vector<double> baseline;
    for (const auto& a : attachments) {
        offsets.push_back(baseline.size());
        if (matches(&persistent, a) || matches(transient, a))
            for (std::size_t i = 0; i < a.indices.size(); i += 3) baseline.push_back(area(a, i));
    }
    offsets.push_back(baseline.size());
    run(attachments, persistent, {sequence, time, true, 0}, callback_active, stats);
    if (transient) run(attachments, *transient, {sequence, time, false, 0}, callback_active, stats);
    for (std::size_t i = 0; i < attachments.size(); ++i) if (offsets[i] != offsets[i + 1]) {
        const auto& a = attachments[i];
        const auto all_finite = [](const auto& v) { return std::all_of(v.begin(), v.end(), [](float n) { return std::isfinite(n); }); };
        if (!all_finite(a.world_vertices_xy) || !all_finite(a.uvs))
            throw Error(ErrorCode::validation_failed, "geometryModifier", "Modifier produced non-finite geometry.", {}, a.attachment_id);
        for (std::size_t j = 0; j < a.indices.size(); j += 3) {
            const double before = baseline[offsets[i] + j / 3], after = area(a, j);
            if (!std::isfinite(after) || (before > 0 && after <= 0) || (before < 0 && after >= 0))
                throw Error(ErrorCode::validation_failed, "geometryModifier", "Modifier inverted or collapsed a non-degenerate triangle.", {}, a.attachment_id);
        }
    }
}
RenderPacket ModifierStage::apply(std::vector<RenderAttachment> attachments, const GeometryModifiers& persistent,
    const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats) {
    modify(attachments, persistent, transient, sequence, time, callback_active, stats);
    return RenderPacket(std::move(attachments));
}
RenderPacket ModifierStage::apply(std::shared_ptr<std::vector<RenderAttachment>> attachments, const GeometryModifiers& persistent,
    const GeometryModifiers* transient, std::uint64_t sequence, float time, bool& callback_active, GeometryModifierStats& stats) {
    modify(*attachments, persistent, transient, sequence, time, callback_active, stats);
    return RenderPacket(std::move(attachments));
}
}
