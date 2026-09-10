import {
  CaneRuntimeControllerV1,
  RuntimeBoundsV1,
  RuntimeErrorV1,
  RuntimePlayerV1,
  type AffineV1,
  type RootTransformV1,
  type RuntimeAfterConstraintsListenerV1,
  type RuntimeAttachmentV1,
  type RuntimeBeforeConstraintsListenerV1,
  type RuntimeBoneLocalAdditiveV1,
  type RuntimeBoneLocalPatchV1,
  type RuntimeBoneLocalV1,
  type RuntimeBoundsOptionsV1,
  type RuntimeBoundsHitV1,
  type RuntimeBoundsSnapshotV1,
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
  type RuntimePointV1,
  type RuntimeRadialWaveModifierV1,
  type RuntimeResourceChangesV1,
  type RuntimeResourceSnapshotV1,
  type RuntimeResourceTransactionV1,
  type RuntimeRootTransformOptionsV1,
  type RuntimeSamplingV1,
  type RuntimeSkinBuilderOptionsV1,
  type RuntimeSkinBuilderV1,
  type RuntimeSkinV1,
} from "@cane-runtime/core";
import type { CaneCocosAssetV1 } from "./assets.js";
import type { CocosTextureStore } from "./texture-store.js";
import {
  writeInverseTransformCanePointV1,
  writeTransformCanePointV1,
  type CaneCocosMutablePointV1,
} from "./coordinates.js";

const AUTHORED_SAMPLING_V1: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });
const ZERO_POINT_V1: RuntimePointV1 = Object.freeze({ x: 0, y: 0 });

export enum CaneCocosCacheModeV1 {
  REALTIME = 0,
  SHARED_CACHE = 1,
  PRIVATE_CACHE = 2,
}

export interface CaneCocosProjectionStatsV1 {
  readonly activeAttachments: number;
  readonly activeVertices: number;
  readonly activeIndices: number;
  readonly vertexUploadBytes: number;
  readonly indexUploadBytes: number;
  readonly bufferUploads: number;
  readonly bufferReallocations: number;
  readonly drawCalls: number;
  readonly isolatedDrawCalls: number;
  readonly batchSegments: number;
  readonly naturalBatchSplits: number;
  readonly slotObjectBatchSplits: number;
  readonly clippingBatchSplits: number;
  readonly boneObjects: number;
  readonly slotObjects: number;
  readonly activeSlotObjects: number;
  readonly maskedSlotObjects: number;
  readonly clippingMaskVertexWrites: number;
}

export interface CaneCocosProjectionV1 {
  apply(frame: RuntimeFrameV1, textures: CocosTextureStore): CaneCocosProjectionStatsV1;
  invalidate(reason: CaneCocosProjectionInvalidationV1): void;
  destroy(): void;
}

export type CaneCocosProjectionInvalidationV1 =
  | "frame"
  | "textures"
  | "color"
  | "transform"
  | "context";

export interface CaneCocosRuntimeOptionsV1 {
  readonly asset?: CaneCocosAssetV1;
  readonly player?: RuntimePlayerV1;
  readonly playerOptions?: RuntimePlayerOptionsV1;
  readonly controller?: CaneRuntimeControllerV1;
  readonly textures?: CocosTextureStore;
  readonly sampling?: RuntimeSamplingV1;
  readonly updateWhenInvisible?: boolean;
  readonly cacheMode?: CaneCocosCacheModeV1;
  readonly measureCpuTime?: boolean;
  readonly projection?: CaneCocosProjectionV1;
}

export interface CaneCocosRuntimeStatsV1 extends CaneCocosProjectionStatsV1 {
  readonly frameSequence: number;
  readonly coreCpuMilliseconds: number | null;
  readonly adapterCpuMilliseconds: number | null;
  readonly animationSamples: number;
  readonly constraintGeometrySolves: number;
  readonly framesPublished: number;
  readonly cacheMode: CaneCocosCacheModeV1;
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

type MutableRuntimeStatsV1 = {
  -readonly [Field in keyof Omit<
    CaneCocosRuntimeStatsV1,
    "animationSamples" | "constraintGeometrySolves" | "framesPublished"
  >]: CaneCocosRuntimeStatsV1[Field]
};

/**
 * Renderer-neutral Cocos host facade over exactly one authoritative Core player.
 * Engine components delegate here; this class never computes animation, constraints or vertices.
 */
export class CaneCocosRuntime {
  readonly player: RuntimePlayerV1;
  readonly controller: CaneRuntimeControllerV1;
  readonly textures: CocosTextureStore;
  readonly retainedBounds = new RuntimeBoundsV1();

  readonly #sampling: RuntimeSamplingV1;
  readonly #measureCpuTime: boolean;
  readonly #ownedUnsubscribers = new Set<() => void>();
  readonly #pointScratch = { x: 0, y: 0 };
  readonly #stats: MutableRuntimeStatsV1 = emptyRuntimeStatsV1();
  #projection: CaneCocosProjectionV1 | null;
  #projectionDirty = true;
  #destroyed = false;
  #paused = false;
  #timeScale = 1;
  #updateWhenInvisible: boolean;
  #visibleInHierarchy = true;
  #cacheMode: CaneCocosCacheModeV1;
  #lastAnimationSamples = 0;
  #lastConstraintGeometrySolves = 0;
  #lastFramesPublished = 0;

  constructor(options: CaneCocosRuntimeOptionsV1) {
    if (options === null || typeof options !== "object") {
      throw new RuntimeErrorV1("invalidArgument", "cocosCreateRuntime", "options must be an object.");
    }
    const player = options.player ?? (options.asset === undefined
      ? null
      : new RuntimePlayerV1(options.asset.data, options.playerOptions));
    if (player === null) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosCreateRuntime",
        "Provide a RuntimePlayerV1 or CaneCocosAssetV1.",
        { field: "player" },
      );
    }
    if (options.controller !== undefined && options.controller.player !== player) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosCreateRuntime",
        "controller and player must refer to the same RuntimePlayerV1.",
        { field: "controller" },
      );
    }
    const textures = options.textures ?? options.asset?.textures;
    if (textures === undefined || textures.destroyed) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosCreateRuntime",
        "Provide a live CocosTextureStore or CaneCocosAssetV1.",
        { field: "textures" },
      );
    }
    this.player = player;
    this.controller = options.controller ?? new CaneRuntimeControllerV1(player);
    this.textures = textures;
    this.#sampling = options.sampling ?? AUTHORED_SAMPLING_V1;
    this.#measureCpuTime = options.measureCpuTime ?? false;
    this.#updateWhenInvisible = options.updateWhenInvisible ?? false;
    this.#cacheMode = options.cacheMode ?? CaneCocosCacheModeV1.REALTIME;
    this.#projection = options.projection ?? null;
    this.#captureEvaluationStats();
    this.#stats.frameSequence = player.currentFrame.sequence;
    this.#writeFrameShapeStats(player.currentFrame);
    this.#ownSubscription(textures.onTexturesChanged((change) => {
      if (change === "contextLost") return;
      this.invalidateProjection(change === "contextRestored" ? "context" : "textures");
    }));
  }

  get destroyed(): boolean { return this.#destroyed; }
  get paused(): boolean { return this.#paused; }
  set paused(value: boolean) { this.#assertLive(); this.#paused = Boolean(value); }
  pause(): this { this.paused = true; return this; }
  resume(): this { this.paused = false; return this; }

  get timeScale(): number { return this.#timeScale; }
  set timeScale(value: number) {
    this.#assertLive();
    if (!Number.isFinite(value) || value < 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosSetTimeScale",
        "timeScale must be finite and non-negative.",
        { field: "timeScale" },
      );
    }
    this.#timeScale = value;
  }

  get updateWhenInvisible(): boolean { return this.#updateWhenInvisible; }
  set updateWhenInvisible(value: boolean) { this.#assertLive(); this.#updateWhenInvisible = Boolean(value); }
  get visibleInHierarchy(): boolean { return this.#visibleInHierarchy; }
  set visibleInHierarchy(value: boolean) { this.#visibleInHierarchy = Boolean(value); }

  get cacheMode(): CaneCocosCacheModeV1 { return this.#cacheMode; }
  set cacheMode(value: CaneCocosCacheModeV1) {
    this.#assertLive();
    if (value !== CaneCocosCacheModeV1.REALTIME
      && value !== CaneCocosCacheModeV1.SHARED_CACHE
      && value !== CaneCocosCacheModeV1.PRIVATE_CACHE) {
      throw new RuntimeErrorV1("invalidArgument", "cocosSetCacheMode", "Unknown Cocos cache mode.", {
        field: "cacheMode",
      });
    }
    if (value === this.#cacheMode) return;
    this.#cacheMode = value;
    this.#stats.cacheMode = value;
    this.invalidateProjection("frame");
  }

  get lastApplyStats(): CaneCocosRuntimeStatsV1 {
    return {
      ...this.#stats,
      animationSamples: this.#lastAnimationSamples,
      constraintGeometrySolves: this.#lastConstraintGeometrySolves,
      framesPublished: this.#lastFramesPublished,
    };
  }

  setProjection(projection: CaneCocosProjectionV1 | null): this {
    this.#assertLive();
    if (projection === this.#projection) return this;
    this.#projection?.destroy();
    this.#projection = projection;
    this.invalidateProjection("frame");
    return this;
  }

  update(deltaSeconds: number): RuntimeFrameV1 {
    this.#assertLive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosUpdate",
        "deltaSeconds must be finite and non-negative.",
        { field: "deltaSeconds" },
      );
    }
    if (this.#paused) {
      this.#clearEvaluationStats();
      return this.player.currentFrame;
    }
    const started = this.#measureCpuTime ? nowV1() : 0;
    const frame = this.controller.advance(deltaSeconds * this.#timeScale, this.#sampling);
    this.#stats.coreCpuMilliseconds = this.#measureCpuTime ? nowV1() - started : null;
    return this.#acceptPublishedFrame(frame);
  }

  applyPose(): RuntimeFrameV1 {
    this.#assertLive();
    const started = this.#measureCpuTime ? nowV1() : 0;
    const frame = this.controller.apply(this.#sampling);
    this.#stats.coreCpuMilliseconds = this.#measureCpuTime ? nowV1() - started : null;
    return this.#acceptPublishedFrame(frame);
  }

  /** Reprojects the existing frame and performs no Core evaluation. */
  applyCurrentFrame(): RuntimeFrameV1 {
    this.#assertLive();
    // Cached modes retain the exact projection of the already-published Core
    // frame. They never cache or bypass Core evaluation. REALTIME preserves
    // the explicit force-reproject behavior used by low-level hosts.
    if (this.#cacheMode === CaneCocosCacheModeV1.REALTIME) {
      this.invalidateProjection("frame");
    }
    this.prepareRenderData();
    return this.player.currentFrame;
  }

  prepareRenderData(): void {
    this.#assertLive();
    if (this.#projection === null) return;
    if (!this.#projectionDirty) {
      if (this.#cacheMode !== CaneCocosCacheModeV1.REALTIME) this.#stats.cacheHits += 1;
      return;
    }
    if (this.#cacheMode !== CaneCocosCacheModeV1.REALTIME) this.#stats.cacheMisses += 1;
    const frame = this.player.currentFrame;
    const started = this.#measureCpuTime ? nowV1() : 0;
    const projectionStats = this.#projection.apply(frame, this.textures);
    this.#stats.adapterCpuMilliseconds = this.#measureCpuTime ? nowV1() - started : null;
    copyProjectionStatsV1(this.#stats, projectionStats);
    this.#stats.frameSequence = frame.sequence;
    this.#projectionDirty = false;
  }

  invalidateProjection(reason: CaneCocosProjectionInvalidationV1): void {
    if (this.#destroyed) return;
    this.#projectionDirty = true;
    this.#projection?.invalidate(reason);
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
    return this.#acceptPublishedFrame(this.controller.setBoneLocalPersistent(idOrName, local));
  }
  clearBoneLocalPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearBoneLocalPersistent(idOrName));
  }

  setConstraintTarget(idOrName: string, x: number, y: number): this {
    this.controller.setConstraintTarget(idOrName, x, y); return this;
  }
  setConstraintMix(idOrName: string, mix: number): this {
    this.controller.setConstraintMix(idOrName, mix); return this;
  }
  setConstraintPersistent(idOrName: string, parameters: RuntimeConstraintOverrideV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setConstraintPersistent(idOrName, parameters));
  }
  clearConstraintPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearConstraintPersistent(idOrName));
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
    return this.#acceptPublishedFrame(
      this.controller.setAnimation(trackIndex, animationIdOrName, looping, mixSeconds),
    );
  }
  addAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    delaySeconds = 0,
  ): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(
      this.controller.addAnimation(trackIndex, animationIdOrName, looping, delaySeconds),
    );
  }
  clearTrack(trackIndex: number): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearTrack(trackIndex));
  }
  clearTracks(): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearTracks());
  }
  setMix(fromAnimationIdOrName: string, toAnimationIdOrName: string, durationSeconds: number): this {
    this.#assertLive();
    this.player.setMix({
      fromAnimationId: resolveAnimationIdV1(this.player, fromAnimationIdOrName),
      toAnimationId: resolveAnimationIdV1(this.player, toAnimationIdOrName),
      durationSeconds,
    });
    return this;
  }
  setSkin(idOrName: string | null): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setSkin(idOrName));
  }
  setAttachment(slotIdOrName: string, attachmentIdOrName: string | null): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setAttachment(slotIdOrName, attachmentIdOrName));
  }
  clearAttachment(slotIdOrName: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearAttachment(slotIdOrName));
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
    return this.#acceptPublishedFrame(this.controller.applyRuntimeResources(changes));
  }
  installRuntimeSkin(skin: RuntimeSkinV1 | RuntimeSkinBuilderV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.installRuntimeSkin(skin));
  }
  removeRuntimeSkin(skinId: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.removeRuntimeSkin(skinId));
  }
  installRuntimeAttachment(attachment: RuntimeAttachmentV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.installRuntimeAttachment(attachment));
  }
  removeRuntimeAttachment(attachmentId: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.removeRuntimeAttachment(attachmentId));
  }
  installRuntimeImage(image: RuntimeImageV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.installRuntimeImage(image));
  }
  removeRuntimeImage(imageId: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.removeRuntimeImage(imageId));
  }
  installRuntimeAtlas(atlas: RuntimeOverlayAtlasV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.installRuntimeAtlas(atlas));
  }
  removeRuntimeAtlas(atlasId: string): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.removeRuntimeAtlas(atlasId));
  }
  clearRuntimeResources(): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearRuntimeResources());
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
    return this.#acceptPublishedFrame(this.controller.setPersistentGeometryModifiers(modifiers));
  }
  clearPersistentGeometryModifiers(): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.clearPersistentGeometryModifiers());
  }

  setRootTransform(root: RootTransformV1, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setRootTransform(root, options));
  }
  setRootPosition(x: number, y: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setRootPosition(x, y, options));
  }
  setRootRotation(rotationDegrees: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.setRootRotation(rotationDegrees, options));
  }
  teleportRoot(
    root: RootTransformV1,
    physicsMode: Exclude<RuntimePhysicsHostMotionModeV1, "move"> = "teleport",
    constraintId?: string,
  ): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.controller.teleportRoot(root, physicsMode, constraintId));
  }
  setPhysicsEnvironment(environment: RuntimePhysicsEnvironmentV1): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.player.setPhysicsEnvironment(environment));
  }
  resetPhysics(): RuntimeFrameV1 {
    return this.#acceptPublishedFrame(this.player.resetPhysics());
  }
  resetPhysicsConstraint(constraintIdOrName: string): boolean {
    const id = this.controller.queryConstraint(constraintIdOrName).id;
    const result = this.player.resetPhysicsConstraint(id);
    this.#acceptPublishedFrame(this.player.currentFrame);
    return result;
  }

  queryBounds(options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsSnapshotV1 {
    return this.controller.queryBounds(options);
  }
  writeBounds(options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsV1 {
    return this.controller.writeBounds(this.retainedBounds, options);
  }

  containsPoint(x: number, y: number, options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsHitV1 | null {
    this.writeBounds(options);
    return this.retainedBounds.containsPoint(x, y);
  }

  writePointHits(
    x: number,
    y: number,
    output: RuntimeBoundsHitV1[],
    options: RuntimeBoundsOptionsV1 = {},
  ): number {
    this.writeBounds(options);
    return this.retainedBounds.writePointHits(x, y, output);
  }

  intersectsSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: RuntimeBoundsOptionsV1 = {},
  ): RuntimeBoundsHitV1 | null {
    this.writeBounds(options);
    return this.retainedBounds.intersectsSegment(x1, y1, x2, y2);
  }

  writeSegmentHits(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    output: RuntimeBoundsHitV1[],
    options: RuntimeBoundsOptionsV1 = {},
  ): number {
    this.writeBounds(options);
    return this.retainedBounds.writeSegmentHits(x1, y1, x2, y2, output);
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

  getBonePosition<T extends CaneCocosMutablePointV1>(
    idOrName: string,
    output: T,
  ): T {
    const matrix = this.controller.queryBone(idOrName).world.matrix;
    output.x = matrix.tx;
    output.y = matrix.ty;
    return output;
  }

  getBoneMatrix(idOrName: string): AffineV1 {
    return this.controller.queryBone(idOrName).world.matrix;
  }

  boneToLocal<T extends CaneCocosMutablePointV1>(
    idOrName: string,
    point: RuntimePointV1 = ZERO_POINT_V1,
    output: T,
  ): T {
    return writeTransformCanePointV1(this.controller.queryBone(idOrName).world.matrix, point, output);
  }

  /** Core-world alias used by renderer-neutral and Cocos migration code. */
  boneToWorld<T extends CaneCocosMutablePointV1>(
    idOrName: string,
    point: RuntimePointV1 = ZERO_POINT_V1,
    output: T,
  ): T {
    return this.boneToLocal(idOrName, point, output);
  }

  localToBone<T extends CaneCocosMutablePointV1>(
    idOrName: string,
    point: RuntimePointV1,
    output: T,
  ): T {
    return writeInverseTransformCanePointV1(this.controller.queryBone(idOrName).world.matrix, point, output);
  }

  /** Inverse of boneToWorld in the Core character coordinate space. */
  worldToBone<T extends CaneCocosMutablePointV1>(
    idOrName: string,
    point: RuntimePointV1,
    output: T,
  ): T {
    return this.localToBone(idOrName, point, output);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const unsubscribe of this.#ownedUnsubscribers) unsubscribe();
    this.#ownedUnsubscribers.clear();
    this.#projection?.destroy();
    this.#projection = null;
  }

  #acceptPublishedFrame(frame: RuntimeFrameV1): RuntimeFrameV1 {
    this.#captureEvaluationStats();
    this.#stats.frameSequence = frame.sequence;
    this.#writeFrameShapeStats(frame);
    this.invalidateProjection("frame");
    return frame;
  }

  #captureEvaluationStats(): void {
    const evaluation = this.player.lastEvaluationStats;
    this.#lastAnimationSamples = evaluation.animationSamples;
    this.#lastConstraintGeometrySolves = evaluation.constraintGeometrySolves;
    this.#lastFramesPublished = evaluation.framesPublished;
  }

  #clearEvaluationStats(): void {
    this.#lastAnimationSamples = 0;
    this.#lastConstraintGeometrySolves = 0;
    this.#lastFramesPublished = 0;
  }

  #writeFrameShapeStats(frame: RuntimeFrameV1): void {
    let vertices = 0;
    let indices = 0;
    for (let index = 0; index < frame.renderPacket.attachments.length; index += 1) {
      const attachment = frame.renderPacket.attachments[index];
      if (attachment === undefined) continue;
      vertices += attachment.worldVerticesXy.length / 2;
      indices += attachment.indices.length;
    }
    this.#stats.activeAttachments = frame.renderPacket.attachments.length;
    this.#stats.activeVertices = vertices;
    this.#stats.activeIndices = indices;
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

  #assertLive(): void {
    if (this.#destroyed) {
      throw new RuntimeErrorV1("invalidState", "cocosRuntime", "Runtime has been destroyed.");
    }
  }
}

function emptyRuntimeStatsV1(): MutableRuntimeStatsV1 {
  return {
    frameSequence: -1,
    activeAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexUploadBytes: 0,
    bufferUploads: 0,
    bufferReallocations: 0,
    drawCalls: 0,
    isolatedDrawCalls: 0,
    batchSegments: 0,
    naturalBatchSplits: 0,
    slotObjectBatchSplits: 0,
    clippingBatchSplits: 0,
    boneObjects: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    clippingMaskVertexWrites: 0,
    coreCpuMilliseconds: null,
    adapterCpuMilliseconds: null,
    cacheMode: CaneCocosCacheModeV1.REALTIME,
    cacheHits: 0,
    cacheMisses: 0,
  };
}

function copyProjectionStatsV1(
  output: MutableRuntimeStatsV1,
  input: CaneCocosProjectionStatsV1,
): void {
  output.activeAttachments = input.activeAttachments;
  output.activeVertices = input.activeVertices;
  output.activeIndices = input.activeIndices;
  output.vertexUploadBytes = input.vertexUploadBytes;
  output.indexUploadBytes = input.indexUploadBytes;
  output.bufferUploads = input.bufferUploads;
  output.bufferReallocations = input.bufferReallocations;
  output.drawCalls = input.drawCalls;
  output.isolatedDrawCalls = input.isolatedDrawCalls;
  output.batchSegments = input.batchSegments;
  output.naturalBatchSplits = input.naturalBatchSplits;
  output.slotObjectBatchSplits = input.slotObjectBatchSplits;
  output.clippingBatchSplits = input.clippingBatchSplits;
  output.boneObjects = input.boneObjects;
  output.slotObjects = input.slotObjects;
  output.activeSlotObjects = input.activeSlotObjects;
  output.maskedSlotObjects = input.maskedSlotObjects;
  output.clippingMaskVertexWrites = input.clippingMaskVertexWrites;
}

function resolveAnimationIdV1(player: RuntimePlayerV1, idOrName: string): string {
  for (const animation of player.data.document.animations) {
    if (animation.id === idOrName || animation.name === idOrName) return animation.id;
  }
  throw new RuntimeErrorV1("notFound", "cocosSetMix", "Animation was not found.", {
    field: "animationIdOrName",
    entityId: idOrName,
  });
}

function nowV1(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

void (null as RuntimePointV1 | null);
