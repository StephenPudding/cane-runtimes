import {
  Color,
  type EffectAsset,
  Material,
  UIRenderer,
  builtinResMgr,
  gfx,
  renderer,
} from "cc";
import type { RuntimeBlendModeV1 } from "@cane-runtime/core";
import { createCaneCocosMaterialTemplateV1 } from "./color-effect.js";
import { CaneCocosErrorV1 } from "./errors.js";

export interface CaneCocosMaterialOptionsV1 {
  readonly owner: UIRenderer;
  readonly template?: Material;
  readonly effectAsset?: EffectAsset;
  readonly enableBatch?: boolean;
}

/**
 * Exact Cocos 3.8.8 material variants for Cane's final blend state.
 * The Cane effect normalizes texture alpha/color space and always emits PMA.
 */
export class CaneCocosMaterialSetV1 {
  readonly #owner: UIRenderer;
  readonly #instances = new Map<string, renderer.MaterialInstance>();
  #template: Material;
  #ownsTemplate: boolean;
  #enableBatch: boolean;
  #destroyed = false;

  constructor(options: CaneCocosMaterialOptionsV1) {
    this.#owner = options.owner;
    const sourceTemplate = options.template ?? builtinResMgr.get<Material>("default-spine-material");
    if (sourceTemplate === null || sourceTemplate === undefined || !sourceTemplate.isValid) {
      throw new CaneCocosErrorV1(
        "missingResource",
        "Cocos built-in material 'default-spine-material' is unavailable.",
        { operation: "cocosCreateMaterialSet", field: "material" },
      );
    }
    this.#template = options.template === undefined
      ? createCaneCocosMaterialTemplateV1(sourceTemplate, options.effectAsset)
      : sourceTemplate;
    this.#ownsTemplate = options.template === undefined;
    this.#enableBatch = options.enableBatch ?? false;
  }

  get enableBatch(): boolean { return this.#enableBatch; }

  setEnableBatch(value: boolean): void {
    this.#assertLive();
    const normalized = Boolean(value);
    if (normalized === this.#enableBatch) return;
    this.#enableBatch = normalized;
    this.clear();
  }

  setTemplate(template: Material): void {
    this.#assertLive();
    if (!template.isValid) {
      throw new CaneCocosErrorV1("invalidArgument", "The Cocos material template is destroyed.", {
        operation: "cocosSetMaterialTemplate",
        field: "material",
      });
    }
    if (template === this.#template) return;
    this.clear();
    if (this.#ownsTemplate && this.#template.isValid) this.#template.destroy();
    this.#template = template;
    this.#ownsTemplate = false;
  }

  get(blendMode: RuntimeBlendModeV1): renderer.MaterialInstance {
    this.#assertLive();
    const key = `${blendMode}|${this.#enableBatch ? 1 : 0}`;
    const existing = this.#instances.get(key);
    if (existing !== undefined && existing.isValid) return existing;
    // The Cane shader always emits premultiplied output, independently of the
    // source texture's alpha mode.
    const [src, dst] = blendFactorsV1(blendMode, true);
    const [srcAlpha, dstAlpha] = blendAlphaFactorsV1(blendMode);
    const instance = new renderer.MaterialInstance({
      parent: this.#template,
      owner: this.#owner,
      subModelIdx: 0,
    });
    instance.overridePipelineStates({
      blendState: {
        blendColor: Color.WHITE,
        targets: [{
          blend: true,
          blendEq: gfx.BlendOp.ADD,
          blendAlphaEq: gfx.BlendOp.ADD,
          blendSrc: src,
          blendDst: dst,
          blendSrcAlpha: srcAlpha,
          blendDstAlpha: dstAlpha,
        }],
      },
    });
    instance.recompileShaders({
      TWO_COLORED: true,
      USE_LOCAL: !this.#enableBatch,
    });
    this.#instances.set(key, instance);
    return instance;
  }

  clear(): void {
    for (const instance of this.#instances.values()) {
      if (instance.isValid) instance.destroy();
    }
    this.#instances.clear();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.clear();
    if (this.#ownsTemplate && this.#template.isValid) this.#template.destroy();
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new CaneCocosErrorV1("invalidState", "The Cocos material set is destroyed.", {
        operation: "cocosMaterial",
      });
    }
  }
}

export function blendAlphaFactorsV1(
  blendMode: RuntimeBlendModeV1,
): readonly [gfx.BlendFactor, gfx.BlendFactor] {
  return blendMode === "add"
    ? [gfx.BlendFactor.ONE, gfx.BlendFactor.ONE]
    : [gfx.BlendFactor.ONE, gfx.BlendFactor.ONE_MINUS_SRC_ALPHA];
}

export function blendFactorsV1(
  blendMode: RuntimeBlendModeV1,
  premultipliedAlpha: boolean,
): readonly [gfx.BlendFactor, gfx.BlendFactor] {
  switch (blendMode) {
    case "add":
      return [premultipliedAlpha ? gfx.BlendFactor.ONE : gfx.BlendFactor.SRC_ALPHA, gfx.BlendFactor.ONE];
    case "multiply":
      return [gfx.BlendFactor.DST_COLOR, gfx.BlendFactor.ONE_MINUS_SRC_ALPHA];
    case "screen":
      return [
        premultipliedAlpha ? gfx.BlendFactor.ONE : gfx.BlendFactor.SRC_ALPHA,
        gfx.BlendFactor.ONE_MINUS_SRC_COLOR,
      ];
    case "normal":
      return [
        premultipliedAlpha ? gfx.BlendFactor.ONE : gfx.BlendFactor.SRC_ALPHA,
        gfx.BlendFactor.ONE_MINUS_SRC_ALPHA,
      ];
  }
  const exhaustive: never = blendMode;
  throw new CaneCocosErrorV1("renderContractViolation", "Unknown Core blend mode.", {
    operation: "cocosSelectBlendState",
    field: "blendMode",
    actual: exhaustive,
  });
}
