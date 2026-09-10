import {
  Node,
  RenderData,
  UIRenderer,
  sys,
  type Material,
  type Texture2D,
  type UI,
  type Asset,
} from "cc";
import { CaneCocosErrorV1 } from "./errors.js";
import { assertCaneCocosVersionV1 } from "./engine.js";

/**
 * Cocos 3.8.8's public `cc` surface exposes RenderData and UIRenderer, while
 * RenderEntity/RenderDrawInfo are declaration-private. All access to those
 * exact-version objects is intentionally isolated in this file.
 */

type CaneRenderEntityV1 = UIRenderer["renderEntity"];
type CaneRenderDrawInfoV1 = NonNullable<RenderData["renderDrawInfo"]>;
type CaneDrawInfoTypeV1 = NonNullable<Parameters<RenderData["initRenderDrawInfo"]>[1]>;
type CaneRenderEntityConstructorV1 = new (entityType: number) => CaneRenderEntityV1;
type CaneRenderDrawInfoConstructorV1 = new () => CaneRenderDrawInfoV1;

const RENDER_ENTITY_CROSSED_V1 = 2;
const DRAW_INFO_MIDDLEWARE_V1 = 2 as CaneDrawInfoTypeV1;
const DRAW_INFO_SUB_NODE_V1 = 3 as CaneDrawInfoTypeV1;

let renderEntityConstructorV1: CaneRenderEntityConstructorV1 | null = null;

/** JSB 3.8.8 omits the public nativeAsset alias present in the Web Asset. */
export function readCaneAssetNativeDataV1(asset: Asset): unknown {
  if (asset.nativeAsset !== undefined || !sys.isNative) return asset.nativeAsset;
  assertCaneCocosVersionV1("cocosReadNativeAsset");
  return (asset as unknown as { readonly _nativeAsset?: unknown })._nativeAsset;
}

export interface CaneCocosDrawSubmissionV1 {
  readonly kind: "draw";
  readonly texture: Texture2D;
  readonly material: Material;
  readonly indexOffset: number;
  readonly indexCount: number;
}

export interface CaneCocosNodeSubmissionV1 {
  readonly kind: "node";
  readonly node: Node;
}

export type CaneCocosSubmissionV1 = CaneCocosDrawSubmissionV1 | CaneCocosNodeSubmissionV1;

/** Creates the same crossed render-entity category used by Creator's tiled renderer. */
export function createCaneCrossedRenderEntityV1(
  createSeed: () => CaneRenderEntityV1,
): CaneRenderEntityV1 {
  assertCaneCocosVersionV1("cocosCreateCrossedRenderEntity");
  // In 3.8.8 RenderEntity only stores the constructor's entity type in JSB.
  // Web traversal is controlled separately by the node's `_static` flag, so
  // retaining Creator's public UIRenderer seed is the exact Web contract.
  if (!sys.isNative) {
    const seed = createSeed();
    if (typeof seed.setUseLocal !== "function") {
      throw unsupportedInternalV1("RenderEntity setUseLocal is unavailable.", "renderEntity.setUseLocal");
    }
    return seed;
  }
  if (renderEntityConstructorV1 === null) {
    const seed = createSeed();
    const constructor = seed.constructor as unknown as CaneRenderEntityConstructorV1;
    if (typeof constructor !== "function") {
      throw unsupportedInternalV1("RenderEntity constructor is unavailable.", "renderEntity.constructor");
    }
    renderEntityConstructorV1 = constructor;
  }
  const entity = new renderEntityConstructorV1(RENDER_ENTITY_CROSSED_V1);
  if (entity.renderEntityType !== RENDER_ENTITY_CROSSED_V1
    || typeof entity.setUseLocal !== "function"
    || typeof entity.clearDynamicRenderDrawInfos !== "function"
    || typeof entity.setDynamicRenderDrawInfo !== "function") {
    throw unsupportedInternalV1("Cocos crossed RenderEntity contract changed.", "renderEntity");
  }
  return entity;
}

export function configureCaneRenderEntityV1(component: UIRenderer, enableBatch: boolean): void {
  const entity = component.renderEntity;
  if (sys.isNative && entity.renderEntityType !== RENDER_ENTITY_CROSSED_V1) {
    throw unsupportedInternalV1("CaneSkeleton requires a crossed RenderEntity.", "renderEntity.renderEntityType");
  }
  entity.setUseLocal(!enableBatch);
}

/** Initializes the retained RenderData's native middleware descriptor. No-op on Web. */
export function initializeCaneNativeRenderDataV1(data: RenderData, component: UIRenderer): void {
  if (!sys.isNative) return;
  data.drawInfoType = DRAW_INFO_MIDDLEWARE_V1;
  data.initRenderDrawInfo(component, DRAW_INFO_MIDDLEWARE_V1);
  if (data.renderDrawInfo === null || data.renderDrawInfo === undefined) {
    throw unsupportedInternalV1("RenderData did not create a native RenderDrawInfo.", "renderData.renderDrawInfo");
  }
}

/**
 * Retained native submission list. Geometry is still the exact Core packet;
 * this bridge only points Cocos draw descriptors at the already packed range.
 */
export class CaneCocosNativeSubmissionBridgeV1 {
  readonly #drawInfos: CaneRenderDrawInfoV1[] = [];
  #drawInfoConstructor: CaneRenderDrawInfoConstructorV1 | null = null;

  prepare(
    component: UIRenderer,
    data: RenderData,
    submissions: readonly CaneCocosSubmissionV1[],
    count: number,
    indexOrigin = 0,
  ): void {
    if (!sys.isNative) return;
    assertCaneCocosVersionV1("cocosPrepareNativeDrawInfos");
    const seed = data.renderDrawInfo;
    if (seed === null || seed === undefined) {
      throw unsupportedInternalV1("Native RenderData is missing its seed DrawInfo.", "renderData.renderDrawInfo");
    }
    if (this.#drawInfoConstructor === null) {
      const constructor = seed.constructor as unknown as CaneRenderDrawInfoConstructorV1;
      if (typeof constructor !== "function") {
        throw unsupportedInternalV1("RenderDrawInfo constructor is unavailable.", "renderDrawInfo.constructor");
      }
      this.#drawInfoConstructor = constructor;
    }
    const entity = component.renderEntity;
    entity.clearDynamicRenderDrawInfos();
    for (let index = 0; index < count; index += 1) {
      const submission = submissions[index];
      if (submission === undefined) continue;
      let drawInfo = this.#drawInfos[index];
      if (drawInfo === undefined) {
        drawInfo = index === 0 ? seed : new this.#drawInfoConstructor();
        this.#drawInfos[index] = drawInfo;
      }
      if (submission.kind === "node") {
        drawInfo.setDrawInfoType(DRAW_INFO_SUB_NODE_V1);
        drawInfo.setSubNode(submission.node);
      } else {
        data.fillDrawInfoAttributes(drawInfo);
        drawInfo.setDrawInfoType(DRAW_INFO_MIDDLEWARE_V1);
        drawInfo.setTexture(submission.texture.getGFXTexture());
        drawInfo.setSampler(submission.texture.getGFXSampler());
        drawInfo.setMaterial(submission.material);
        drawInfo.setIndexOffset(indexOrigin + submission.indexOffset);
        drawInfo.setIBCount(submission.indexCount);
        drawInfo.setVertDirty(true);
      }
      entity.setDynamicRenderDrawInfo(drawInfo, index);
    }
    this.#drawInfos.length = count;
  }

  clear(component: UIRenderer): void {
    if (sys.isNative) component.renderEntity.clearDynamicRenderDrawInfos();
    this.#drawInfos.length = 0;
  }
}

/** Web counterpart of native SUB_NODE. */
export function submitCaneSubNodeV1(batcher: UI, node: Node): void {
  if (node.isValid && node.activeInHierarchy) batcher.walk(node);
}

/**
 * A crossed renderer owns child traversal. This mirrors Creator 3.8.8's
 * TiledLayer behavior and prevents manually interleaved children rendering twice.
 */
export function setCaneCrossedWebTraversalV1(node: Node, enabled: boolean): void {
  (node as unknown as { _static: boolean })._static = enabled;
}

function unsupportedInternalV1(message: string, field: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("unsupportedInternalApi", message, {
    operation: "cocosInternalBridge",
    field,
    expected: "Cocos Creator 3.8.8",
  });
}
