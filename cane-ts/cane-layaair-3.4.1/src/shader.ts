import type { RuntimeBlendModeV1 } from "@cane-runtime/core";
import { assertCaneLayaWebRendererV1 } from "./engine.js";

export const CANE_LAYA_SHADER_NAME_V1 = "CaneRuntime2D_v1";

const VERTEX_SHADER_V1 = /* glsl */ `
#define SHADER_NAME CaneRuntime2DVS
#define BASERENDER2D
#include "Sprite2DVertex.glsl";

varying vec2 v_caneUv;
varying vec4 v_caneLight;
varying vec4 v_caneDarkFlags;
varying vec4 v_caneNodeColor;

void main() {
    v_caneUv = a_uv;
    v_caneLight = a_color;
    v_caneDarkFlags = a_caneDarkFlags;

    // BaseRenderNode2D supplies the complete inherited Sprite color/alpha.
    vec4 nodeColor = linearToGamma(u_baseRenderColor);
    nodeColor.rgb *= nodeColor.a;
    v_caneNodeColor = nodeColor;
    gl_Position = getPosition(a_position.xy);
}
`;

const FRAGMENT_SHADER_V1 = /* glsl */ `
#define SHADER_NAME CaneRuntime2DFS
#define BASERENDER2D
#if defined(GL_FRAGMENT_PRECISION_HIGH)
precision highp float;
#else
precision mediump float;
#endif

#include "Sprite2DFrag.glsl";

varying vec2 v_caneUv;
varying vec4 v_caneLight;
varying vec4 v_caneDarkFlags;
varying vec4 v_caneNodeColor;

float caneSrgbToLinear(float channel) {
    if (channel <= 0.04045) return channel / 12.92;
    return pow((channel + 0.055) / 1.055, 2.4);
}

float caneLinearToSrgb(float channel) {
    if (channel <= 0.0031308) return channel * 12.92;
    return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
}

vec3 caneDecodeSrgb(vec3 value) {
    return vec3(
        caneSrgbToLinear(value.r),
        caneSrgbToLinear(value.g),
        caneSrgbToLinear(value.b)
    );
}

vec3 caneEncodeSrgb(vec3 value) {
    return vec3(
        caneLinearToSrgb(value.r),
        caneLinearToSrgb(value.g),
        caneLinearToSrgb(value.b)
    );
}

bool caneFlag(float flags, float bit) {
    return mod(floor(flags / bit), 2.0) >= 1.0;
}

void main() {
    clip();
    vec4 sampleColor = texture2D(u_baseRender2DTexture, v_caneUv);
    float flags = floor(v_caneDarkFlags.a + 0.5);
    bool twoColor = caneFlag(flags, 1.0);
    bool textureLinear = caneFlag(flags, 2.0);
    bool texturePremultiplied = caneFlag(flags, 4.0);

    float textureAlpha = sampleColor.a;
    vec3 textureRgb = sampleColor.rgb;
    if (!textureLinear) textureRgb = caneDecodeSrgb(textureRgb);
    if (texturePremultiplied) {
        textureRgb = textureAlpha > 0.000001
            ? textureRgb / textureAlpha
            : vec3(0.0);
    }

    vec3 light = caneDecodeSrgb(v_caneLight.rgb);
    vec3 dark = caneDecodeSrgb(v_caneDarkFlags.rgb);
    vec3 straightRgb = textureRgb * light;
    if (twoColor) straightRgb = dark + (light - dark) * textureRgb;
    straightRgb = clamp(straightRgb, vec3(0.0), vec3(1.0));
    float outputAlpha = clamp(textureAlpha * v_caneLight.a, 0.0, 1.0);

#ifdef GAMMASPACE
    vec3 outputRgb = caneEncodeSrgb(straightRgb);
#else
    vec3 outputRgb = straightRgb;
#endif

    // The custom blend states consume premultiplied output. Sprite hierarchy
    // color/alpha is also premultiplied, matching BaseRenderNode2D semantics.
    gl_FragColor = vec4(outputRgb * outputAlpha, outputAlpha) * v_caneNodeColor;
}
`;

let shaderInstalledV1 = false;

/** Registers the exact LayaAir 3.4.1 Mesh2D shader once per engine realm. */
export function installCaneLayaShaderV1(): void {
  assertCaneLayaWebRendererV1("layaInstallShader");
  // LayaAir 3.4.1 declares `find()` as non-null but returns `undefined` for an
  // unknown shader. Check truthiness instead of comparing only with `null`.
  const existing = Laya.Shader3D.find(CANE_LAYA_SHADER_NAME_V1);
  if (shaderInstalledV1 && existing != null) return;
  if (existing != null) {
    shaderInstalledV1 = true;
    return;
  }
  const attributes: { [name: string]: [number, Laya.ShaderDataType] } = {
    a_position: [Laya.VertexMesh.MESH_POSITION0, Laya.ShaderDataType.Vector4],
    a_color: [Laya.VertexMesh.MESH_COLOR0, Laya.ShaderDataType.Vector4],
    a_uv: [Laya.VertexMesh.MESH_TEXTURECOORDINATE0, Laya.ShaderDataType.Vector2],
    a_caneDarkFlags: [Laya.VertexMesh.MESH_CUSTOME0, Laya.ShaderDataType.Vector4],
  };
  const shader = Laya.Shader3D.add(CANE_LAYA_SHADER_NAME_V1, false, false);
  shader.shaderType = Laya.ShaderFeatureType.D2_BaseRenderNode2D;
  const subShader = new Laya.SubShader(attributes, {}, {});
  shader.addSubShader(subShader);
  subShader.addShaderPass(VERTEX_SHADER_V1, FRAGMENT_SHADER_V1);
  shaderInstalledV1 = true;
}

/** Four immutable material states; texture remains per Mesh2DRender node. */
export class CaneLayaMaterialSetV1 {
  readonly #materials = new Map<RuntimeBlendModeV1, Laya.Material>();
  #destroyed = false;

  constructor() {
    installCaneLayaShaderV1();
    this.#materials.set("normal", createMaterialV1("normal"));
    this.#materials.set("add", createMaterialV1("add"));
    this.#materials.set("multiply", createMaterialV1("multiply"));
    this.#materials.set("screen", createMaterialV1("screen"));
  }

  get(blendMode: RuntimeBlendModeV1): Laya.Material {
    if (this.#destroyed) throw new Error("CaneLayaMaterialSetV1 is destroyed.");
    const material = this.#materials.get(blendMode);
    if (material === undefined) throw new Error(`Unsupported Cane blend mode '${blendMode}'.`);
    return material;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const material of this.#materials.values()) {
      if (!material.destroyed) material.destroy();
    }
    this.#materials.clear();
  }
}

function createMaterialV1(blendMode: RuntimeBlendModeV1): Laya.Material {
  const state = Laya.RenderState;
  const material = new Laya.Material();
  material.name = `Cane:${blendMode}`;
  material.setShaderName(CANE_LAYA_SHADER_NAME_V1);
  material.renderQueue = Laya.Material.RENDERQUEUE_TRANSPARENT;
  material.depthWrite = false;
  material.depthTest = state.DEPTHTEST_OFF;
  material.cull = state.CULL_NONE;
  material.blend = state.BLEND_ENABLE_SEPERATE;
  material.blendEquationRGB = state.BLENDEQUATION_ADD;
  material.blendEquationAlpha = state.BLENDEQUATION_ADD;
  material.blendSrcAlpha = state.BLENDPARAM_ONE;
  material.blendDstAlpha = blendMode === "add"
    ? state.BLENDPARAM_ONE
    : state.BLENDPARAM_ONE_MINUS_SRC_ALPHA;

  if (blendMode === "normal" || blendMode === "add") {
    material.blendSrcRGB = state.BLENDPARAM_ONE;
    material.blendDstRGB = blendMode === "add"
      ? state.BLENDPARAM_ONE
      : state.BLENDPARAM_ONE_MINUS_SRC_ALPHA;
  } else if (blendMode === "multiply") {
    material.blendSrcRGB = state.BLENDPARAM_DST_COLOR;
    material.blendDstRGB = state.BLENDPARAM_ONE_MINUS_SRC_ALPHA;
  } else {
    material.blendSrcRGB = state.BLENDPARAM_ONE;
    material.blendDstRGB = state.BLENDPARAM_ONE_MINUS_SRC_COLOR;
  }
  return material;
}
