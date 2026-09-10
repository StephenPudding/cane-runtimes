import {
  CaneRuntimeControllerV1,
  RuntimeErrorV1,
  RuntimePlayerV1,
  type RootTransformV1,
  type RuntimeAfterConstraintsListenerV1,
  type RuntimeAttachmentV1,
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
  type RuntimePhysicsConstraintOverrideV1,
  type RuntimePhysicsEnvironmentV1,
  type RuntimePhysicsHostMotionModeV1,
  type RuntimePlayerOptionsV1,
  type RuntimeRadialWaveModifierV1,
  type RuntimeRenderAttachmentV1,
  type RuntimeResourceChangesV1,
  type RuntimeResourceSnapshotV1,
  type RuntimeResourceTransactionV1,
  type RuntimeRootTransformOptionsV1,
  type RuntimeSamplingV1,
  type RuntimeSkinBuilderOptionsV1,
  type RuntimeSkinBuilderV1,
  type RuntimeSkinV1,
} from "@cane-runtime/core";
import type { CaneLayaAssetV1 } from "./assets.js";
import { CaneLayaBoundsProviderV1, type CaneLayaBoundsProviderOptionsV1 } from "./bounds.js";
import {
  applyCaneAffineToLayaSpriteV1,
  applyLayaMatrixToSpriteV1,
  writeCanePointToLayaV1,
  writeInverseTransformCanePointV1,
  writeLayaPointToCaneV1,
  writeTransformCanePointV1,
} from "./coordinates.js";
import { assertCaneLayaWebRendererV1 } from "./engine.js";
import type { CaneLayaValidationModeV1 } from "./geometry.js";
import {
  CaneLayaBatchView,
  emptyBatchStatsV1,
  type CaneLayaBatchViewOptionsV1,
} from "./render-view.js";
import { CaneLayaMaterialSetV1 } from "./shader.js";
import { LayaTextureStore } from "./texture-store.js";

const AUTHORED_SAMPLING_V1: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });
const ZERO_POINT_V1 = Object.freeze({ x: 0, y: 0 });

export interface CaneLayaRuntimeOptionsV1 {
  readonly asset?: CaneLayaAssetV1;
  readonly player?: RuntimePlayerV1;
  readonly playerOptions?: RuntimePlayerOptionsV1;
  readonly controller?: CaneRuntimeControllerV1;
  readonly textures?: LayaTextureStore;
  readonly timer?: Laya.Timer;
  readonly autoUpdate?: boolean;
  readonly updateWhenInvisible?: boolean;
  readonly sampling?: RuntimeSamplingV1;
  readonly validationMode?: CaneLayaBatchViewOptionsV1["validationMode"];
  readonly bounds?: CaneLayaBoundsProviderOptionsV1;
  readonly measureCpuTime?: boolean;
}

export type CaneLayaSlotPlacementV1 = "before" | "after";
export type CaneLayaSlotClippingV1 = "inherit" | "none";

export interface CaneLayaSlotObjectOptionsV1 {
  readonly placement?: CaneLayaSlotPlacementV1;
  readonly followAttachmentVisibility?: boolean;
  readonly visibleWhenAttachment?: string | readonly string[];
  readonly inheritSlotAlpha?: boolean;
  readonly clipping?: CaneLayaSlotClippingV1;
}

export interface CaneLayaSlotObjectStateV1 {
  readonly slotId: string;
  readonly placement: CaneLayaSlotPlacementV1;
  readonly attachmentId: string | null;
  readonly active: boolean;
  readonly slotAlpha: number;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly clippingAttachmentId: string | null;
  readonly inverseClipping: boolean;
}

export interface CaneLayaRuntimeStatsV1 {
  readonly frameSequence: number;
  readonly activeAttachments: number;
  readonly activeVertices: number;
  readonly activeIndices: number;
  readonly vertexUploadBytes: number;
  readonly indexUploadBytes: number;
  readonly bufferUploads: number;
  readonly meshRebuilds: number;
  readonly drawCalls: number;
  /** Cane Mesh2D draws that cannot merge into another Laya display node. */
  readonly isolatedDrawCalls: number;
  readonly batchSegments: number;
  readonly naturalBatchSplits: number;
  readonly slotObjectBatchSplits: number;
  /** Active inherited clipping masks that force a foreign-object render boundary. */
  readonly clippingBatchSplits: number;
  readonly slotObjects: number;
  readonly activeSlotObjects: number;
  readonly maskedSlotObjects: number;
  readonly clippingMaskVertexWrites: number;
  readonly boneObjects: number;
  readonly coreCpuMilliseconds: number | null;
  readonly projectionCpuMilliseconds: number | null;
  readonly animationSamples: number;
  readonly constraintGeometrySolves: number;
  readonly framesPublished: number;
}

type MutableRuntimeStatsV1 = {
  -readonly [Field in keyof Omit<
    CaneLayaRuntimeStatsV1,
    "animationSamples" | "constraintGeometrySolves" | "framesPublished"
  >]: CaneLayaRuntimeStatsV1[Field]
};

interface BoneMountV1 {
  readonly boneId: string;
  readonly mount: Laya.Sprite;
  readonly matrix: Laya.Matrix;
  readonly objects: Set<Laya.Sprite>;
}

interface BoneObjectRecordV1 {
  readonly object: Laya.Sprite;
  readonly bone: BoneMountV1;
}

interface SlotObjectRecordV1 {
  readonly object: Laya.Sprite;
  readonly slotId: string;
  readonly boneId: string;
  readonly placement: CaneLayaSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CaneLayaSlotClippingV1;
  readonly mount: Laya.Sprite;
  readonly matrix: Laya.Matrix;
  readonly inverseMatrix: Laya.Matrix;
  readonly mask: Laya.Sprite;
  readonly polygonPool: number[][];
  readonly pathPool: any[][];
  attachmentId: string | null;
  slotAlpha: number;
  active: boolean;
  clip: RuntimeClippingGeometryV1 | null;
  appliedClipId: string | null;
}

interface NormalizedSlotObjectOptionsV1 {
  readonly placement: CaneLayaSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachment: string | readonly string[] | undefined;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CaneLayaSlotClippingV1;
}

/**
 * LayaAir 3.4.1 display node backed by exactly one authoritative Core player.
 * It only projects published vertices, colors and final Bone matrices.
 */
export class CaneLayaRuntime extends Laya.Sprite {
  readonly player: RuntimePlayerV1;
  readonly controller: CaneRuntimeControllerV1;
  readonly textures: LayaTextureStore;
  readonly bounds: CaneLayaBoundsProviderV1;

  readonly #materials: CaneLayaMaterialSetV1;
  readonly #sampling: RuntimeSamplingV1;
  readonly #validationMode: CaneLayaValidationModeV1;
  readonly #segments: CaneLayaBatchView[] = [];
  readonly #boneOverlay = new Laya.Sprite();
  readonly #boneMounts = new Map<string, BoneMountV1>();
  readonly #boneMountList: BoneMountV1[] = [];
  readonly #boneObjects = new Map<Laya.Sprite, BoneObjectRecordV1>();
  readonly #slotObjects = new Map<Laya.Sprite, SlotObjectRecordV1>();
  readonly #slotObjectList: SlotObjectRecordV1[] = [];
  readonly #slotBeforeById = new Map<string, SlotObjectRecordV1[]>();
  readonly #slotAfterById = new Map<string, SlotObjectRecordV1[]>();
  readonly #boneFrameById = new Map<string, RuntimeBoneFrameV1>();
  readonly #slotBoneById = new Map<string, string>();
  readonly #clippingAttachmentIds = new Set<string>();
  readonly #drawOrderSlotIds: string[] = [];
  readonly #attachmentIndexBySlotId = new Map<string, number>();
  readonly #beforeClipBySlotId = new Map<string, RuntimeClippingGeometryV1 | null>();
  readonly #afterClipBySlotId = new Map<string, RuntimeClippingGeometryV1 | null>();
  readonly #canePointScratch = { x: 0, y: 0 };
  readonly #layaPointScratch = new Laya.Point();
  readonly #stats: MutableRuntimeStatsV1 = emptyRuntimeStatsV1();
  readonly #segmentStatsScratch = emptyBatchStatsV1();
  readonly #ownedUnsubscribers = new Set<() => void>();
  readonly #measureCpuTime: boolean;
  #timer: Laya.Timer;
  #autoUpdate = false;
  #paused = false;
  #timeScale = 1;
  #updateWhenInvisible: boolean;
  #activeSegmentCount = 0;
  #catalogIdentity: object | null = null;
  #renderContextLost = false;
  #destroying = false;
  readonly #tick = (): void => {
    if (!this.#updateWhenInvisible && !this.visible) return;
    this.update(this.#timer.delta / 1000);
  };

  constructor(options: CaneLayaRuntimeOptionsV1) {
    assertCaneLayaWebRendererV1("layaCreateRuntime");
    super();
    if (options === null || typeof options !== "object") {
      throw new RuntimeErrorV1("invalidArgument", "layaCreateRuntime", "options must be an object.");
    }
    const player = options.player ?? (options.asset === undefined
      ? null
      : new RuntimePlayerV1(options.asset.data, options.playerOptions));
    if (player === null) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "layaCreateRuntime",
        "Provide a RuntimePlayerV1 or CaneLayaAssetV1.",
        { field: "player" },
      );
    }
    if (options.controller !== undefined && options.controller.player !== player) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "layaCreateRuntime",
        "controller and player must refer to the same RuntimePlayerV1.",
        { field: "controller" },
      );
    }
    const textures = options.textures ?? options.asset?.textures;
    if (textures === undefined || textures.destroyed) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "layaCreateRuntime",
        "Provide a live LayaTextureStore or CaneLayaAssetV1.",
        { field: "textures" },
      );
    }
    this.name = "CaneLayaRuntime";
    this.mouseThrough = true;
    this.player = player;
    this.controller = options.controller ?? new CaneRuntimeControllerV1(player);
    this.textures = textures;
    this.#materials = new CaneLayaMaterialSetV1();
    this.#sampling = options.sampling ?? AUTHORED_SAMPLING_V1;
    this.#validationMode = options.validationMode ?? "once";
    this.#timer = options.timer ?? Laya.timer;
    this.#updateWhenInvisible = options.updateWhenInvisible ?? true;
    this.#measureCpuTime = options.measureCpuTime ?? false;
    this.#boneOverlay.name = "CaneBoneObjects";
    this.#boneOverlay.mouseThrough = true;
    this.bounds = new CaneLayaBoundsProviderV1(this, options.bounds);
    this.#ownedUnsubscribers.add(this.textures.onTexturesChanged((change) => {
      if (this.destroyed || this.#destroying) return;
      if (change === "contextLost") {
        this.#renderContextLost = true;
        return;
      }
      if (change === "contextRestored") {
        this.#renderContextLost = false;
        for (let index = 0; index < this.#segments.length; index += 1) {
          this.#segments[index]?.invalidateGpuResources();
        }
      }
      if (this.#renderContextLost) return;
      this.applyCurrentFrame();
    }));
    this.#projectFrame(this.player.currentFrame);
    this.autoUpdate = options.autoUpdate ?? true;
  }

  get autoUpdate(): boolean { return this.#autoUpdate; }
  set autoUpdate(value: boolean) {
    if (this.#autoUpdate === value) return;
    this.#autoUpdate = value;
    if (value) this.#timer.frameLoop(1, this, this.#tick);
    else this.#timer.clear(this, this.#tick);
  }

  get timer(): Laya.Timer { return this.#timer; }
  set timer(value: Laya.Timer) {
    if (value === this.#timer) return;
    const reconnect = this.#autoUpdate;
    if (reconnect) this.#timer.clear(this, this.#tick);
    this.#timer = value;
    if (reconnect) this.#timer.frameLoop(1, this, this.#tick);
  }

  get paused(): boolean { return this.#paused; }
  set paused(value: boolean) { this.#paused = Boolean(value); }
  pause(): this { this.#paused = true; return this; }
  resume(): this { this.#paused = false; return this; }

  get timeScale(): number { return this.#timeScale; }
  set timeScale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RuntimeErrorV1("invalidArgument", "layaSetTimeScale", "timeScale must be finite and non-negative.");
    }
    this.#timeScale = value;
  }

  get updateWhenInvisible(): boolean { return this.#updateWhenInvisible; }
  set updateWhenInvisible(value: boolean) { this.#updateWhenInvisible = Boolean(value); }
  get renderContextLost(): boolean { return this.#renderContextLost; }

  /** Cold-path snapshot. The hot update path mutates retained counters only. */
  get lastApplyStats(): CaneLayaRuntimeStatsV1 {
    const evaluation = this.player.lastEvaluationStats;
    return {
      ...this.#stats,
      animationSamples: evaluation.animationSamples,
      constraintGeometrySolves: evaluation.constraintGeometrySolves,
      framesPublished: evaluation.framesPublished,
    };
  }

  update(deltaSeconds: number): RuntimeFrameV1 {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RuntimeErrorV1("invalidArgument", "layaUpdate", "deltaSeconds must be finite and non-negative.");
    }
    if (this.#paused || this.#timeScale === 0) return this.player.currentFrame;
    const started = this.#measureCpuTime ? nowV1() : 0;
    const frame = this.controller.advance(deltaSeconds * this.#timeScale, this.#sampling);
    const projected = this.#measureCpuTime ? nowV1() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      this.#stats.coreCpuMilliseconds = projected - started;
      this.#stats.projectionCpuMilliseconds = nowV1() - projected;
    }
    return frame;
  }

  applyPose(): RuntimeFrameV1 {
    const started = this.#measureCpuTime ? nowV1() : 0;
    const frame = this.controller.apply(this.#sampling);
    const projected = this.#measureCpuTime ? nowV1() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      this.#stats.coreCpuMilliseconds = projected - started;
      this.#stats.projectionCpuMilliseconds = nowV1() - projected;
    }
    return frame;
  }

  /** Uploads an existing published frame; never samples or solves Core. */
  applyCurrentFrame(): RuntimeFrameV1 {
    const frame = this.player.currentFrame;
    const started = this.#measureCpuTime ? nowV1() : 0;
    this.#projectFrame(frame);
    if (this.#measureCpuTime) {
      this.#stats.coreCpuMilliseconds = 0;
      this.#stats.projectionCpuMilliseconds = nowV1() - started;
    }
    return frame;
  }

  findBone(idOrName: string) { return this.controller.findBone(idOrName); }
  queryBone(idOrName: string) { return this.controller.queryBone(idOrName); }
  findSlot(idOrName: string) { return this.controller.findSlot(idOrName); }
  querySlot(idOrName: string) { return this.controller.querySlot(idOrName); }
  findConstraint(idOrName: string) { return this.controller.findConstraint(idOrName); }
  queryConstraint(idOrName: string) { return this.controller.queryConstraint(idOrName); }

  setBonePosition(idOrName: string, x: number, y: number): this {
    this.controller.setBonePosition(idOrName, x, y); return this;
  }
  setBoneRotation(idOrName: string, rotationDegrees: number): this {
    this.controller.setBoneRotation(idOrName, rotationDegrees); return this;
  }
  setBoneLocal(idOrName: string, local: RuntimeBoneLocalV1): this {
    this.controller.setBoneLocal(idOrName, local); return this;
  }
  patchBoneLocal(idOrName: string, patch: RuntimeBoneLocalPatchV1): this {
    this.controller.patchBoneLocal(idOrName, patch); return this;
  }
  addBoneLocal(idOrName: string, delta: RuntimeBoneLocalAdditiveV1): this {
    this.controller.addBoneLocal(idOrName, delta); return this;
  }
  setBoneLocalPersistent(idOrName: string, local: RuntimeBoneLocalV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setBoneLocalPersistent(idOrName, local));
  }
  clearBoneLocalPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearBoneLocalPersistent(idOrName));
  }

  setConstraintTarget(idOrName: string, x: number, y: number): this {
    this.controller.setConstraintTarget(idOrName, x, y); return this;
  }
  setConstraintMix(idOrName: string, mix: number): this {
    this.controller.setConstraintMix(idOrName, mix); return this;
  }
  setConstraintPersistent(idOrName: string, parameters: RuntimeConstraintOverrideV1): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setConstraintPersistent(idOrName, parameters));
  }
  clearConstraintPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearConstraintPersistent(idOrName));
  }
  setPhysicsInertia(idOrName: string, inertia: number): RuntimeFrameV1 {
    const parameters: RuntimePhysicsConstraintOverrideV1 = { type: "physics", inertia };
    return this.setConstraintPersistent(idOrName, parameters);
  }

  setAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    mixSeconds?: number | null,
  ): RuntimeFrameV1 {
    return this.#projectResult(
      this.controller.setAnimation(trackIndex, animationIdOrName, looping, mixSeconds),
    );
  }
  addAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    delaySeconds = 0,
  ): RuntimeFrameV1 {
    return this.#projectResult(
      this.controller.addAnimation(trackIndex, animationIdOrName, looping, delaySeconds),
    );
  }
  clearTrack(trackIndex: number): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearTrack(trackIndex));
  }
  clearTracks(): RuntimeFrameV1 { return this.#projectResult(this.controller.clearTracks()); }
  setSkin(idOrName: string | null): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setSkin(idOrName));
  }
  setAttachment(slotIdOrName: string, attachmentIdOrName: string | null): RuntimeFrameV1 {
    return this.#projectResult(this.controller.setAttachment(slotIdOrName, attachmentIdOrName));
  }
  clearAttachment(slotIdOrName: string): RuntimeFrameV1 {
    return this.#projectResult(this.controller.clearAttachment(slotIdOrName));
  }

  get attachmentFactory() { return this.controller.attachments; }
  createRuntimeSkin(options: RuntimeSkinBuilderOptionsV1): RuntimeSkinBuilderV1 {
    return this.controller.createRuntimeSkin(options);
  }
  copyRuntimeSkin(
    idOrName: string,
    options: Partial<RuntimeSkinBuilderOptionsV1> & Pick<RuntimeSkinBuilderOptionsV1, "id">,
  ): RuntimeSkinBuilderV1 {
    return this.controller.copyRuntimeSkin(idOrName, options);
  }
  queryRuntimeResources(): RuntimeResourceSnapshotV1 { return this.controller.queryRuntimeResources(); }
  applyRuntimeResources(changes: RuntimeResourceChangesV1 | RuntimeResourceTransactionV1): RuntimeFrameV1 {
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

  jitterGeometry(modifier: RuntimeDeterministicJitterModifierV1): this {
    this.controller.jitterGeometry(modifier); return this;
  }
  radialWaveGeometry(modifier: RuntimeRadialWaveModifierV1): this {
    this.controller.radialWaveGeometry(modifier); return this;
  }
  modifyGeometry(modifier: RuntimeCustomGeometryModifierV1): this {
    this.controller.modifyGeometry(modifier); return this;
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
  resetPhysics(): RuntimeFrameV1 { return this.#projectResult(this.player.resetPhysics()); }
  resetPhysicsConstraint(constraintIdOrName: string): boolean {
    const id = this.controller.queryConstraint(constraintIdOrName).id;
    const result = this.player.resetPhysicsConstraint(id);
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

  /** Laya-local Bone origin relative to this runtime. */
  getBonePosition(idOrName: string, output: Laya.Point = new Laya.Point()): Laya.Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    output.setTo(matrix.tx, -matrix.ty);
    return output;
  }

  boneToGlobal(
    idOrName: string,
    point: Readonly<{ x: number; y: number }> = ZERO_POINT_V1,
    output: Laya.Point = new Laya.Point(),
  ): Laya.Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    writeTransformCanePointV1(matrix, point, this.#canePointScratch);
    writeCanePointToLayaV1(this.#canePointScratch, this.#layaPointScratch);
    this.localToGlobal(this.#layaPointScratch, false);
    output.setTo(this.#layaPointScratch.x, this.#layaPointScratch.y);
    return output;
  }

  globalToBone(
    idOrName: string,
    point: Readonly<{ x: number; y: number }>,
    output: Laya.Point = new Laya.Point(),
  ): Laya.Point {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    this.#layaPointScratch.setTo(point.x, point.y);
    this.globalToLocal(this.#layaPointScratch, false);
    writeLayaPointToCaneV1(this.#layaPointScratch, this.#canePointScratch);
    return writeInverseTransformCanePointV1(matrix, this.#canePointScratch, output);
  }

  addBoneObject(idOrName: string, object: Laya.Sprite): Laya.Sprite {
    this.#assertForeignObject(object, "layaAddBoneObject");
    this.removeBoneObject(object);
    this.removeSlotObject(object);
    const boneId = this.controller.queryBone(idOrName).id;
    let bone = this.#boneMounts.get(boneId);
    if (bone === undefined) {
      const mount = new Laya.Sprite();
      mount.name = `CaneBone:${boneId}`;
      mount.mouseThrough = true;
      bone = { boneId, mount, matrix: new Laya.Matrix(), objects: new Set() };
      this.#boneMounts.set(boneId, bone);
      this.#boneMountList.push(bone);
      this.#boneOverlay.addChild(mount);
    }
    bone.mount.addChild(object);
    bone.objects.add(object);
    this.#boneObjects.set(object, { object, bone });
    this.#updateBoneMount(bone);
    return object;
  }

  removeBoneObject(object: Laya.Sprite): boolean {
    const record = this.#boneObjects.get(object);
    if (record === undefined) return false;
    this.#boneObjects.delete(object);
    record.bone.objects.delete(object);
    if (object.parent === record.bone.mount) record.bone.mount.removeChild(object, false);
    if (record.bone.objects.size === 0) {
      record.bone.mount.removeSelf();
      record.bone.mount.destroy(false);
      this.#boneMounts.delete(record.bone.boneId);
      const index = this.#boneMountList.indexOf(record.bone);
      if (index >= 0) this.#boneMountList.splice(index, 1);
    }
    return true;
  }

  addSlotObject(
    slotIdOrName: string,
    object: Laya.Sprite,
    placementOrOptions: CaneLayaSlotPlacementV1 | CaneLayaSlotObjectOptionsV1 = "after",
  ): Laya.Sprite {
    this.#assertForeignObject(object, "layaAddSlotObject");
    const options = normalizeSlotOptionsV1(placementOrOptions);
    this.removeBoneObject(object);
    this.removeSlotObject(object);
    this.#ensureCatalog();
    const slotId = this.controller.querySlot(slotIdOrName).id;
    const boneId = this.#slotBoneById.get(slotId);
    if (boneId === undefined) {
      throw new RuntimeErrorV1("notFound", "layaAddSlotObject", "Slot Bone is unavailable.", {
        entityId: slotId,
      });
    }
    const mount = new Laya.Sprite();
    mount.name = `CaneSlot:${slotId}:${options.placement}`;
    mount.mouseThrough = true;
    mount.addChild(object);
    const mask = new Laya.Sprite();
    mask.name = `CaneSlotMask:${slotId}`;
    mask.mouseEnabled = false;
    const record: SlotObjectRecordV1 = {
      object,
      slotId,
      boneId,
      placement: options.placement,
      followAttachmentVisibility: options.followAttachmentVisibility,
      visibleWhenAttachmentIds: resolveVisibleAttachmentsV1(
        this.player,
        slotId,
        options.visibleWhenAttachment,
      ),
      inheritSlotAlpha: options.inheritSlotAlpha,
      clipping: options.clipping,
      mount,
      matrix: new Laya.Matrix(),
      inverseMatrix: new Laya.Matrix(),
      mask,
      polygonPool: [],
      pathPool: [],
      attachmentId: null,
      slotAlpha: 1,
      active: false,
      clip: null,
      appliedClipId: null,
    };
    this.#slotObjects.set(object, record);
    this.#slotObjectList.push(record);
    this.#slotList(slotId, options.placement, true).push(record);
    this.#projectFrame(this.player.currentFrame);
    return object;
  }

  getSlotObject(
    slotIdOrName: string,
    placement: CaneLayaSlotPlacementV1 = "after",
    index = 0,
  ): Laya.Sprite | null {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new RuntimeErrorV1("invalidArgument", "layaGetSlotObject", "index must be non-negative.");
    }
    const slotId = this.controller.querySlot(slotIdOrName).id;
    return this.#slotList(slotId, placement, false)?.[index]?.object ?? null;
  }

  querySlotObject(object: Laya.Sprite): CaneLayaSlotObjectStateV1 | null {
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
      inverseClipping: record.clip?.inverse ?? false,
    };
  }

  writeSlotObjects(output: Laya.Sprite[], slotIdOrName?: string): number {
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

  removeSlotObject(object: Laya.Sprite): boolean {
    const record = this.#slotObjects.get(object);
    if (record === undefined) return false;
    this.#removeSlotRecord(record, true);
    return true;
  }

  removeSlotObjects(slotIdOrName?: string): number {
    const slotId = slotIdOrName === undefined ? null : this.controller.querySlot(slotIdOrName).id;
    let removed = 0;
    for (let index = this.#slotObjectList.length - 1; index >= 0; index -= 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || (slotId !== null && record.slotId !== slotId)) continue;
      this.#removeSlotRecord(record, false);
      removed += 1;
    }
    if (removed > 0 && !this.destroyed && !this.#destroying) this.#projectFrame(this.player.currentFrame);
    return removed;
  }

  override destroy(destroyChild = true): void {
    if (this.destroyed || this.#destroying) return;
    this.#destroying = true;
    this.autoUpdate = false;
    for (const unsubscribe of this.#ownedUnsubscribers) unsubscribe();
    this.#ownedUnsubscribers.clear();
    for (const object of [...this.#boneObjects.keys()]) this.removeBoneObject(object);
    for (const object of [...this.#slotObjects.keys()]) this.removeSlotObject(object);
    for (const segment of this.#segments) if (!segment.destroyed) segment.destroy(true);
    this.#segments.length = 0;
    this.#materials.destroy();
    if (!this.#boneOverlay.destroyed) this.#boneOverlay.destroy(false);
    super.destroy(destroyChild);
  }

  #projectResult(frame: RuntimeFrameV1): RuntimeFrameV1 {
    this.#projectFrame(frame);
    return frame;
  }

  #projectFrame(frame: RuntimeFrameV1): void {
    if (this.#renderContextLost) return;
    this.#ensureCatalog();
    this.#boneFrameById.clear();
    for (let index = 0; index < frame.bones.length; index += 1) {
      const bone = frame.bones[index];
      if (bone !== undefined) this.#boneFrameById.set(bone.id, bone);
    }
    this.player.writeDrawOrderSlotIds(this.#drawOrderSlotIds);
    this.#attachmentIndexBySlotId.clear();
    for (let index = 0; index < frame.renderPacket.attachments.length; index += 1) {
      const attachment = frame.renderPacket.attachments[index];
      if (attachment !== undefined) this.#attachmentIndexBySlotId.set(attachment.slotId, index);
    }
    this.#prepareSlotObjects();
    this.#composeRenderOrder(frame);
    for (let index = 0; index < this.#boneMountList.length; index += 1) {
      const bone = this.#boneMountList[index];
      if (bone !== undefined) this.#updateBoneMount(bone);
    }
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record !== undefined) this.#updateSlotMount(record);
    }
    this.#aggregateStats(frame.sequence);
  }

  #prepareSlotObjects(): void {
    this.#beforeClipBySlotId.clear();
    this.#afterClipBySlotId.clear();
    if (this.#slotObjectList.length === 0) return;
    let activeClip: RuntimeClippingGeometryV1 | null = null;
    for (let index = 0; index < this.#drawOrderSlotIds.length; index += 1) {
      const slotId = this.#drawOrderSlotIds[index];
      if (slotId === undefined) continue;
      const attachmentId = this.player.querySlotAttachmentId(slotId);
      if (attachmentId === null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
      this.#beforeClipBySlotId.set(slotId, activeClip);
      if (attachmentId !== null && this.#clippingAttachmentIds.has(attachmentId)) {
        activeClip = this.player.queryClippingGeometry(attachmentId);
      }
      this.#afterClipBySlotId.set(slotId, activeClip);
      if (attachmentId !== null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
    }
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined) continue;
      record.attachmentId = this.player.querySlotAttachmentId(record.slotId);
      record.slotAlpha = this.player.querySlotAlpha(record.slotId);
      const attachmentVisible = record.visibleWhenAttachmentIds === null
        ? (!record.followAttachmentVisibility || record.attachmentId !== null)
        : record.attachmentId !== null && record.visibleWhenAttachmentIds.includes(record.attachmentId);
      record.active = this.#boneFrameById.has(record.boneId)
        && attachmentVisible
        && (!record.inheritSlotAlpha || record.slotAlpha > 0);
      record.clip = record.clipping === "inherit"
        ? (record.placement === "before"
          ? this.#beforeClipBySlotId.get(record.slotId)
          : this.#afterClipBySlotId.get(record.slotId)) ?? null
        : null;
      if (!record.active) record.mount.removeSelf();
    }
  }

  #composeRenderOrder(frame: RuntimeFrameV1): void {
    const packet = frame.renderPacket;
    let attachmentCursor = 0;
    let batchStart = 0;
    let batchFirst: RuntimeRenderAttachmentV1 | null = null;
    let segmentIndex = 0;
    let childIndex = 0;
    let naturalSplits = 0;
    let slotSplits = 0;

    for (let slotIndex = 0; slotIndex < this.#drawOrderSlotIds.length; slotIndex += 1) {
      const slotId = this.#drawOrderSlotIds[slotIndex];
      if (slotId === undefined) continue;
      const attachmentIndex = this.#attachmentIndexBySlotId.get(slotId);
      const hasAttachment = attachmentIndex !== undefined && attachmentIndex >= 0;
      if (hasAttachment && attachmentIndex !== attachmentCursor) {
        throw new RuntimeErrorV1(
          "validationFailed",
          "layaApply",
          "RenderPacket order differs from the published Slot draw order.",
          { entityId: slotId },
        );
      }
      const before = this.#slotBeforeById.get(slotId);
      if (hasActiveSlotObjectV1(before)) {
        if (attachmentCursor > batchStart) {
          this.#applySegment(packet, batchStart, attachmentCursor, segmentIndex, childIndex);
          segmentIndex += 1;
          childIndex += 1;
          batchStart = attachmentCursor;
          batchFirst = null;
          slotSplits += 1;
        }
        childIndex = this.#placeActiveSlotObjects(before, childIndex);
      }
      if (hasAttachment) {
        const attachment = packet.attachments[attachmentCursor];
        if (attachment === undefined) throw new Error("Missing Cane render attachment.");
        if (batchFirst !== null && !sameRenderStateV1(batchFirst, attachment)) {
          this.#applySegment(packet, batchStart, attachmentCursor, segmentIndex, childIndex);
          segmentIndex += 1;
          childIndex += 1;
          batchStart = attachmentCursor;
          naturalSplits += 1;
        }
        if (batchFirst === null || batchStart === attachmentCursor) batchFirst = attachment;
        attachmentCursor += 1;
      }
      const after = this.#slotAfterById.get(slotId);
      if (hasActiveSlotObjectV1(after)) {
        if (attachmentCursor > batchStart) {
          this.#applySegment(packet, batchStart, attachmentCursor, segmentIndex, childIndex);
          segmentIndex += 1;
          childIndex += 1;
          batchStart = attachmentCursor;
          batchFirst = null;
          slotSplits += 1;
        }
        childIndex = this.#placeActiveSlotObjects(after, childIndex);
      }
    }
    if (attachmentCursor !== packet.attachments.length) {
      throw new RuntimeErrorV1(
        "validationFailed",
        "layaApply",
        "RenderPacket references a Slot absent from draw order.",
      );
    }
    if (attachmentCursor > batchStart) {
      this.#applySegment(packet, batchStart, attachmentCursor, segmentIndex, childIndex);
      segmentIndex += 1;
      childIndex += 1;
    }
    for (let index = segmentIndex; index < this.#segments.length; index += 1) {
      const segment = this.#segments[index];
      if (segment === undefined) continue;
      segment.visible = false;
      segment.removeSelf();
    }
    if (this.#boneObjects.size > 0) this.#placeChildAt(this.#boneOverlay, childIndex);
    else this.#boneOverlay.removeSelf();
    this.#activeSegmentCount = segmentIndex;
    this.#stats.naturalBatchSplits = naturalSplits;
    this.#stats.slotObjectBatchSplits = slotSplits;
  }

  #applySegment(
    packet: RuntimeFrameV1["renderPacket"],
    start: number,
    end: number,
    segmentIndex: number,
    childIndex: number,
  ): void {
    let segment = this.#segments[segmentIndex];
    if (segment === undefined) {
      segment = new CaneLayaBatchView({
        textures: this.textures,
        materials: this.#materials,
        validationMode: this.#validationMode,
      });
      segment.name = `CaneBatchSegment:${segmentIndex}`;
      this.#segments[segmentIndex] = segment;
    }
    segment.applyRange(packet, start, end);
    this.#placeChildAt(segment, childIndex);
  }

  #placeActiveSlotObjects(records: readonly SlotObjectRecordV1[], childIndex: number): number {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined || !record.active) continue;
      this.#placeChildAt(record.mount, childIndex);
      childIndex += 1;
    }
    return childIndex;
  }

  #placeChildAt(child: Laya.Sprite, index: number): void {
    if (child.parent !== this) this.addChildAt(child, Math.min(index, this.numChildren));
    else if (this.getChildAt(index) !== child) this.setChildIndex(child, index);
  }

  #updateBoneMount(bone: BoneMountV1): void {
    const frame = this.#boneFrameById.get(bone.boneId);
    if (frame === undefined) { bone.mount.visible = false; return; }
    bone.mount.visible = true;
    applyCaneAffineToLayaSpriteV1(frame.matrix, bone.mount, bone.matrix);
  }

  #updateSlotMount(record: SlotObjectRecordV1): void {
    const frame = this.#boneFrameById.get(record.boneId);
    if (frame === undefined || !record.active) {
      record.mount.visible = false;
      record.mount.mask = null as unknown as Laya.Sprite;
      record.appliedClipId = null;
      return;
    }
    record.mount.visible = true;
    record.mount.alpha = record.inheritSlotAlpha ? record.slotAlpha : 1;
    applyCaneAffineToLayaSpriteV1(frame.matrix, record.mount, record.matrix);
    this.#applySlotMask(record);
  }

  #applySlotMask(record: SlotObjectRecordV1): void {
    const clip = record.clip;
    if (clip === null) {
      if (record.appliedClipId !== null) record.mount.mask = null as unknown as Laya.Sprite;
      record.appliedClipId = null;
      return;
    }
    record.mask.graphics.clear();
    let polygonCount = 0;
    for (let index = 0; index < clip.convexPolygonsXy.length; index += 1) {
      const source = clip.convexPolygonsXy[index];
      if (source === undefined || source.length < 6) continue;
      let target = record.polygonPool[polygonCount];
      if (target === undefined) {
        target = [];
        record.polygonPool[polygonCount] = target;
      }
      target.length = source.length;
      for (let offset = 0; offset < source.length; offset += 2) {
        target[offset] = source[offset] ?? 0;
        target[offset + 1] = -(source[offset + 1] ?? 0);
      }
      polygonCount += 1;
    }
    if (clip.inverse) drawInverseMaskV1(record.mask.graphics, record.polygonPool, polygonCount, record.pathPool);
    else {
      for (let index = 0; index < polygonCount; index += 1) {
        const points = record.polygonPool[index];
        if (points !== undefined) record.mask.graphics.drawPoly(0, 0, points, "#ffffff");
      }
    }
    record.inverseMatrix.setTo(
      record.matrix.a,
      record.matrix.b,
      record.matrix.c,
      record.matrix.d,
      record.matrix.tx,
      record.matrix.ty,
    ).invert();
    applyLayaMatrixToSpriteV1(record.inverseMatrix, record.mask);
    if (record.appliedClipId !== clip.attachmentId) record.mount.mask = record.mask;
    record.appliedClipId = clip.attachmentId;
  }

  #aggregateStats(frameSequence: number): void {
    const stats = this.#stats;
    stats.frameSequence = frameSequence;
    stats.activeAttachments = 0;
    stats.activeVertices = 0;
    stats.activeIndices = 0;
    stats.vertexUploadBytes = 0;
    stats.indexUploadBytes = 0;
    stats.bufferUploads = 0;
    stats.meshRebuilds = 0;
    stats.drawCalls = 0;
    stats.isolatedDrawCalls = 0;
    stats.batchSegments = this.#activeSegmentCount;
    stats.slotObjects = this.#slotObjects.size;
    stats.activeSlotObjects = 0;
    stats.maskedSlotObjects = 0;
    stats.clippingBatchSplits = 0;
    stats.clippingMaskVertexWrites = 0;
    stats.boneObjects = this.#boneObjects.size;
    if (!this.#measureCpuTime) {
      stats.coreCpuMilliseconds = null;
      stats.projectionCpuMilliseconds = null;
    }
    for (let index = 0; index < this.#activeSegmentCount; index += 1) {
      const segment = this.#segments[index];
      if (segment === undefined) continue;
      const segmentStats = segment.writeLastApplyStats(this.#segmentStatsScratch);
      stats.activeAttachments += segmentStats.attachments;
      stats.activeVertices += segmentStats.vertices;
      stats.activeIndices += segmentStats.indices;
      stats.vertexUploadBytes += segmentStats.vertexUploadBytes;
      stats.indexUploadBytes += segmentStats.indexUploadBytes;
      stats.bufferUploads += segmentStats.uploads;
      stats.meshRebuilds += segmentStats.meshRebuilds;
      stats.drawCalls += segmentStats.drawCalls;
      stats.isolatedDrawCalls += segmentStats.drawCalls;
    }
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || !record.active) continue;
      stats.activeSlotObjects += 1;
      if (record.clip !== null) {
        stats.maskedSlotObjects += 1;
        for (let polygonIndex = 0; polygonIndex < record.clip.convexPolygonsXy.length; polygonIndex += 1) {
          const polygon = record.clip.convexPolygonsXy[polygonIndex];
          if (polygon !== undefined) stats.clippingMaskVertexWrites += polygon.length / 2;
        }
      }
    }
    stats.clippingBatchSplits = stats.maskedSlotObjects;
  }

  #removeSlotRecord(record: SlotObjectRecordV1, reproject: boolean): void {
    this.#slotObjects.delete(record.object);
    const listIndex = this.#slotObjectList.indexOf(record);
    if (listIndex >= 0) this.#slotObjectList.splice(listIndex, 1);
    const list = this.#slotList(record.slotId, record.placement, false);
    if (list !== undefined) {
      const index = list.indexOf(record);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) {
        (record.placement === "before" ? this.#slotBeforeById : this.#slotAfterById).delete(record.slotId);
      }
    }
    record.mount.mask = null as unknown as Laya.Sprite;
    if (record.object.parent === record.mount) record.mount.removeChild(record.object, false);
    record.mount.removeSelf();
    record.mount.destroy(false);
    record.mask.destroy(true);
    if (reproject && !this.destroyed && !this.#destroying) this.#projectFrame(this.player.currentFrame);
  }

  #slotList(slotId: string, placement: CaneLayaSlotPlacementV1, create: true): SlotObjectRecordV1[];
  #slotList(slotId: string, placement: CaneLayaSlotPlacementV1, create: false): SlotObjectRecordV1[] | undefined;
  #slotList(
    slotId: string,
    placement: CaneLayaSlotPlacementV1,
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
    this.#slotBoneById.clear();
    this.#clippingAttachmentIds.clear();
    for (const slot of this.player.data.document.slots) this.#slotBoneById.set(slot.id, slot.boneId);
    for (const attachment of this.player.data.document.attachments) {
      if (attachment.type === "clipping") this.#clippingAttachmentIds.add(attachment.id);
    }
  }

  #assertForeignObject(object: Laya.Sprite, operation: string): void {
    if (!(object instanceof Laya.Sprite) || object === this || object === this.#boneOverlay) {
      throw new RuntimeErrorV1("invalidArgument", operation, "object must be a live foreign Laya.Sprite.");
    }
    if (object.destroyed) throw new RuntimeErrorV1("invalidState", operation, "object is destroyed.");
    let parent: Laya.Node | null | undefined = this;
    // LayaAir's Stage root may expose an undefined parent despite the public
    // declaration using null, so terminate on either nullish value.
    while (parent != null) {
      if (parent === object) {
        throw new RuntimeErrorV1("invalidArgument", operation, "Attaching an ancestor would create a cycle.");
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

function emptyRuntimeStatsV1(): MutableRuntimeStatsV1 {
  return {
    frameSequence: 0,
    activeAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexUploadBytes: 0,
    bufferUploads: 0,
    meshRebuilds: 0,
    drawCalls: 0,
    isolatedDrawCalls: 0,
    batchSegments: 0,
    naturalBatchSplits: 0,
    slotObjectBatchSplits: 0,
    clippingBatchSplits: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    clippingMaskVertexWrites: 0,
    boneObjects: 0,
    coreCpuMilliseconds: null,
    projectionCpuMilliseconds: null,
  };
}

function normalizeSlotOptionsV1(
  value: CaneLayaSlotPlacementV1 | CaneLayaSlotObjectOptionsV1,
): NormalizedSlotObjectOptionsV1 {
  const options = typeof value === "string" ? { placement: value } : value;
  const placement = options.placement ?? "after";
  const clipping = options.clipping ?? "inherit";
  if ((placement !== "before" && placement !== "after")
    || (clipping !== "inherit" && clipping !== "none")) {
    throw new RuntimeErrorV1("invalidArgument", "layaAddSlotObject", "Invalid placement or clipping option.");
  }
  return {
    placement,
    followAttachmentVisibility: options.followAttachmentVisibility ?? true,
    visibleWhenAttachment: options.visibleWhenAttachment,
    inheritSlotAlpha: options.inheritSlotAlpha ?? true,
    clipping,
  };
}

function resolveVisibleAttachmentsV1(
  player: RuntimePlayerV1,
  slotId: string,
  filter: string | readonly string[] | undefined,
): readonly string[] | null {
  if (filter === undefined) return null;
  const values = typeof filter === "string" ? [filter] : [...filter];
  const resolved: string[] = [];
  for (const value of values) {
    const attachment = player.data.document.attachments.find(
      (candidate) => candidate.slotId === slotId && (candidate.id === value || candidate.name === value),
    );
    if (attachment === undefined) {
      throw new RuntimeErrorV1("notFound", "layaAddSlotObject", `Unknown Slot attachment '${value}'.`, {
        entityId: value,
      });
    }
    if (!resolved.includes(attachment.id)) resolved.push(attachment.id);
  }
  return Object.freeze(resolved);
}

function hasActiveSlotObjectV1(records: readonly SlotObjectRecordV1[] | undefined): records is SlotObjectRecordV1[] {
  if (records === undefined) return false;
  for (let index = 0; index < records.length; index += 1) {
    if (records[index]?.active === true) return true;
  }
  return false;
}

function clippingEndsAtSlotV1(clip: RuntimeClippingGeometryV1 | null, slotId: string): boolean {
  return clip !== null && clip.endSlotId === slotId;
}

function sameRenderStateV1(
  left: RuntimeRenderAttachmentV1,
  right: RuntimeRenderAttachmentV1,
): boolean {
  if (left.blendMode !== right.blendMode || left.texture.kind !== right.texture.kind) return false;
  if (left.texture.kind === "direct" && right.texture.kind === "direct") {
    return left.texture.imageId === right.texture.imageId && left.texture.path === right.texture.path;
  }
  if (left.texture.kind === "atlas" && right.texture.kind === "atlas") {
    return left.texture.atlasId === right.texture.atlasId
      && left.texture.pageId === right.texture.pageId
      && left.texture.pagePath === right.texture.pagePath;
  }
  return false;
}

function drawInverseMaskV1(
  graphics: Laya.Graphics,
  polygons: readonly number[][],
  polygonCount: number,
  pathPool: any[][],
): void {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < polygonCount; index += 1) {
    const polygon = polygons[index];
    if (polygon === undefined) continue;
    for (let offset = 0; offset < polygon.length; offset += 2) {
      minX = Math.min(minX, polygon[offset] ?? 0);
      minY = Math.min(minY, polygon[offset + 1] ?? 0);
      maxX = Math.max(maxX, polygon[offset] ?? 0);
      maxY = Math.max(maxY, polygon[offset + 1] ?? 0);
    }
  }
  if (!Number.isFinite(minX)) return;
  const margin = Math.max(maxX - minX, maxY - minY, 1) * 4 + 1024;
  const paths = pathPool;
  let commandCount = 0;
  writePathCommandV1(paths, commandCount++, "moveTo", minX - margin, minY - margin);
  writePathCommandV1(paths, commandCount++, "lineTo", maxX + margin, minY - margin);
  writePathCommandV1(paths, commandCount++, "lineTo", maxX + margin, maxY + margin);
  writePathCommandV1(paths, commandCount++, "lineTo", minX - margin, maxY + margin);
  writePathCommandV1(paths, commandCount++, "closePath");
  for (let index = 0; index < polygonCount; index += 1) {
    const polygon = polygons[index];
    if (polygon === undefined || polygon.length < 6) continue;
    writePathCommandV1(paths, commandCount++, "moveTo", polygon[0] ?? 0, polygon[1] ?? 0);
    // Reverse winding creates a non-zero-fill hole in LayaAir's path mask.
    for (let offset = polygon.length - 2; offset >= 2; offset -= 2) {
      writePathCommandV1(
        paths,
        commandCount++,
        "lineTo",
        polygon[offset] ?? 0,
        polygon[offset + 1] ?? 0,
      );
    }
    writePathCommandV1(paths, commandCount++, "closePath");
  }
  paths.length = commandCount;
  graphics.drawPath(0, 0, paths, INVERSE_MASK_BRUSH_V1);
}

const INVERSE_MASK_BRUSH_V1 = Object.freeze({ fillStyle: "#ffffff" });

function writePathCommandV1(
  pool: any[][],
  index: number,
  command: string,
  x?: number,
  y?: number,
): void {
  let entry = pool[index];
  if (entry === undefined) {
    entry = [];
    pool[index] = entry;
  }
  entry[0] = command;
  if (x === undefined || y === undefined) {
    entry.length = 1;
  } else {
    entry[1] = x;
    entry[2] = y;
    entry.length = 3;
  }
}

function nowV1(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
