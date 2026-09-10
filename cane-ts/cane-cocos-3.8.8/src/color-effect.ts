import { EffectAsset, Material, sys } from "cc";
import { CaneCocosErrorV1 } from "./errors.js";

export const CANE_COCOS_COLOR_EFFECT_NAME_V1 = "cane-runtime/cocos-3.8.8-color-v1";
export const CANE_COCOS_COLOR_EFFECT_MARKER_V1 = "CANE_RUNTIME_COLOR_PIPELINE_V1";

let registeredEffectV1: EffectAsset | null = null;

/**
 * Builds the self-contained Cane material from Cocos' public EffectAsset data.
 * We retain the exact 3.8.8 vertex/descriptors contract but replace the Spine
 * fragment formula with Cane's renderer-neutral color contract.
 */
export function createCaneCocosMaterialTemplateV1(
  sourceTemplate: Material,
  compiledEffect?: EffectAsset,
): Material {
  const sourceEffect = sourceTemplate.effectAsset;
  if (sourceEffect === null) {
    throw new CaneCocosErrorV1("missingResource", "Cocos' built-in Spine EffectAsset is unavailable.", {
      operation: "cocosCreateColorEffect",
      field: "effectAsset",
    });
  }
  // The Native custom pipeline's layout graph is finalized by Creator's build
  // step. New program names registered only at runtime cannot be added to that
  // graph, so Native consumes the packaged, Creator-compiled EffectAsset.
  if (sys.isNative && compiledEffect === undefined) {
    throw new CaneCocosErrorV1(
      "missingResource",
      "Cocos Native requires the packaged 'cane-runtime-color.effect' asset; assign it before initializing CaneSkeleton.",
      {
        operation: "cocosCreateColorEffect",
        field: "colorEffectAsset",
        expected: "Creator-compiled Cane EffectAsset",
        backend: "native",
      },
    );
  }
  const effect = compiledEffect ?? ensureCaneCocosColorEffectV1(sourceEffect);
  requireCaneEffectMarkerV1(effect);
  const material = new Material("Cane:Cocos-3.8.8-color-v1");
  try {
    material.initialize({
      effectAsset: effect,
      defines: { TWO_COLORED: true, USE_LOCAL: true },
    });
  } catch (error) {
    if (material.isValid) material.destroy();
    throw new CaneCocosErrorV1("unsupportedBackend", "Cocos failed to initialize the Cane color material.", {
      operation: "cocosCreateColorEffect",
      cause: error,
    });
  }
  return material;
}

export function ensureCaneCocosColorEffectV1(sourceEffect: EffectAsset): EffectAsset {
  const registered = EffectAsset.get(CANE_COCOS_COLOR_EFFECT_NAME_V1);
  if (registered !== null) {
    requireCaneEffectMarkerV1(registered);
    registeredEffectV1 = registered;
    return registered;
  }
  if (registeredEffectV1 !== null && registeredEffectV1.isValid) {
    registeredEffectV1.onLoaded();
    return registeredEffectV1;
  }
  if (sourceEffect.shaders.length === 0 || sourceEffect.techniques.length === 0) {
    throw unsupportedEffectV1("Cocos' built-in Spine effect has no shader or technique.");
  }

  const effect = new EffectAsset(CANE_COCOS_COLOR_EFFECT_NAME_V1);
  const programNames = new Map<string, string>();
  effect.shaders = sourceEffect.shaders.map((sourceShader, index) => {
    const shader = cloneEffectValueV1(sourceShader);
    const name = `${CANE_COCOS_COLOR_EFFECT_NAME_V1}|program-${index}`;
    programNames.set(sourceShader.name, name);
    shader.name = name;
    shader.glsl1.frag = patchCaneCocosFragmentSourceV1(shader.glsl1.frag);
    shader.glsl3.frag = patchCaneCocosFragmentSourceV1(shader.glsl3.frag);
    shader.glsl4.frag = patchCaneCocosFragmentSourceV1(shader.glsl4.frag);
    shader.hash = hashShaderV1(`${name}\n${shader.glsl1.frag}\n${shader.glsl3.frag}\n${shader.glsl4.frag}`);
    return shader;
  });
  effect.techniques = cloneEffectValueV1(sourceEffect.techniques);
  for (const technique of effect.techniques) {
    for (const pass of technique.passes) {
      const program = programNames.get(pass.program);
      if (program === undefined) {
        throw unsupportedEffectV1(`Unknown Cocos Spine shader program '${pass.program}'.`);
      }
      pass.program = program;
      if (pass.shader !== undefined) {
        const shader = effect.shaders.find((candidate) => candidate.name === program);
        if (shader === undefined) throw unsupportedEffectV1(`Missing cloned shader program '${program}'.`);
        pass.shader = shader;
      }
    }
  }
  effect.combinations = cloneEffectValueV1(sourceEffect.combinations);
  effect.hideInEditor = true;
  try {
    effect.onLoaded();
  } catch (error) {
    if (effect.isValid) effect.destroy();
    throw new CaneCocosErrorV1("unsupportedBackend", "Cocos failed to register the Cane color effect.", {
      operation: "cocosCreateColorEffect",
      cause: error,
    });
  }
  requireCaneEffectMarkerV1(effect);
  registeredEffectV1 = effect;
  return effect;
}

export function patchCaneCocosFragmentSourceV1(source: string): string {
  // Cocos' JSB EffectAsset intentionally leaves the unused GLSL4 variant
  // empty. Preserve that sentinel; requiring a fragment entry point here
  // would reject the otherwise valid GLES2/GLES3 Native effect.
  if (source.trim().length === 0) return source;
  if (source.includes(CANE_COCOS_COLOR_EFFECT_MARKER_V1)) return source;
  const signature = "vec4 frag ()";
  const signatureIndex = source.indexOf(signature);
  if (signatureIndex < 0) throw unsupportedEffectV1("Cocos Spine fragment entry point changed.");
  const openingBrace = source.indexOf("{", signatureIndex + signature.length);
  if (openingBrace < 0) throw unsupportedEffectV1("Cocos Spine fragment entry point is malformed.");
  const closingBrace = matchingBraceV1(source, openingBrace);
  const sampler = source.includes("texture2D(cc_spriteTexture, uv0)")
    ? "texture2D(cc_spriteTexture, uv0)"
    : source.includes("texture(cc_spriteTexture, uv0)")
      ? "texture(cc_spriteTexture, uv0)"
      : null;
  if (sampler === null) throw unsupportedEffectV1("Cocos Spine texture sampling contract changed.");
  return `${source.slice(0, signatureIndex)}${CANE_COCOS_FRAGMENT_V1.replace("__CANE_SAMPLE__", sampler)}${source.slice(closingBrace + 1)}`;
}

const CANE_COCOS_FRAGMENT_V1 = `
// CANE_RUNTIME_COLOR_PIPELINE_V1
float caneSrgbToLinearV1(float value) {
  return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
}
float caneLinearToSrgbV1(float value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}
vec3 caneDecodeSrgbV1(vec3 value) {
  return vec3(caneSrgbToLinearV1(value.r), caneSrgbToLinearV1(value.g), caneSrgbToLinearV1(value.b));
}
vec3 caneEncodeSrgbV1(vec3 value) {
  return vec3(caneLinearToSrgbV1(value.r), caneLinearToSrgbV1(value.g), caneLinearToSrgbV1(value.b));
}
bool caneColorFlagV1(float flags, float bit) {
  return mod(floor(flags / bit), 2.0) >= 1.0;
}
vec4 frag () {
  vec4 texColor = __CANE_SAMPLE__;
  float textureAlpha = clamp(texColor.a, 0.0, 1.0);
  float flags = 0.0;
  vec3 dark = vec3(0.0);
  #if TWO_COLORED
    flags = floor(v_dark.a * 255.0 + 0.5);
    dark = caneDecodeSrgbV1(v_dark.rgb);
  #endif
  bool twoColor = caneColorFlagV1(flags, 1.0);
  bool textureLinear = caneColorFlagV1(flags, 2.0);
  bool texturePremultiplied = caneColorFlagV1(flags, 4.0);
  vec3 textureRgb = texColor.rgb;
  if (!textureLinear) textureRgb = caneDecodeSrgbV1(textureRgb);
  if (texturePremultiplied) {
    textureRgb = textureAlpha > 0.000001 ? textureRgb / textureAlpha : vec3(0.0);
  }
  textureRgb = clamp(textureRgb, vec3(0.0), vec3(1.0));
  vec3 light = caneDecodeSrgbV1(v_light.rgb);
  vec3 straightRgb = textureRgb * light;
  if (twoColor) straightRgb = dark + (light - dark) * textureRgb;
  straightRgb = clamp(straightRgb, vec3(0.0), vec3(1.0));
  float outputAlpha = clamp(textureAlpha * v_light.a, 0.0, 1.0);
  vec4 o = vec4(caneEncodeSrgbV1(straightRgb) * outputAlpha, outputAlpha);
  ALPHA_TEST(o);
  return o;
}
`;

function requireCaneEffectMarkerV1(effect: EffectAsset): void {
  if (!effect.shaders.some((shader) => (
    shader.glsl3.frag.includes(CANE_COCOS_COLOR_EFFECT_MARKER_V1)
    || shader.glsl3.frag.includes("caneSrgbToLinearV1")
  ))) {
    throw new CaneCocosErrorV1("engineVersionMismatch", "A conflicting Cane Cocos color effect is already registered.", {
      operation: "cocosCreateColorEffect",
      field: "EffectAsset.name",
      actual: effect.name,
    });
  }
}

function unsupportedEffectV1(message: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("engineVersionMismatch", message, {
    operation: "cocosCreateColorEffect",
    field: "builtin-spine.effect",
    expected: "Cocos Creator 3.8.8",
  });
}

function matchingBraceV1(source: string, openingBrace: number): number {
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw unsupportedEffectV1("Cocos Spine fragment braces are unbalanced.");
}

function hashShaderV1(source: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cloneEffectValueV1<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneEffectValueV1(item)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) output[key] = cloneEffectValueV1(entry);
      return output as T;
    }
  }
  return value;
}
