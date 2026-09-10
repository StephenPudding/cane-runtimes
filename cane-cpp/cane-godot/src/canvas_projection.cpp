#include "canvas_projection.hpp"
#include "bridge.hpp"
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/vector4.hpp>
#include <cmath>
#include <algorithm>
#include <limits>

namespace cane_godot {
namespace {
// Pixel algebra is the rendering contract, not another animation/tint evaluator.
// texelFetch makes per-axis wrap and different min/mag filters explicit. Fetch raw
// UNORM values and decode explicitly: Godot GLES3 does not apply source_color's
// texture() conversion to texelFetch. Keeping the sampler unhinted also avoids
// a second hardware decode in RenderingDevice backends.
constexpr const char* sampling_source = R"(
uniform vec4 cane_light = vec4(1.0);
uniform vec3 cane_dark = vec3(0.0);
uniform bool cane_two_color = false;
uniform bool cane_pma = false;
uniform int cane_min = 1;
uniform int cane_mag = 1;
uniform int cane_wrap_u = 0;
uniform int cane_wrap_v = 0;
varying vec4 host_modulate;
void vertex() { host_modulate = COLOR; }
float srgb_channel(float s) { return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4); }
int wrap_index(int i, int n, int mode) {
    if (mode == 0) { return clamp(i, 0, n - 1); }
    int period = mode == 2 ? n * 2 : n;
    int wrapped = ((i % period) + period) % period;
    return mode == 2 && wrapped >= n ? period - wrapped - 1 : wrapped;
}
vec4 fetch_pixel(ivec2 p, ivec2 size) {
    vec4 value = texelFetch(cane_texture, ivec2(wrap_index(p.x, size.x, cane_wrap_u), wrap_index(p.y, size.y, cane_wrap_v)), 0);
    if (cane_srgb) { value.rgb = vec3(srgb_channel(value.r), srgb_channel(value.g), srgb_channel(value.b)); }
    return value;
}
vec4 sample_pixel(vec2 uv) {
    ivec2 size = textureSize(cane_texture, 0);
    vec2 dimensions = vec2(size);
    float footprint = max(length(dFdx(uv) * dimensions), length(dFdy(uv) * dimensions));
    int filter_mode = footprint > 1.0 ? cane_min : cane_mag;
    if (filter_mode == 0) { return fetch_pixel(ivec2(floor(uv * dimensions)), size); }
    vec2 p = uv * dimensions - vec2(0.5);
    ivec2 base = ivec2(floor(p)); vec2 f = fract(p);
    return mix(mix(fetch_pixel(base, size), fetch_pixel(base + ivec2(1, 0), size), f.x),
        mix(fetch_pixel(base + ivec2(0, 1), size), fetch_pixel(base + ivec2(1, 1), size), f.x), f.y);
}
void fragment() {
    vec4 t = sample_pixel(UV);
    if (cane_pma) { t.rgb = t.a > 0.000001 ? t.rgb / t.a : vec3(0.0); }
    vec3 straight_rgb = cane_two_color ? cane_dark + (cane_light.rgb - cane_dark) * t.rgb : t.rgb * cane_light.rgb;
    float a = t.a * cane_light.a * host_modulate.a;
    vec3 c = straight_rgb * host_modulate.rgb * a;
)";
float linear(std::uint8_t channel) {
    const float s = channel / 255.0f; return s <= 0.04045f ? s / 12.92f : std::pow((s + 0.055f) / 1.055f, 2.4f);
}
godot::Vector3 rgb(const std::array<std::uint8_t, 3>& value) { return {linear(value[0]), linear(value[1]), linear(value[2])}; }
}
CanvasProjection::~CanvasProjection() { clear(); }
void CanvasProjection::clear() {
    auto* server = godot::RenderingServer::get_singleton();
    if (server) for (auto& draw : draws_) if (draw.item.is_valid()) server->free_rid(draw.item);
    if (server && root_.is_valid()) server->free_rid(root_);
    root_ = {};
    draws_.clear(); batches_.clear(); slot_breaks_.clear(); stats_ = {};
}
godot::Ref<godot::Shader> CanvasProjection::shader(cane::RenderBlendMode blend, cane::ColorSpace color_space) {
    const auto index = static_cast<std::size_t>(blend) * 2 + static_cast<std::size_t>(color_space);
    auto& result = shaders_[index]; if (result.is_valid()) return result;
    const bool normal = blend == cane::RenderBlendMode::normal;
    const bool add = blend == cane::RenderBlendMode::add;
    std::string code = "shader_type canvas_item;\nrender_mode unshaded, ";
    code += add ? "blend_add;\n" : "blend_premul_alpha;\n";
    code += "uniform sampler2D cane_texture;\n";
    code += color_space == cane::ColorSpace::srgb ? "const bool cane_srgb = true;\n" : "const bool cane_srgb = false;\n";
    if (!normal && !add) code += "uniform sampler2D destination : hint_screen_texture, repeat_disable, filter_nearest;\n";
    code += sampling_source;
    if (normal) code += "COLOR = vec4(c, a);\n}";
    else if (add) {
        // Godot Add uses SRC_ALPHA for both RGB and alpha. Encoding (Cs/sqrt(As),
        // sqrt(As)) yields exactly Cs+Cd and As+Ad, including self-overlap, without
        // any destination copy. The packet's own tint/alpha are never modified.
        code += "float factor = sqrt(max(a, 0.0));\nCOLOR = vec4(factor > 0.0 ? c / factor : vec3(0.0), factor);\n}";
    }
    else {
        // RenderingDevice screen copies do not preserve destination alpha. Read
        // RGB only and let native premultiplied blending preserve the actual Ad.
        // RGB sources below plus Cd*(1-As) yield the required multiply/screen C.
        code += "vec3 d = textureLod(destination, SCREEN_UV, 0.0).rgb;\n";
        if (blend == cane::RenderBlendMode::multiply) code += "COLOR = vec4(c * d, a);\n}";
        else code += "COLOR = vec4(c + d * (vec3(a) - c), a);\n}";
    }
    result.instantiate(); result->set_code(text(code)); return result;
}
void CanvasProjection::commit(CanvasProjection& prepared) noexcept {
    const auto uploads = stats_.packet_uploads + prepared.stats_.packet_uploads;
    const auto layout_uploads = stats_.layout_uploads + prepared.stats_.layout_uploads;
    auto* server = godot::RenderingServer::get_singleton();
    if (root_.is_valid()) server->canvas_item_set_visible(root_, false);
    draws_.swap(prepared.draws_); shaders_.swap(prepared.shaders_); std::swap(root_, prepared.root_); std::swap(stats_, prepared.stats_);
    batches_.swap(prepared.batches_); slot_breaks_.swap(prepared.slot_breaks_);
    stats_.packet_uploads = uploads; stats_.layout_uploads = layout_uploads;
    if (root_.is_valid()) server->canvas_item_set_visible(root_, true);
}
void CanvasProjection::update_material(Draw& draw, const MaterialState& next, const godot::Ref<godot::Texture2D>& texture, ProjectionStats& stats) {
    const auto& before = draw.material_state;
    const bool reset = !before.initialized || before.blend != next.blend || before.color_space != next.color_space;
    if (reset) { draw.material->set_shader(shader(next.blend, next.color_space)); ++stats.material_shader_changes; }
    // A shader replacement may reset uniforms. Otherwise only changed final packet values
    // cross the engine boundary; resource validation and geometry upload still run normally.
    const auto parameter = [&](const char* name, const godot::Variant& value) {
        draw.material->set_shader_parameter(name, value); ++stats.material_parameter_writes;
    };
    if (reset || before.texture != next.texture) parameter("cane_texture", texture);
    if (reset || before.tint.light != next.tint.light || before.tint.alpha != next.tint.alpha) {
        const auto light = rgb(next.tint.light); parameter("cane_light", godot::Vector4(light.x, light.y, light.z, next.tint.alpha));
    }
    if (reset || before.tint.dark != next.tint.dark) parameter("cane_dark", next.tint.dark ? rgb(*next.tint.dark) : godot::Vector3());
    if (reset || before.tint.two_color() != next.tint.two_color()) parameter("cane_two_color", next.tint.two_color());
    if (reset || before.alpha_mode != next.alpha_mode) parameter("cane_pma", next.alpha_mode == cane::AlphaMode::premultiplied);
    if (reset || before.min_filter != next.min_filter) parameter("cane_min", static_cast<int>(next.min_filter));
    if (reset || before.mag_filter != next.mag_filter) parameter("cane_mag", static_cast<int>(next.mag_filter));
    if (reset || before.wrap_u != next.wrap_u) parameter("cane_wrap_u", static_cast<int>(next.wrap_u));
    if (reset || before.wrap_v != next.wrap_v) parameter("cane_wrap_v", static_cast<int>(next.wrap_v));
    draw.material_state = next; draw.material_state.initialized = true;
}
void CanvasProjection::arrange_slots(const std::vector<cane::SlotState>& slots, std::vector<SlotMount> mounts) {
    if (!root_.is_valid()) return;
    require(draws_.size() + mounts.size() <= static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max()), "Canvas draw order exceeds engine limits.", "draw_index");
    std::sort(mounts.begin(), mounts.end(), [](const SlotMount& a, const SlotMount& b) {
        if (a.slot_order != b.slot_order) return a.slot_order < b.slot_order;
        if (a.before != b.before) return a.before;
        return a.sibling_order < b.sibling_order;
    });
    // Build the complete order before changing RIDs. Never split special-blend triangles.
    std::vector<godot::RID> order; order.reserve(draws_.size() + mounts.size());
    std::size_t draw = 0, mount = 0;
    if (mounts.empty()) for (const auto& item : draws_) order.push_back(item.item);
    else for (const auto& slot : slots) {
        while (mount < mounts.size() && mounts[mount].slot_order == slot.draw_index && mounts[mount].before) order.push_back(mounts[mount++].anchor);
        while (draw < draws_.size() && draws_[draw].slot_id == slot.slot_id) order.push_back(draws_[draw++].item);
        while (mount < mounts.size() && mounts[mount].slot_order == slot.draw_index) order.push_back(mounts[mount++].anchor);
    }
    require(order.size() == draws_.size() + mounts.size(), "Packet and full Slot order disagree.", "slot_id");
    auto* server = godot::RenderingServer::get_singleton();
    for (const auto& item : mounts) server->canvas_item_set_parent(item.anchor, root_);
    for (std::size_t i = 0; i < order.size(); ++i) server->canvas_item_set_draw_index(order[i], static_cast<std::int32_t>(i));
}
}
