import {
  CaneRuntimeControllerV1,
  RuntimeErrorV1,
  type RuntimeAfterConstraintsListenerV1,
  type RuntimeBeforeConstraintsListenerV1,
  type RuntimeBoneFrameV1,
  type RuntimeBoneLocalAdditiveV1,
  type RuntimeBoneLocalPatchV1,
  type RuntimeBoneLocalV1,
  type RuntimeBoundsOptionsV1,
  type RuntimeClippingGeometryV1,
  type RuntimeConstraintOverrideV1,
  type RuntimeCustomGeometryModifierV1,
  type RuntimeDeterministicJitterModifierV1,
  type RuntimeEventListenerV1,
  type RuntimeFrameV1,
  type RuntimeGeometryModifiersV1,
  type RuntimeImageV1,
  type RuntimeLifecycleEventKindV1,
  type RuntimeOverlayAtlasV1,
  type RuntimePhysicsEnvironmentV1,
  type RuntimePhysicsHostMotionModeV1,
  type RuntimePlayerV1,
  type RuntimeRadialWaveModifierV1,
  type RuntimeResourceChangesV1,
  type RuntimeResourceSnapshotV1,
  type RuntimeResourceTransactionV1,
  type RuntimeRootTransformOptionsV1,
  type RuntimeSamplingV1,
  type RuntimeSeekV1,
  type RuntimeSkinBuilderOptionsV1,
  type RuntimeSkinBuilderV1,
  type RuntimeSkinV1,
  type RuntimeStepV1,
  type RuntimeAttachmentV1,
  type RootTransformV1,
} from "@cane-runtime/core";
import { Container, Graphics, Matrix, Point, Ticker, type PointData } from "pixi.js";
import type {
  CanePixiBatchApplyStatsV1,
  CanePixiBatchViewOptionsV1,
  MutableCanePixiBatchApplyStatsV1,
} from "./batch-view.js";
import { CanePixiBatchView } from "./batch-view.js";
import { CanePixiBoundsProviderV1 } from "./bounds.js";
import {
  writeCaneAffineToPixiMatrixV1,
  writeCanePointToPixiV1,
  writeInverseTransformCanePointV1,
  writePixiPointToCaneV1,
  writeTransformCanePointV1,
} from "./coordinates.js";

const AUTHORED_SAMPLING: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });
const ZERO_POINT = Object.freeze({ x: 0, y: 0 });

export interface CanePixiRuntimeOptionsV1 extends CanePixiBatchViewOptionsV1 {
  readonly player: RuntimePlayerV1;
  /** Reuse an existing controller when game code already owns one. */
  readonly controller?: CaneRuntimeControllerV1;
  /** Defaults to `Ticker.shared`, matching the common Pixi runtime lifecycle. */
  readonly ticker?: Ticker;
  /** Defaults to true. Set false when the host owns its simulation clock. */
  readonly autoUpdate?: boolean;
  readonly sampling?: RuntimeSamplingV1;
  /** Default options for the retained, lazy Core Bounds facade. */
  readonly bounds?: RuntimeBoundsOptionsV1;
  /** Record Core and projection wall time with `performance.now()`. Defaults to false. */
  readonly measureCpuTime?: boolean;
}

export type CanePixiSlotPlacementV1 = "before" | "after";

export type CanePixiSlotClippingV1 = "inherit" | "none";

export interface CanePixiSlotObjectOptionsV1 {
  /** Defaults to `after`, matching Spine slot-container conventions. */
  readonly placement?: CanePixiSlotPlacementV1;
  /** Hide the object while the Slot has no selected attachment. Defaults to true. */
  readonly followAttachmentVisibility?: boolean;
  /** Restrict visibility to one or more Slot-local Attachment IDs or names. */
  readonly visibleWhenAttachment?: string | readonly string[];
  /** Apply sampled Slot alpha to the object mount and hide at zero. Defaults to true. */
  readonly inheritSlotAlpha?: boolean;
  /** Inherit the active Cane Clipping attachment, or deliberately opt out. */
  readonly clipping?: CanePixiSlotClippingV1;
}

export interface CanePixiSlotObjectStateV1 {
  readonly slotId: string;
  readonly placement: CanePixiSlotPlacementV1;
  readonly attachmentId: string | null;
  readonly active: boolean;
  readonly slotAlpha: number;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly clippingAttachmentId: string | null;
}

export interface CanePixiRuntimeStatsV1 extends CanePixiBatchApplyStatsV1 {
  readonly coreCpuMilliseconds: number | null;
  readonly projectionCpuMilliseconds: number | null;
  readonly caneBatchSegments: number;
  /** Extra Cane batch boundaries introduced by interleaved Slot objects. */
  readonly slotObjectBatchSplits: number;
  readonly slotObjects: number;
  readonly activeSlotObjects: number;
  readonly maskedSlotObjects: number;
  readonly activeClippingMasks: number;
  readonly clippingMaskVertexWrites: number;
  /** Extra stencil/alpha mask applications required for foreign Slot objects. */
  readonly slotObjectMaskPasses: number;
  readonly boneObjects: number;
}

type MutableCanePixiRuntimeStatsV1 = {
  -readonly [Field in keyof CanePixiRuntimeStatsV1]: CanePixiRuntimeStatsV1[Field]
};

interface BoneMountV1 {
  readonly boneId: string;
  readonly mount: Container;
  readonly matrix: Matrix;
  readonly objects: Set<Container>;
}

interface BoneObjectRecordV1 {
  readonly object: Container;
  readonly bone: BoneMountV1;
}

interface SlotObjectRecordV1 {
  readonly object: Container;
  readonly slotId: string;
  readonly boneId: string;
  readonly placement: CanePixiSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CanePixiSlotClippingV1;
  readonly mount: Container;
  readonly matrix: Matrix;
  attachmentId: string | null;
  slotAlpha: number;
  active: boolean;
  clip: ClippingMaskRecordV1 | null;
  appliedClip: ClippingMaskRecordV1 | null;
  appliedInverse: boolean;
}

interface ClippingMaskRecordV1 {
  readonly attachmentId: string;
  readonly graphics: Graphics;
  readonly pixiPolygonPool: number[][];
  endSlotId: string | null;
  inverse: boolean;
  vertexCount: number;
  slotObjectUses: number;
  lastUsedSequence: number;
}

/**
 * Composite PixiJS v8 character node.
 *
 * Core remains the sole animation/constraint/geometry authority. This class
 * only projects final RenderPacket ranges, converts coordinates once, and
 * positions foreign display objects from final Bone affine matrices.
 */
export class CanePixiRuntime extends Container {
  readonly player: RuntimePlayerV1;
  readonly controller: CaneRuntimeControllerV1;
  readonly bounds: CanePixiBoundsProviderV1;

  readonly #sampling: RuntimeSamplingV1;
  readonly #viewOptions: CanePixiBatchViewOptionsV1;
  readonly #segments: CanePixiBatchView[] = [];
  readonly #boneOverlay = new Container({ label: "CaneBoneObjects" });
  readonly #maskOverlay = new Container({ label: "CaneClippingMasks" });
  readonly #boneMounts = new Map<string, BoneMountV1>();
  readonly #boneMountList: BoneMountV1[] = [];
  readonly #boneObjects = new Map<Container, BoneObjectRecordV1>();
  readonly #slotObjects = new Map<Container, SlotObjectRecordV1>();
  readonly #slotObjectList: SlotObjectRecordV1[] = [];
  readonly #slotBeforeById = new Map<string, SlotObjectRecordV1[]>();
  readonly #slotAfterById = new Map<string, SlotObjectRecordV1[]>();
  readonly #clippingMasks = new Map<string, ClippingMaskRecordV1>();
  readonly #clippingMaskList: ClippingMaskRecordV1[] = [];
  readonly #boneFrameById = new Map<string, RuntimeBoneFrameV1>();
  readonly #drawOrderSlotIds: string[] = [];
  readonly #attachmentIndexBySlotId = new Map<string, number>();
  readonly #slotAttachmentById = new Map<string, string | null>();
  readonly #slotAlphaById = new Map<string, number>();
  readonly #clippingAttachmentIds = new Set<string>();
  readonly #beforeClipBySlotId = new Map<string, ClippingMaskRecordV1 | null>();
  readonly #afterClipBySlotId = new Map<string, ClippingMaskRecordV1 | null>();
  readonly #slotBoneById = new Map<string, string>();
  readonly #canePointScratch = { x: 0, y: 0 };
  readonly #pixiPointScratch = new Point();
  readonly #stats: MutableCanePixiRuntimeStatsV1 = emptyRuntimeStatsV1();
  readonly #segmentStatsScratch: MutableCanePixiBatchApplyStatsV1 = emptyBatchStatsV1();
  readonly #ownedUnsubscribers = new Set<() => void>();
  readonly #measureCpuTime: boolean;
  #catalogIdentity: object | null = null;
  #ticker: Ticker;
  #autoUpdate = false;
  #activeSegmentCount = 0;
  #applySequence = 0;
  #destroying = false;
  readonly #tick = (ticker: Ticker): void => {
    this.update(ticker.deltaMS / 1000);
  };

  constructor(options: CanePixiRuntimeOptionsV1) {
    super({ label: "CanePixiRuntime" });
    if (options.controller !== undefined && options.controller.player !== options.player) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiCreateRuntime",
        "controller and player must refer to the same RuntimePlayerV1.",
        { field: "controller" },
      );
    }
    this.player = options.player;
    this.controller = options.controller ?? new CaneRuntimeControllerV1(options.player);
    this.bounds = new CanePixiBoundsProviderV1(this, options.bounds);
    this.#measureCpuTime = options.measureCpuTime ?? false;
    this.#sampling = options.sampling ?? AUTHORED_SAMPLING;
    this.#viewOptions = {
      textures: options.textures,
      ...(options.validationMode === undefined ? {} : { validationMode: options.validationMode }),
      ...(options.inactiveCacheFrames === undefined ? {} : { inactiveCacheFrames: options.inactiveCacheFrames }),
      ...(options.colorBatching === undefined ? {} : { colorBatching: options.colorBatching }),
    };
    this.#ticker = options.ticker ?? Ticker.shared;
    this.eventMode = "passive";
    this.#boneOverlay.eventMode = "passive";
    this.#maskOverlay.eventMode = "none";
    this.#projectFrame(this.player.currentFrame);
    this.autoUpdate = options.autoUpdate ?? true;
  }

  get autoUpdate(): boolean {
    return this.#autoUpdate;
  }

  set autoUpdate(value: boolean) {
    if (this.#autoUpdate === value) return;
    this.#autoUpdate = value;
    if (value) this.#ticker.add(this.#tick);
    else this.#ticker.remove(this.#tick);
  }

  get ticker(): Ticker {
    return this.#ticker;
  }

  set ticker(value: Ticker) {
    if (this.#ticker === value) return;
    const reconnect = this.#autoUpdate;
    if (reconnect) this.#ticker.remove(this.#tick);
    this.#ticker = value;
    if (reconnect) this.#ticker.add(this.#tick);
  }

  /** Cold-path aggregate across all contiguous Cane batch segments. */
  get lastApplyStats(): CanePixiRuntimeStatsV1 {
    return { ...this.#stats };
  }

  /** Advances Core exactly once and projects its final frame. */
  update(deltaSeconds: number): RuntimeFrameV1 {
    const started = this.#measureCpuTime ? performance.now() : 0;
    const frame = this.controller.advance(deltaSeconds, this.#sampling);
    const projected = this.#measureCpuTime ? performance.now() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      const finished = performance.now();
      this.#stats.coreCpuMilliseconds = projected - started;
      this.#stats.projectionCpuMilliseconds = finished - projected;
    }
    return frame;
  }

  /** Evaluates queued transient setters without advancing animation clocks. */
  applyPose(): RuntimeFrameV1 {
    const started = this.#measureCpuTime ? performance.now() : 0;
    const frame = this.controller.apply(this.#sampling);
    const projected = this.#measureCpuTime ? performance.now() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      const finished = performance.now();
      this.#stats.coreCpuMilliseconds = projected - started;
      this.#stats.projectionCpuMilliseconds = finished - projected;
    }
    return frame;
  }

  /** Reprojects an already-published Core frame without sampling or solving. */
  applyCurrentFrame(): RuntimeFrameV1 {
    const frame = this.player.currentFrame;
    const started = this.#measureCpuTime ? performance.now() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      this.#stats.coreCpuMilliseconds = 0;
      this.#stats.projectionCpuMilliseconds = performance.now() - started;
    }
    return frame;
  }

  findBone(idOrName: string) {
    return this.controller.findBone(idOrName);
  }

  queryBone(idOrName: string) {
    return this.controller.queryBone(idOrName);
  }

  setBonePosition(idOrName: string, x: number, y: number): this {
    this.controller.setBonePosition(idOrName, x, y);
    return this;
  }

  setBoneRotation(idOrName: string, rotationDegrees: number): this {
    this.controller.setBoneRotation(idOrName, rotationDegrees);
    return this;
  }

  patchBoneLocal(idOrName: string, patch: RuntimeBoneLocalPatchV1): this {
    this.controller.patchBoneLocal(idOrName, patch);
    return this;
  }

  addBoneLocal(idOrName: string, delta: RuntimeBoneLocalAdditiveV1): this {
    this.controller.addBoneLocal(idOrName, delta);
    return this;
  }

  setBoneLocalPersistent(idOrName: string, local: RuntimeBoneLocalV1): RuntimeFrameV1 {
    const frame = this.controller.setBoneLocalPersistent(idOrName, local);
    this.#projectFrame(frame);
    return frame;
  }

  setConstraintTarget(idOrName: string, x: number, y: number): this {
    this.controller.setConstraintTarget(idOrName, x, y);
    return this;
  }

  setConstraintMix(idOrName: string, mix: number): this {
    this.controller.setConstraintMix(idOrName, mix);
    return this;
  }

  setConstraintPersistent(idOrName: string, parameters: RuntimeConstraintOverrideV1): RuntimeFrameV1 {
    const frame = this.controller.setConstraintPersistent(idOrName, parameters);
    this.#projectFrame(frame);
    return frame;
  }

  setAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    mixSeconds?: number | null,
  ): RuntimeFrameV1 {
    const frame = this.controller.setAnimation(trackIndex, animationIdOrName, looping, mixSeconds);
    this.#projectFrame(frame);
    return frame;
  }

  addAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    delaySeconds = 0,
  ): RuntimeFrameV1 {
    const frame = this.controller.addAnimation(trackIndex, animationIdOrName, looping, delaySeconds);
    this.#projectFrame(frame);
    return frame;
  }

  clearTrack(trackIndex: number): RuntimeFrameV1 {
    const frame = this.controller.clearTrack(trackIndex);
    this.#projectFrame(frame);
    return frame;
  }

  setSkin(idOrName: string | null): RuntimeFrameV1 {
    const frame = this.controller.setSkin(idOrName);
    this.#projectFrame(frame);
    return frame;
  }

  setAttachment(slotIdOrName: string, attachmentIdOrName: string | null): RuntimeFrameV1 {
    const frame = this.controller.setAttachment(slotIdOrName, attachmentIdOrName);
    this.#projectFrame(frame);
    return frame;
  }

  /** Detached factory for every Core-supported Runtime Attachment shape. */
  get attachmentFactory() {
    return this.controller.attachments;
  }

  createRuntimeSkin(options: RuntimeSkinBuilderOptionsV1): RuntimeSkinBuilderV1 {
    return this.controller.createRuntimeSkin(options);
  }

  copyRuntimeSkin(
    idOrName: string,
    options: Partial<RuntimeSkinBuilderOptionsV1> & Pick<RuntimeSkinBuilderOptionsV1, "id">,
  ): RuntimeSkinBuilderV1 {
    return this.controller.copyRuntimeSkin(idOrName, options);
  }

  queryRuntimeResources(): RuntimeResourceSnapshotV1 {
    return this.controller.queryRuntimeResources();
  }

  applyRuntimeResources(
    changes: RuntimeResourceChangesV1 | RuntimeResourceTransactionV1,
  ): RuntimeFrameV1 {
    return this.#projectResult(this.controller.applyRuntimeResources(changes));
  }

  installRuntimeSkin(skin: RuntimeSkinV1 | RuntimeSkinBuilderV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.installRuntimeSkin(skin));
  }

  removeRuntimeSkin(skinId: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.removeRuntimeSkin(skinId));
  }

  installRuntimeAttachment(attachment: RuntimeAttachmentV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.installRuntimeAttachment(attachment));
  }

  removeRuntimeAttachment(attachmentId: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.removeRuntimeAttachment(attachmentId));
  }

  installRuntimeImage(image: RuntimeImageV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.installRuntimeImage(image));
  }

  removeRuntimeImage(imageId: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.removeRuntimeImage(imageId));
  }

  installRuntimeAtlas(atlas: RuntimeOverlayAtlasV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.installRuntimeAtlas(atlas));
  }

  removeRuntimeAtlas(atlasId: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.removeRuntimeAtlas(atlasId));
  }

  clearRuntimeResources(): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearRuntimeResources());
  }

  /** Queues one transient Core geometry effect for the next update/apply only. */
  jitterGeometry(modifier: RuntimeDeterministicJitterModifierV1): this {
    this.controller.jitterGeometry(modifier);
    return this;
  }

  /** Queues one transient Core radial wave for the next update/apply only. */
  radialWaveGeometry(modifier: RuntimeRadialWaveModifierV1): this {
    this.controller.radialWaveGeometry(modifier);
    return this;
  }

  /** Queues a non-serialized host callback inside Core's geometry stage. */
  modifyGeometry(modifier: RuntimeCustomGeometryModifierV1): this {
    this.controller.modifyGeometry(modifier);
    return this;
  }

  setPersistentGeometryModifiers(modifiers: RuntimeGeometryModifiersV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setPersistentGeometryModifiers(modifiers));
  }

  clearPersistentGeometryModifiers(): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearPersistentGeometryModifiers());
  }

  setRootTransform(root: RootTransformV1, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setRootTransform(root, options));
  }

  setRootPosition(x: number, y: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setRootPosition(x, y, options));
  }

  setRootRotation(rotationDegrees: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setRootRotation(rotationDegrees, options));
  }

  teleportRoot(
    root: RootTransformV1,
    physicsMode: Exclude<RuntimePhysicsHostMotionModeV1, "move"> = "teleport",
    constraintId?: string,
  ): RuntimeFrameV1 {
    return this.#projectResult(this.controller.teleportRoot(root, physicsMode, constraintId));
  }

  setPhysicsEnvironment(environment: RuntimePhysicsEnvironmentV1): RuntimeFrameV1 {
    return this.#projectResult(this.player.setPhysicsEnvironment(environment));
  }

  resetPhysics(): RuntimeFrameV1 {
    return this.#projectResult(this.player.resetPhysics());
  }

  resetPhysicsConstraint(constraintId: string): boolean {
    const cleared = this.player.resetPhysicsConstraint(constraintId);
    this.#projectFrame(this.player.currentFrame);
    return cleared;
  }

  seek(request: RuntimeSeekV1): RuntimeStepV1 {
    const result = this.player.seek(request);
    this.#projectFrame(this.player.currentFrame);
    return result;
  }

  beforeConstraints(listener: RuntimeBeforeConstraintsListenerV1): () => void {
    return this.#ownSubscription(this.controller.beforeConstraints(listener));
  }

  afterConstraints(listener: RuntimeAfterConstraintsListenerV1): () => void {
    return this.#ownSubscription(this.controller.afterConstraints(listener));
  }

  onEvent(listener: RuntimeEventListenerV1): () => void;
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(
    kind: Kind,
    listener: RuntimeEventListenerV1<Kind>,
  ): () => void;
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(
    kindOrListener: Kind | RuntimeEventListenerV1,
    listener?: RuntimeEventListenerV1<Kind>,
  ): () => void {
    const unsubscribe = typeof kindOrListener === "function"
      ? this.controller.onEvent(kindOrListener)
      : this.controller.onEvent(kindOrListener, listener as RuntimeEventListenerV1<Kind>);
    return this.#ownSubscription(unsubscribe);
  }

  /** Pixi-local Bone origin, relative to this runtime Container. */
  getBonePosition(idOrName: string, output: Point = new Point()): Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    output.x = matrix.tx;
    output.y = -matrix.ty;
    return output;
  }

  /** Cane Bone-local point to Pixi global coordinates. */
  boneToGlobal(idOrName: string, point: PointData = ZERO_POINT, output: Point = new Point()): Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    writeTransformCanePointV1(matrix, point, this.#canePointScratch);
    writeCanePointToPixiV1(this.#canePointScratch, this.#pixiPointScratch);
    return this.toGlobal(this.#pixiPointScratch, output);
  }

  /** Pixi global point to Cane Bone-local coordinates. */
  globalToBone(idOrName: string, point: PointData, output: Point = new Point()): Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    this.toLocal(point, undefined, this.#pixiPointScratch);
    writePixiPointToCaneV1(this.#pixiPointScratch, this.#canePointScratch);
    return writeInverseTransformCanePointV1(matrix, this.#canePointScratch, output);
  }

  addBoneObject(idOrName: string, object: Container): Container {
    this.#assertForeignObject(object, "addBoneObject");
    this.removeBoneObject(object);
    this.removeSlotObject(object);
    const boneId = this.controller.queryBone(idOrName).id;
    let bone = this.#boneMounts.get(boneId);
    if (bone === undefined) {
      const mount = new Container({ label: `CaneBone:${boneId}` });
      bone = { boneId, mount, matrix: new Matrix(), objects: new Set() };
      this.#boneMounts.set(boneId, bone);
      this.#boneMountList.push(bone);
      this.#boneOverlay.addChild(mount);
    }
    bone.mount.addChild(object);
    bone.objects.add(object);
    this.#boneObjects.set(object, { object, bone });
    this.#updateBoneMount(bone);
    this.#refreshObjectStats();
    return object;
  }

  removeBoneObject(object: Container): boolean {
    const record = this.#boneObjects.get(object);
    if (record === undefined) return false;
    this.#boneObjects.delete(object);
    record.bone.objects.delete(object);
    if (object.parent === record.bone.mount) record.bone.mount.removeChild(object);
    if (record.bone.objects.size === 0) {
      if (record.bone.mount.parent !== null) record.bone.mount.parent.removeChild(record.bone.mount);
      record.bone.mount.destroy({ children: false });
      this.#boneMounts.delete(record.bone.boneId);
      const mountIndex = this.#boneMountList.indexOf(record.bone);
      if (mountIndex >= 0) this.#boneMountList.splice(mountIndex, 1);
    }
    this.#refreshObjectStats();
    return true;
  }

  addSlotObject(
    slotIdOrName: string,
    object: Container,
    placementOrOptions: CanePixiSlotPlacementV1 | CanePixiSlotObjectOptionsV1 = "after",
  ): Container {
    this.#assertForeignObject(object, "addSlotObject");
    const options = normalizeSlotObjectOptionsV1(placementOrOptions);
    const placement = options.placement;
    if (placement !== "before" && placement !== "after") {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "addSlotObject",
        "placement must be 'before' or 'after'.",
        { field: "placement" },
      );
    }
    this.removeBoneObject(object);
    this.removeSlotObject(object);
    this.#ensureCatalog();
    const slotId = this.controller.querySlot(slotIdOrName).id;
    const boneId = this.#slotBoneById.get(slotId);
    if (boneId === undefined) {
      throw new RuntimeErrorV1("notFound", "addSlotObject", "Slot Bone is unavailable.", {
        entityId: slotId,
      });
    }
    const mount = new Container({ label: `CaneSlot:${slotId}:${placement}` });
    const record: SlotObjectRecordV1 = {
      object,
      slotId,
      boneId,
      placement,
      followAttachmentVisibility: options.followAttachmentVisibility,
      visibleWhenAttachmentIds: resolveVisibleAttachmentsV1(
        this.player,
        slotId,
        options.visibleWhenAttachment,
      ),
      inheritSlotAlpha: options.inheritSlotAlpha,
      clipping: options.clipping,
      mount,
      matrix: new Matrix(),
      attachmentId: null,
      slotAlpha: 1,
      active: false,
      clip: null,
      appliedClip: null,
      appliedInverse: false,
    };
    mount.addChild(object);
    this.#slotObjects.set(object, record);
    this.#slotObjectList.push(record);
    this.#slotList(slotId, placement, true).push(record);
    this.#projectFrame(this.player.currentFrame);
    return object;
  }

  /** First registered object for a Slot/placement, in insertion order. */
  getSlotObject(
    slotIdOrName: string,
    placement: CanePixiSlotPlacementV1 = "after",
    index = 0,
  ): Container | null {
    if (placement !== "before" && placement !== "after") {
      throw new RuntimeErrorV1("invalidArgument", "getSlotObject", "placement must be 'before' or 'after'.", {
        field: "placement",
      });
    }
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new RuntimeErrorV1("invalidArgument", "getSlotObject", "index must be a non-negative integer.", {
        field: "index",
      });
    }
    const slotId = this.controller.querySlot(slotIdOrName).id;
    return this.#slotList(slotId, placement, false)?.[index]?.object ?? null;
  }

  /** Returns an owned snapshot without exposing the internal mount Container. */
  querySlotObject(object: Container): CanePixiSlotObjectStateV1 | null {
    const record = this.#slotObjects.get(object);
    if (record === undefined) return null;
    return {
      slotId: record.slotId,
      placement: record.placement,
      attachmentId: record.attachmentId,
      active: record.active,
      slotAlpha: record.slotAlpha,
      visibleWhenAttachmentIds: record.visibleWhenAttachmentIds,
      clippingAttachmentId: record.clip?.attachmentId ?? null,
    };
  }

  /** Copies matching foreign objects into caller-owned retained storage. */
  writeSlotObjects(output: Container[], slotIdOrName?: string): number {
    if (!Array.isArray(output)) {
      throw new RuntimeErrorV1("invalidArgument", "writeSlotObjects", "output must be an array.", {
        field: "output",
      });
    }
    const slotId = slotIdOrName === undefined ? null : this.controller.querySlot(slotIdOrName).id;
    let count = 0;
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || (slotId !== null && record.slotId !== slotId)) continue;
      output[count] = record.object;
      count += 1;
    }
    output.length = count;
    return count;
  }

  /** Removes every object for one Slot, or every Slot object when omitted. */
  removeSlotObjects(slotIdOrName?: string): number {
    const slotId = slotIdOrName === undefined ? null : this.controller.querySlot(slotIdOrName).id;
    let removed = 0;
    for (let index = this.#slotObjectList.length - 1; index >= 0; index -= 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || (slotId !== null && record.slotId !== slotId)) continue;
      this.#removeSlotObjectRecord(record, false);
      removed += 1;
    }
    if (removed > 0 && !this.destroyed && !this.#destroying) this.#projectFrame(this.player.currentFrame);
    else this.#refreshObjectStats();
    return removed;
  }

  removeSlotObject(object: Container): boolean {
    const record = this.#slotObjects.get(object);
    if (record === undefined) return false;
    this.#removeSlotObjectRecord(record, true);
    return true;
  }

  #removeSlotObjectRecord(record: SlotObjectRecordV1, reproject: boolean): void {
    const object = record.object;
    this.#slotObjects.delete(object);
    const recordIndex = this.#slotObjectList.indexOf(record);
    if (recordIndex >= 0) this.#slotObjectList.splice(recordIndex, 1);
    const records = this.#slotList(record.slotId, record.placement, false);
    if (records !== undefined) {
      const index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
      if (records.length === 0) {
        (record.placement === "before" ? this.#slotBeforeById : this.#slotAfterById).delete(record.slotId);
      }
    }
    if (record.appliedClip !== null) record.mount.setMask({ mask: null });
    if (object.parent === record.mount) record.mount.removeChild(object);
    if (record.mount.parent !== null) record.mount.parent.removeChild(record.mount);
    record.mount.destroy({ children: false });
    if (reproject && !this.destroyed && !this.#destroying) this.#projectFrame(this.player.currentFrame);
    else this.#refreshObjectStats();
  }

  override destroy(...args: Parameters<Container["destroy"]>): void {
    if (this.destroyed) return;
    this.#destroying = true;
    this.autoUpdate = false;
    for (const unsubscribe of this.#ownedUnsubscribers) unsubscribe();
    this.#ownedUnsubscribers.clear();
    for (const object of [...this.#boneObjects.keys()]) this.removeBoneObject(object);
    for (const object of [...this.#slotObjects.keys()]) this.removeSlotObject(object);
    for (const segment of this.#segments) {
      if (!segment.destroyed) segment.destroy();
    }
    this.#segments.length = 0;
    if (!this.#boneOverlay.destroyed) this.#boneOverlay.destroy({ children: false });
    if (!this.#maskOverlay.destroyed) this.#maskOverlay.destroy({ children: true });
    this.#clippingMasks.clear();
    this.#clippingMaskList.length = 0;
    super.destroy(...args);
  }

  #projectFrame(frame: RuntimeFrameV1): void {
    this.#ensureCatalog();
    this.#applySequence += 1;
    for (let index = 0; index < frame.bones.length; index += 1) {
      const bone = frame.bones[index];
      if (bone !== undefined) this.#boneFrameById.set(bone.id, bone);
    }
    this.player.writeDrawOrderSlotIds(this.#drawOrderSlotIds);
    for (let index = 0; index < this.#drawOrderSlotIds.length; index += 1) {
      const slotId = this.#drawOrderSlotIds[index];
      if (slotId !== undefined) this.#attachmentIndexBySlotId.set(slotId, -1);
    }
    for (let index = 0; index < frame.renderPacket.attachments.length; index += 1) {
      const attachment = frame.renderPacket.attachments[index];
      if (attachment !== undefined) this.#attachmentIndexBySlotId.set(attachment.slotId, index);
    }

    this.#prepareSlotObjectsAndClipping(frame.sequence);
    this.#composeRenderOrder(frame);
    for (let index = 0; index < this.#boneMountList.length; index += 1) {
      const bone = this.#boneMountList[index];
      if (bone !== undefined) this.#updateBoneMount(bone);
    }
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record !== undefined) this.#updateSlotMount(record);
    }
    this.#aggregateStats();
  }

  #projectResult(frame: RuntimeFrameV1): RuntimeFrameV1 {
    this.#projectFrame(frame);
    return frame;
  }

  #composeRenderOrder(frame: RuntimeFrameV1): void {
    const packet = frame.renderPacket;
    let attachmentCursor = 0;
    let segmentStart = 0;
    let segmentIndex = 0;
    let childIndex = 0;

    for (let slotIndex = 0; slotIndex < this.#drawOrderSlotIds.length; slotIndex += 1) {
      const slotId = this.#drawOrderSlotIds[slotIndex];
      if (slotId === undefined) continue;
      const attachmentIndex = this.#attachmentIndexBySlotId.get(slotId);
      const hasAttachment = attachmentIndex !== undefined && attachmentIndex >= 0;
      if (hasAttachment && attachmentIndex !== attachmentCursor) {
        throw new RuntimeErrorV1(
          "validationFailed",
          "pixiApply",
          "RenderPacket attachment order differs from the published Slot draw order.",
          { field: "renderPacket.attachments", entityId: slotId },
        );
      }
      const before = this.#slotBeforeById.get(slotId);
      if (hasActiveSlotObjectV1(before)) {
        if (attachmentCursor > segmentStart) {
          this.#applySegment(packet, segmentStart, attachmentCursor, segmentIndex, childIndex);
          segmentIndex += 1;
          childIndex += 1;
          segmentStart = attachmentCursor;
        }
        for (let index = 0; index < before.length; index += 1) {
          const record = before[index];
          if (record === undefined || !record.active) continue;
          this.#placeChildAt(record.mount, childIndex);
          childIndex += 1;
        }
      }
      if (hasAttachment) attachmentCursor += 1;
      const after = this.#slotAfterById.get(slotId);
      if (hasActiveSlotObjectV1(after)) {
        if (attachmentCursor > segmentStart) {
          this.#applySegment(packet, segmentStart, attachmentCursor, segmentIndex, childIndex);
          segmentIndex += 1;
          childIndex += 1;
          segmentStart = attachmentCursor;
        }
        for (let index = 0; index < after.length; index += 1) {
          const record = after[index];
          if (record === undefined || !record.active) continue;
          this.#placeChildAt(record.mount, childIndex);
          childIndex += 1;
        }
      }
    }
    if (attachmentCursor !== packet.attachments.length) {
      throw new RuntimeErrorV1(
        "validationFailed",
        "pixiApply",
        "RenderPacket references a Slot absent from the published draw order.",
        { field: "renderPacket.attachments" },
      );
    }
    if (packet.attachments.length > segmentStart) {
      this.#applySegment(packet, segmentStart, packet.attachments.length, segmentIndex, childIndex);
      segmentIndex += 1;
      childIndex += 1;
    }

    for (let index = segmentIndex; index < this.#segments.length; index += 1) {
      const segment = this.#segments[index];
      if (segment === undefined) continue;
      segment.visible = false;
      if (segment.parent === this) this.removeChild(segment);
    }
    this.#placeChildAt(this.#boneOverlay, childIndex);
    childIndex += 1;
    this.#placeChildAt(this.#maskOverlay, childIndex);
    this.#activeSegmentCount = segmentIndex;
  }

  #prepareSlotObjectsAndClipping(frameSequence: number): void {
    this.#slotAttachmentById.clear();
    this.#slotAlphaById.clear();
    this.#beforeClipBySlotId.clear();
    this.#afterClipBySlotId.clear();
    for (let index = 0; index < this.#clippingMaskList.length; index += 1) {
      const clip = this.#clippingMaskList[index];
      if (clip !== undefined) clip.slotObjectUses = 0;
    }
    if (this.#slotObjectList.length === 0) {
      for (let index = 0; index < this.#clippingMaskList.length; index += 1) {
        const clip = this.#clippingMaskList[index];
        if (clip !== undefined) clip.graphics.visible = false;
      }
      return;
    }
    let activeClip: ClippingMaskRecordV1 | null = null;

    for (let index = 0; index < this.#drawOrderSlotIds.length; index += 1) {
      const slotId = this.#drawOrderSlotIds[index];
      if (slotId === undefined) continue;
      const attachmentId = this.player.querySlotAttachmentId(slotId);
      this.#slotAttachmentById.set(slotId, attachmentId);
      this.#slotAlphaById.set(slotId, this.player.querySlotAlpha(slotId));

      if (attachmentId === null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
      this.#beforeClipBySlotId.set(slotId, activeClip);

      if (attachmentId !== null && this.#clippingAttachmentIds.has(attachmentId)) {
        const geometry = this.player.queryClippingGeometry(attachmentId);
        activeClip = geometry === null ? null : this.#updateClippingMask(geometry, frameSequence);
      }
      this.#afterClipBySlotId.set(slotId, activeClip);
      if (attachmentId !== null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
    }

    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined) continue;
      record.attachmentId = this.#slotAttachmentById.get(record.slotId) ?? null;
      record.slotAlpha = this.#slotAlphaById.get(record.slotId) ?? 0;
      const attachmentVisible = record.visibleWhenAttachmentIds === null
        ? (!record.followAttachmentVisibility || record.attachmentId !== null)
        : record.attachmentId !== null && record.visibleWhenAttachmentIds.includes(record.attachmentId);
      record.active = this.#boneFrameById.has(record.boneId)
        && attachmentVisible
        && (!record.inheritSlotAlpha || record.slotAlpha > 0);
      if (!record.active && record.mount.parent === this) this.removeChild(record.mount);
      record.clip = record.clipping === "inherit"
        ? (record.placement === "before"
          ? this.#beforeClipBySlotId.get(record.slotId)
          : this.#afterClipBySlotId.get(record.slotId)) ?? null
        : null;
      if (record.active && record.clip !== null) record.clip.slotObjectUses += 1;
    }
    for (let index = 0; index < this.#clippingMaskList.length; index += 1) {
      const clip = this.#clippingMaskList[index];
      if (clip !== undefined) clip.graphics.visible = clip.slotObjectUses > 0;
    }
  }

  #updateClippingMask(
    geometry: RuntimeClippingGeometryV1,
    frameSequence: number,
  ): ClippingMaskRecordV1 {
    let record = this.#clippingMasks.get(geometry.attachmentId);
    if (record === undefined) {
      const graphics = new Graphics({ label: `CaneClip:${geometry.attachmentId}` });
      graphics.eventMode = "none";
      record = {
        attachmentId: geometry.attachmentId,
        graphics,
        pixiPolygonPool: [],
        endSlotId: geometry.endSlotId,
        inverse: geometry.inverse,
        vertexCount: 0,
        slotObjectUses: 0,
        lastUsedSequence: frameSequence,
      };
      this.#clippingMasks.set(geometry.attachmentId, record);
      this.#clippingMaskList.push(record);
      this.#maskOverlay.addChild(graphics);
    }

    record.endSlotId = geometry.endSlotId;
    record.inverse = geometry.inverse;
    record.vertexCount = 0;
    record.lastUsedSequence = frameSequence;
    record.graphics.clear();
    for (let polygonIndex = 0; polygonIndex < geometry.convexPolygonsXy.length; polygonIndex += 1) {
      const cane = geometry.convexPolygonsXy[polygonIndex];
      if (cane === undefined || cane.length < 6) continue;
      let pixi = record.pixiPolygonPool[polygonIndex];
      if (pixi === undefined) {
        pixi = [];
        record.pixiPolygonPool[polygonIndex] = pixi;
      }
      pixi.length = cane.length;
      for (let offset = 0; offset < cane.length; offset += 2) {
        pixi[offset] = cane[offset] ?? 0;
        pixi[offset + 1] = -(cane[offset + 1] ?? 0);
      }
      record.vertexCount += cane.length / 2;
      record.graphics.poly(pixi).fill(0xffffff);
    }
    return record;
  }

  #applySegment(
    packet: RuntimeFrameV1["renderPacket"],
    start: number,
    end: number,
    segmentIndex: number,
    childIndex: number,
  ): void {
    const segment = this.#ensureSegment(segmentIndex);
    segment.applyRange(packet, start, end);
    this.#placeChildAt(segment, childIndex);
    segment.visible = true;
  }

  #ensureSegment(index: number): CanePixiBatchView {
    let segment = this.#segments[index];
    if (segment === undefined) {
      segment = new CanePixiBatchView(this.#viewOptions);
      segment.label = `CaneBatchSegment:${index}`;
      this.#segments[index] = segment;
    }
    return segment;
  }

  #placeChildAt(child: Container, index: number): void {
    if (child.parent !== this) this.addChildAt(child, index);
    else if (this.children[index] !== child) this.setChildIndex(child, index);
  }

  #updateBoneMount(bone: BoneMountV1): void {
    const frame = this.#boneFrameById.get(bone.boneId);
    if (frame === undefined) {
      bone.mount.visible = false;
      return;
    }
    bone.mount.visible = true;
    writeCaneAffineToPixiMatrixV1(frame.matrix, bone.matrix);
    bone.mount.setFromMatrix(bone.matrix);
  }

  #updateSlotMount(record: SlotObjectRecordV1): void {
    const frame = this.#boneFrameById.get(record.boneId);
    if (frame === undefined || !record.active) {
      record.mount.visible = false;
      this.#applySlotObjectMask(record, null);
      return;
    }
    record.mount.visible = true;
    record.mount.alpha = record.inheritSlotAlpha ? record.slotAlpha : 1;
    writeCaneAffineToPixiMatrixV1(frame.matrix, record.matrix);
    record.mount.setFromMatrix(record.matrix);
    this.#applySlotObjectMask(record, record.clip);
  }

  #applySlotObjectMask(record: SlotObjectRecordV1, clip: ClippingMaskRecordV1 | null): void {
    const inverse = clip?.inverse ?? false;
    if (record.appliedClip === clip && record.appliedInverse === inverse) return;
    record.mount.setMask(clip === null
      ? { mask: null }
      : { mask: clip.graphics, inverse });
    record.appliedClip = clip;
    record.appliedInverse = inverse;
  }

  #aggregateStats(): void {
    const stats = this.#stats;
    resetRuntimeStatsV1(stats, this.#applySequence);
    let structureChanged = false;
    for (let index = 0; index < this.#activeSegmentCount; index += 1) {
      const segment = this.#segments[index];
      if (segment === undefined) continue;
      segment.writeLastApplyStats(this.#segmentStatsScratch);
      const segmentStats = this.#segmentStatsScratch;
      stats.activeAttachments += segmentStats.activeAttachments;
      stats.cachedAttachments += segmentStats.cachedAttachments;
      stats.activeVertices += segmentStats.activeVertices;
      stats.activeIndices += segmentStats.activeIndices;
      stats.vertexUploadBytes += segmentStats.vertexUploadBytes;
      stats.indexRepackBytes += segmentStats.indexRepackBytes;
      stats.isolatedDrawCalls += segmentStats.isolatedDrawCalls;
      stats.createdAttachments += segmentStats.createdAttachments;
      stats.reusedAttachments += segmentStats.reusedAttachments;
      stats.destroyedAttachments += segmentStats.destroyedAttachments;
      structureChanged ||= segmentStats.structureChanged;
    }
    stats.structureChanged = structureChanged;
    stats.caneBatchSegments = this.#activeSegmentCount;
    stats.slotObjectBatchSplits = Math.max(0, this.#activeSegmentCount - 1);
    stats.slotObjects = this.#slotObjects.size;
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || !record.active) continue;
      stats.activeSlotObjects += 1;
      if (record.clip !== null) stats.maskedSlotObjects += 1;
    }
    for (let index = 0; index < this.#clippingMaskList.length; index += 1) {
      const clip = this.#clippingMaskList[index];
      if (clip === undefined || clip.slotObjectUses === 0) continue;
      stats.activeClippingMasks += 1;
      stats.clippingMaskVertexWrites += clip.vertexCount;
    }
    stats.slotObjectMaskPasses = stats.maskedSlotObjects;
    stats.boneObjects = this.#boneObjects.size;
  }

  #refreshObjectStats(): void {
    this.#stats.slotObjects = this.#slotObjects.size;
    this.#stats.boneObjects = this.#boneObjects.size;
  }

  #slotList(
    slotId: string,
    placement: CanePixiSlotPlacementV1,
    create: true,
  ): SlotObjectRecordV1[];
  #slotList(
    slotId: string,
    placement: CanePixiSlotPlacementV1,
    create: false,
  ): SlotObjectRecordV1[] | undefined;
  #slotList(
    slotId: string,
    placement: CanePixiSlotPlacementV1,
    create: boolean,
  ): SlotObjectRecordV1[] | undefined {
    const map = placement === "before" ? this.#slotBeforeById : this.#slotAfterById;
    let records = map.get(slotId);
    if (records === undefined && create) {
      records = [];
      map.set(slotId, records);
    }
    return records;
  }

  #ensureCatalog(): void {
    if (this.#catalogIdentity === this.player.data) return;
    this.#catalogIdentity = this.player.data;
    this.#boneFrameById.clear();
    this.#slotBoneById.clear();
    this.#attachmentIndexBySlotId.clear();
    this.#clippingAttachmentIds.clear();
    const slots = this.player.data.document.slots;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot === undefined) continue;
      this.#slotBoneById.set(slot.id, slot.boneId);
      this.#attachmentIndexBySlotId.set(slot.id, -1);
    }
    const attachments = this.player.data.document.attachments;
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      if (attachment?.type === "clipping") this.#clippingAttachmentIds.add(attachment.id);
    }
  }

  #assertForeignObject(object: Container, operation: string): void {
    if (!(object instanceof Container) || object === this || object === this.#boneOverlay
      || this.#segments.includes(object as CanePixiBatchView)) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        operation,
        "object must be a live foreign Pixi Container.",
        { field: "object" },
      );
    }
    if (object.destroyed) {
      throw new RuntimeErrorV1("invalidState", operation, "Cannot attach a destroyed Pixi object.", {
        field: "object",
      });
    }
    let parent: Container | null = this;
    while (parent !== null) {
      if (parent === object) {
        throw new RuntimeErrorV1("invalidArgument", operation, "Attaching an ancestor would create a cycle.", {
          field: "object",
        });
      }
      parent = parent.parent;
    }
  }

  #ownSubscription(unsubscribe: () => void): () => void {
    let active = true;
    const owned = (): void => {
      if (!active) return;
      active = false;
      this.#ownedUnsubscribers.delete(owned);
      unsubscribe();
    };
    this.#ownedUnsubscribers.add(owned);
    return owned;
  }
}

function emptyRuntimeStatsV1(): MutableCanePixiRuntimeStatsV1 {
  return {
    applySequence: 0,
    activeAttachments: 0,
    cachedAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexRepackBytes: 0,
    isolatedDrawCalls: 0,
    structureChanged: false,
    createdAttachments: 0,
    reusedAttachments: 0,
    destroyedAttachments: 0,
    coreCpuMilliseconds: null,
    projectionCpuMilliseconds: null,
    caneBatchSegments: 0,
    slotObjectBatchSplits: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    activeClippingMasks: 0,
    clippingMaskVertexWrites: 0,
    slotObjectMaskPasses: 0,
    boneObjects: 0,
  };
}

function emptyBatchStatsV1(): MutableCanePixiBatchApplyStatsV1 {
  return {
    applySequence: 0,
    activeAttachments: 0,
    cachedAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexRepackBytes: 0,
    isolatedDrawCalls: 0,
    structureChanged: false,
    createdAttachments: 0,
    reusedAttachments: 0,
    destroyedAttachments: 0,
  };
}

function resetRuntimeStatsV1(stats: MutableCanePixiRuntimeStatsV1, applySequence: number): void {
  stats.applySequence = applySequence;
  stats.activeAttachments = 0;
  stats.cachedAttachments = 0;
  stats.activeVertices = 0;
  stats.activeIndices = 0;
  stats.vertexUploadBytes = 0;
  stats.indexRepackBytes = 0;
  stats.isolatedDrawCalls = 0;
  stats.structureChanged = false;
  stats.createdAttachments = 0;
  stats.reusedAttachments = 0;
  stats.destroyedAttachments = 0;
  stats.coreCpuMilliseconds = null;
  stats.projectionCpuMilliseconds = null;
  stats.caneBatchSegments = 0;
  stats.slotObjectBatchSplits = 0;
  stats.slotObjects = 0;
  stats.activeSlotObjects = 0;
  stats.maskedSlotObjects = 0;
  stats.activeClippingMasks = 0;
  stats.clippingMaskVertexWrites = 0;
  stats.slotObjectMaskPasses = 0;
  stats.boneObjects = 0;
}

function hasActiveSlotObjectV1(records: readonly SlotObjectRecordV1[] | undefined): records is SlotObjectRecordV1[] {
  if (records === undefined) return false;
  for (let index = 0; index < records.length; index += 1) {
    if (records[index]?.active === true) return true;
  }
  return false;
}

function clippingEndsAtSlotV1(clip: ClippingMaskRecordV1 | null, slotId: string): boolean {
  return clip !== null && clip.endSlotId === slotId;
}

function normalizeSlotObjectOptionsV1(
  input: CanePixiSlotPlacementV1 | CanePixiSlotObjectOptionsV1,
): {
  readonly placement: CanePixiSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachment: string | readonly string[] | undefined;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CanePixiSlotClippingV1;
} {
  const options = typeof input === "string" ? { placement: input } : input;
  if (options === null || typeof options !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "addSlotObject", "options must be an object or placement string.", {
      field: "options",
    });
  }
  const placement = options.placement ?? "after";
  const followAttachmentVisibility = options.followAttachmentVisibility ?? true;
  const visibleWhenAttachment = options.visibleWhenAttachment;
  const inheritSlotAlpha = options.inheritSlotAlpha ?? true;
  const clipping = options.clipping ?? "inherit";
  if (placement !== "before" && placement !== "after") {
    throw new RuntimeErrorV1("invalidArgument", "addSlotObject", "placement must be 'before' or 'after'.", {
      field: "placement",
    });
  }
  if (typeof followAttachmentVisibility !== "boolean") {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "addSlotObject",
      "followAttachmentVisibility must be boolean.",
      { field: "followAttachmentVisibility" },
    );
  }
  if (typeof inheritSlotAlpha !== "boolean") {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "addSlotObject",
      "inheritSlotAlpha must be boolean.",
      { field: "inheritSlotAlpha" },
    );
  }
  if (visibleWhenAttachment !== undefined
    && typeof visibleWhenAttachment !== "string"
    && !Array.isArray(visibleWhenAttachment)) {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "addSlotObject",
      "visibleWhenAttachment must be an Attachment reference or array.",
      { field: "visibleWhenAttachment" },
    );
  }
  if (clipping !== "inherit" && clipping !== "none") {
    throw new RuntimeErrorV1("invalidArgument", "addSlotObject", "clipping must be 'inherit' or 'none'.", {
      field: "clipping",
    });
  }
  return { placement, followAttachmentVisibility, visibleWhenAttachment, inheritSlotAlpha, clipping };
}

function resolveVisibleAttachmentsV1(
  player: RuntimePlayerV1,
  slotId: string,
  references: string | readonly string[] | undefined,
): readonly string[] | null {
  if (references === undefined) return null;
  const values = typeof references === "string" ? [references] : references;
  if (values.length === 0) {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "addSlotObject",
      "visibleWhenAttachment must not be empty.",
      { field: "visibleWhenAttachment" },
    );
  }
  const resolved: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const reference = values[index];
    if (typeof reference !== "string" || reference.length === 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "addSlotObject",
        "Every visible Attachment reference must be a non-empty string.",
        { field: `visibleWhenAttachment[${index}]` },
      );
    }
    const attachment = player.data.document.attachments.find((candidate) =>
      candidate.slotId === slotId && (candidate.id === reference || candidate.name === reference));
    if (attachment === undefined) {
      throw new RuntimeErrorV1(
        "notFound",
        "addSlotObject",
        "Visible Attachment is not available in the Slot.",
        { field: `visibleWhenAttachment[${index}]`, entityId: reference },
      );
    }
    if (!resolved.includes(attachment.id)) resolved.push(attachment.id);
  }
  return Object.freeze(resolved);
}
