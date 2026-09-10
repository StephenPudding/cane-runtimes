import {
  EffectAsset,
  Material,
  Node,
  UI,
  UIRenderer,
  UITransform,
  Vec2,
  _decorator,
  game,
  type IAssembler,
} from "cc";
import type {
  RuntimeAfterConstraintsListenerV1,
  AffineV1,
  RootTransformV1,
  RuntimeAttachmentV1,
  RuntimeBeforeConstraintsListenerV1,
  RuntimeBoneLocalAdditiveV1,
  RuntimeBoneLocalPatchV1,
  RuntimeBoneLocalV1,
  RuntimeConstraintOverrideV1,
  RuntimeBoundsHitV1,
  RuntimeBoundsOptionsV1,
  RuntimeBoundsSnapshotV1,
  RuntimeCustomGeometryModifierV1,
  RuntimeDeterministicJitterModifierV1,
  RuntimeEventListenerV1,
  RuntimeFrameV1,
  RuntimeLifecycleEventKindV1,
  RuntimeGeometryModifiersV1,
  RuntimeImageV1,
  RuntimeOverlayAtlasV1,
  RuntimePhysicsEnvironmentV1,
  RuntimePhysicsHostMotionModeV1,
  RuntimePointV1,
  RuntimeRadialWaveModifierV1,
  RuntimeResourceChangesV1,
  RuntimeResourceSnapshotV1,
  RuntimeResourceTransactionV1,
  RuntimeRootTransformOptionsV1,
  RuntimeSkinBuilderOptionsV1,
  RuntimeSkinBuilderV1,
  RuntimeSkinV1,
} from "@cane-runtime/core";
import {
  CaneCocosAssetV1,
  CaneSkeletonDataAsset,
  loadCaneCocosAssetV1,
  type CaneCocosAssetLoadOptionsV1,
} from "./assets.js";
import { assertCaneCocosRendererReadyV1, observeCaneCocosDeviceLossV1 } from "./engine.js";
import { CaneCocosErrorV1 } from "./errors.js";
import {
  CaneCocosFollowerManagerV1,
  type CaneCocosSlotObjectOptionsV1,
  type CaneCocosSlotObjectStateV1,
  type CaneCocosSlotPlacementV1,
} from "./followers.js";
import type { CaneCocosColorModulationV1 } from "./geometry.js";
import { writeCocosMat4ToCaneAffineV1, writeInverseTransformCanePointV1, writeTransformCanePointV1 } from "./coordinates.js";
import { CaneCocosRendererV1 } from "./renderer.js";
import {
  createCaneCrossedRenderEntityV1,
  setCaneCrossedWebTraversalV1,
} from "./internal-bridge.js";
import { CaneCocosCacheModeV1, CaneCocosRuntime } from "./runtime.js";
import { CaneSkeletonSystem } from "./skeleton-system.js";

const { ccclass, property, requireComponent } = _decorator;
const ZERO_POINT_V1: RuntimePointV1 = Object.freeze({ x: 0, y: 0 });

interface CocosUiPropertiesV1 {
  readonly opacity: number;
}

/** Formal Cocos Creator 3.8.8 UIRenderer component for a Cane character. */
@ccclass("cane.CaneSkeleton")
@requireComponent(UITransform)
export class CaneSkeleton extends UIRenderer {
  @property({ type: CaneSkeletonDataAsset })
  get skeletonData(): CaneSkeletonDataAsset | null { return this.#skeletonData; }
  set skeletonData(value: CaneSkeletonDataAsset | null) {
    if (value === this.#skeletonData) return;
    this.#skeletonData = value;
    if (this.isValid) void this.initialize().catch((error: unknown) => this.#reportError(error));
  }

  /** Creator-compiled Cane color effect. Required for Native builds. */
  @property({ type: EffectAsset })
  colorEffectAsset: EffectAsset | null = null;

  @property
  defaultAnimation = "";

  @property
  loop = true;

  @property
  autoUpdate = true;

  @property
  updateWhenInvisible = false;

  /** Uses Core's reusable-frame execution mode for the renderer hot path. */
  @property
  performanceMode = true;

  @property
  get enableBatch(): boolean { return this.#enableBatch; }
  set enableBatch(value: boolean) {
    const normalized = Boolean(value);
    if (normalized === this.#enableBatch) return;
    this.#enableBatch = normalized;
    this.#renderer?.setEnableBatch(normalized);
    this.markForUpdateRenderData();
  }

  @property
  get timeScale(): number { return this.#timeScale; }
  set timeScale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new CaneCocosErrorV1("invalidArgument", "timeScale must be finite and non-negative.", {
        operation: "cocosSetTimeScale",
        field: "timeScale",
        actual: value,
      });
    }
    this.#timeScale = value;
    if (this.#runtime !== null) this.#runtime.timeScale = value;
  }

  @property
  get cacheMode(): CaneCocosCacheModeV1 { return this.#cacheMode; }
  set cacheMode(value: CaneCocosCacheModeV1) {
    this.#cacheMode = value;
    if (this.#runtime !== null) this.#runtime.cacheMode = value;
  }

  #skeletonData: CaneSkeletonDataAsset | null = null;
  #runtime: CaneCocosRuntime | null = null;
  #renderer: CaneCocosRendererV1 | null = null;
  #asset: CaneCocosAssetV1 | null = null;
  #followers: CaneCocosFollowerManagerV1 | null = null;
  #initialization: Promise<CaneCocosRuntime> | null = null;
  #generation = 0;
  #enableBatch = false;
  #timeScale = 1;
  #cacheMode = CaneCocosCacheModeV1.REALTIME;
  #lastError: unknown = null;
  #unsubscribeDeviceLoss: (() => void) | null = null;
  readonly #pointScratch = new Vec2();
  readonly #pointScratch2 = new Vec2();
  readonly #affineScratch: { -readonly [Field in keyof AffineV1]: AffineV1[Field] } = {
    a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0,
  };

  get runtime(): CaneCocosRuntime | null { return this.#runtime; }
  get runtimePlayer() { return this.#runtime?.player ?? null; }
  get ready(): boolean { return this.#runtime !== null; }
  get lastError(): unknown { return this.#lastError; }

  override onLoad(): void {
    super.onLoad();
    this._useVertexOpacity = true;
    this.#flushCaneAssembler();
    if (this.#skeletonData !== null) {
      void this.initialize().catch((error: unknown) => this.#reportError(error));
    }
  }

  override onEnable(): void {
    super.onEnable();
    setCaneCrossedWebTraversalV1(this.node, true);
    this.#flushCaneAssembler();
    CaneSkeletonSystem.getInstance().add(this);
    if (this.#runtime === null && this.#skeletonData !== null) {
      void this.initialize().catch((error: unknown) => this.#reportError(error));
    }
  }

  override onDisable(): void {
    CaneSkeletonSystem.getInstance().remove(this);
    setCaneCrossedWebTraversalV1(this.node, false);
    super.onDisable();
  }

  override onDestroy(): void {
    CaneSkeletonSystem.getInstance().remove(this);
    setCaneCrossedWebTraversalV1(this.node, false);
    this.#generation += 1;
    this.#releaseRuntime();
    super.onDestroy();
  }

  async initialize(): Promise<CaneCocosRuntime> {
    const source = this.#skeletonData;
    if (source === null) {
      this.#generation += 1;
      this.#releaseRuntime();
      throw new CaneCocosErrorV1("missingResource", "CaneSkeleton.skeletonData is not assigned.", {
        operation: "cocosInitializeSkeleton",
        field: "skeletonData",
        entityId: this.node.uuid,
      });
    }
    if (this.#runtime !== null && this.#asset !== null && !this.#asset.destroyed) return this.#runtime;
    if (this.#initialization !== null) return this.#initialization;
    assertCaneCocosRendererReadyV1("cocosInitializeSkeleton");
    const generation = ++this.#generation;
    const promise = this.#initializeGeneration(source, generation);
    this.#initialization = promise;
    try { return await promise; }
    finally {
      if (this.#initialization === promise) this.#initialization = null;
    }
  }

  /**
   * Loads a URL/Cocos Bundle resource graph and transfers the resulting asset
   * lease to this component. This is the programmatic counterpart to assigning
   * a serialized CaneSkeletonDataAsset in Creator.
   */
  async load(
    sourceUrl: string,
    options: CaneCocosAssetLoadOptionsV1 = {},
  ): Promise<CaneCocosRuntime> {
    if (this.#initialization !== null) await this.#initialization.catch(() => undefined);
    assertCaneCocosRendererReadyV1("cocosLoadSkeleton");
    const generation = ++this.#generation;
    this.#skeletonData = null;
    this.#releaseRuntime();
    const promise = (async (): Promise<CaneCocosRuntime> => {
      const asset = await loadCaneCocosAssetV1(sourceUrl, {
        ...options,
        ...(options.contextTarget === undefined && game.canvas !== null
          ? { contextTarget: game.canvas }
          : {}),
      });
      return this.#installAssetGeneration(asset, generation, "cocosLoadSkeleton");
    })();
    this.#initialization = promise;
    try { return await promise; }
    finally {
      if (this.#initialization === promise) this.#initialization = null;
    }
  }

  /**
   * Transfers ownership of an already loaded Cane asset to this component.
   * The asset is released if installation fails or when the component is
   * reinitialized/destroyed.
   */
  async initializeWithAsset(asset: CaneCocosAssetV1): Promise<CaneCocosRuntime> {
    if (!(asset instanceof CaneCocosAssetV1) || asset.destroyed) {
      throw new CaneCocosErrorV1("invalidArgument", "A live CaneCocosAssetV1 is required.", {
        operation: "cocosInitializeSkeletonAsset",
        field: "asset",
        entityId: this.node.uuid,
      });
    }
    if (this.#initialization !== null) await this.#initialization.catch(() => undefined);
    assertCaneCocosRendererReadyV1("cocosInitializeSkeletonAsset");
    const generation = ++this.#generation;
    this.#skeletonData = null;
    this.#releaseRuntime();
    const promise = this.#installAssetGeneration(asset, generation, "cocosInitializeSkeletonAsset");
    this.#initialization = promise;
    try { return await promise; }
    finally {
      if (this.#initialization === promise) this.#initialization = null;
    }
  }

  async #initializeGeneration(
    source: CaneSkeletonDataAsset,
    generation: number,
  ): Promise<CaneCocosRuntime> {
    this.#releaseRuntime();
    const asset = await source.instantiate({
      ...(game.canvas === null ? {} : { contextTarget: game.canvas }),
    });
    if (source !== this.#skeletonData) {
      await asset.destroy();
      throw new CaneCocosErrorV1("invalidState", "CaneSkeleton initialization was superseded.", {
        operation: "cocosInitializeSkeleton",
        field: "generation",
        entityId: this.node.uuid,
      });
    }
    return this.#installAssetGeneration(asset, generation, "cocosInitializeSkeleton");
  }

  async #installAssetGeneration(
    asset: CaneCocosAssetV1,
    generation: number,
    operation: string,
  ): Promise<CaneCocosRuntime> {
    if (!this.isValid || generation !== this.#generation || asset.destroyed) {
      await asset.destroy().catch(() => undefined);
      throw new CaneCocosErrorV1("invalidState", "CaneSkeleton initialization was superseded.", {
        operation,
        field: "generation",
        entityId: this.node.uuid,
      });
    }
    let renderer: CaneCocosRendererV1 | null = null;
    let runtime: CaneCocosRuntime | null = null;
    let followers: CaneCocosFollowerManagerV1 | null = null;
    let unsubscribeDeviceLoss: (() => void) | null = null;
    try {
      renderer = new CaneCocosRendererV1(this, {
        ...(this.colorEffectAsset === null ? {} : { colorEffectAsset: this.colorEffectAsset }),
      });
      runtime = new CaneCocosRuntime({
        asset,
        playerOptions: { executionMode: this.performanceMode ? "performance" : "strict" },
        projection: renderer,
        cacheMode: this.#cacheMode,
        updateWhenInvisible: this.updateWhenInvisible,
      });
      runtime.timeScale = this.#timeScale;
      runtime.visibleInHierarchy = this.node.activeInHierarchy;
      if (this.defaultAnimation.length > 0) {
        runtime.setAnimation(0, this.defaultAnimation, this.loop);
      } else {
        runtime.applyCurrentFrame();
      }
      followers = new CaneCocosFollowerManagerV1(
        this.node,
        runtime,
        () => runtime?.invalidateProjection("frame"),
      );
      renderer.setSceneNodeSource(followers);
      followers.apply(runtime.player.currentFrame);
      runtime.prepareRenderData();
      const installedRuntime: CaneCocosRuntime = runtime;
      unsubscribeDeviceLoss = observeCaneCocosDeviceLossV1((error) => {
        if (this.#runtime !== installedRuntime || installedRuntime.destroyed) return;
        installedRuntime.textures.handleContextLost();
        installedRuntime.invalidateProjection("context");
        installedRuntime.pause();
        this.#reportError(error);
      });
      this.#asset = asset;
      this.#renderer = renderer;
      this.#runtime = runtime;
      this.#followers = followers;
      this.#unsubscribeDeviceLoss = unsubscribeDeviceLoss;
      this.#flushCaneAssembler();
      this.#lastError = null;
      this.node.emit(CaneSkeleton.EventType.READY, this);
      return runtime;
    } catch (error) {
      unsubscribeDeviceLoss?.();
      followers?.destroy();
      if (runtime !== null) runtime.destroy();
      else renderer?.destroy();
      await asset.destroy().catch(() => undefined);
      throw error;
    }
  }

  /** Automatic update entry used by CaneSkeletonSystem. */
  updateAnimation(deltaSeconds: number): void {
    const runtime = this.#runtime;
    if (runtime === null) return;
    runtime.visibleInHierarchy = this.node.activeInHierarchy;
    runtime.updateWhenInvisible = this.updateWhenInvisible;
    if (!this.autoUpdate) return;
    if (!runtime.updateWhenInvisible && !runtime.visibleInHierarchy) return;
    runtime.update(deltaSeconds);
  }

  /** Host-controlled update; available even when autoUpdate is disabled. */
  manualUpdate(deltaSeconds: number): RuntimeFrameV1 {
    const runtime = this.#requireRuntime("cocosManualUpdate");
    return runtime.update(deltaSeconds);
  }

  /** Reprojects the current Core frame without sampling animation or solving again. */
  applyCurrentFrame(): RuntimeFrameV1 {
    return this.#requireRuntime("cocosApplyCurrentFrame").applyCurrentFrame();
  }

  prepareCaneRenderData(): void {
    const runtime = this.#runtime;
    const renderer = this.#renderer;
    if (runtime === null || renderer === null) return;
    this.#followers?.apply(runtime.player.currentFrame);
    if (renderer.hostTransformChanged()) runtime.invalidateProjection("transform");
    runtime.prepareRenderData();
    renderer.refreshSceneObjects();
  }

  createCaneRenderData() {
    const renderer = this.#renderer;
    if (renderer === null) {
      throw new CaneCocosErrorV1("invalidState", "CaneSkeleton renderer is not initialized.", {
        operation: "cocosCreateRenderData",
        field: "renderer",
        entityId: this.node.uuid,
      });
    }
    return renderer.createRenderData();
  }

  writeColorModulation(output: CaneCocosColorModulationV1): CaneCocosColorModulationV1 {
    const node = this.node as unknown as { readonly _uiProps: CocosUiPropertiesV1 };
    output.r = this.color.r;
    output.g = this.color.g;
    output.b = this.color.b;
    output.alpha = node._uiProps.opacity;
    return output;
  }

  writeWorldAffine(
    output: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  ): typeof output {
    return writeCocosMat4ToCaneAffineV1(this.node.worldMatrix, output);
  }

  requestRenderDataUpdate(): void {
    if (this.isValid) this.markForUpdateRenderData();
  }

  get component(): UIRenderer { return this; }

  setMaterialTemplate(material: Material): void {
    this.#renderer?.setMaterialTemplate(material);
    this.markForUpdateRenderData();
  }

  findBone(idOrName: string) { return this.#requireRuntime("cocosFindBone").findBone(idOrName); }
  queryBone(idOrName: string) { return this.#requireRuntime("cocosQueryBone").queryBone(idOrName); }
  findSlot(idOrName: string) { return this.#requireRuntime("cocosFindSlot").findSlot(idOrName); }
  querySlot(idOrName: string) { return this.#requireRuntime("cocosQuerySlot").querySlot(idOrName); }
  findConstraint(idOrName: string) { return this.#requireRuntime("cocosFindConstraint").findConstraint(idOrName); }
  queryConstraint(idOrName: string) { return this.#requireRuntime("cocosQueryConstraint").queryConstraint(idOrName); }

  setBonePosition(idOrName: string, x: number, y: number): this {
    this.#requireRuntime("cocosSetBonePosition").setBonePosition(idOrName, x, y); return this;
  }
  setBoneRotation(idOrName: string, rotationDegrees: number): this {
    this.#requireRuntime("cocosSetBoneRotation").setBoneRotation(idOrName, rotationDegrees); return this;
  }
  setBoneLocal(idOrName: string, local: RuntimeBoneLocalV1): this {
    this.#requireRuntime("cocosSetBoneLocal").setBoneLocal(idOrName, local); return this;
  }
  patchBoneLocal(idOrName: string, patch: RuntimeBoneLocalPatchV1): this {
    this.#requireRuntime("cocosPatchBoneLocal").patchBoneLocal(idOrName, patch); return this;
  }
  addBoneLocal(idOrName: string, delta: RuntimeBoneLocalAdditiveV1): this {
    this.#requireRuntime("cocosAddBoneLocal").addBoneLocal(idOrName, delta); return this;
  }
  setBoneLocalPersistent(idOrName: string, local: RuntimeBoneLocalV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetBoneLocalPersistent").setBoneLocalPersistent(idOrName, local);
  }
  clearBoneLocalPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearBoneLocalPersistent").clearBoneLocalPersistent(idOrName);
  }
  setConstraintTarget(idOrName: string, x: number, y: number): this {
    this.#requireRuntime("cocosSetConstraintTarget").setConstraintTarget(idOrName, x, y); return this;
  }
  setConstraintMix(idOrName: string, mix: number): this {
    this.#requireRuntime("cocosSetConstraintMix").setConstraintMix(idOrName, mix); return this;
  }
  setConstraintPersistent(idOrName: string, value: RuntimeConstraintOverrideV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetConstraintPersistent").setConstraintPersistent(idOrName, value);
  }
  clearConstraintPersistent(idOrName: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearConstraintPersistent").clearConstraintPersistent(idOrName);
  }
  setPhysicsInertia(idOrName: string, inertia: number): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetPhysicsInertia").setPhysicsInertia(idOrName, inertia);
  }
  setAnimation(trackIndex: number, name: string, loop: boolean, mixSeconds?: number | null): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetAnimation").setAnimation(trackIndex, name, loop, mixSeconds);
  }
  addAnimation(trackIndex: number, name: string, loop: boolean, delaySeconds = 0): RuntimeFrameV1 {
    return this.#requireRuntime("cocosAddAnimation").addAnimation(trackIndex, name, loop, delaySeconds);
  }
  clearTrack(trackIndex: number): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearTrack").clearTrack(trackIndex);
  }
  clearTracks(): RuntimeFrameV1 { return this.#requireRuntime("cocosClearTracks").clearTracks(); }
  setMix(from: string, to: string, seconds: number): this {
    this.#requireRuntime("cocosSetMix").setMix(from, to, seconds); return this;
  }
  setSkin(idOrName: string | null): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetSkin").setSkin(idOrName);
  }
  setAttachment(slot: string, attachment: string | null): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetAttachment").setAttachment(slot, attachment);
  }
  clearAttachment(slot: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearAttachment").clearAttachment(slot);
  }
  resetPhysics(): RuntimeFrameV1 { return this.#requireRuntime("cocosResetPhysics").resetPhysics(); }
  resetPhysicsConstraint(idOrName: string): boolean {
    return this.#requireRuntime("cocosResetPhysicsConstraint").resetPhysicsConstraint(idOrName);
  }
  setPhysicsEnvironment(environment: RuntimePhysicsEnvironmentV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetPhysicsEnvironment").setPhysicsEnvironment(environment);
  }
  setRootTransform(root: RootTransformV1, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetRootTransform").setRootTransform(root, options);
  }
  setRootPosition(x: number, y: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetRootPosition").setRootPosition(x, y, options);
  }
  setRootRotation(rotationDegrees: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetRootRotation").setRootRotation(rotationDegrees, options);
  }
  teleportRoot(
    root: RootTransformV1,
    mode: Exclude<RuntimePhysicsHostMotionModeV1, "move"> = "teleport",
    constraintId?: string,
  ): RuntimeFrameV1 {
    return this.#requireRuntime("cocosTeleportRoot").teleportRoot(root, mode, constraintId);
  }

  get attachmentFactory() { return this.#requireRuntime("cocosAttachmentFactory").attachmentFactory; }
  createRuntimeSkin(options: RuntimeSkinBuilderOptionsV1): RuntimeSkinBuilderV1 {
    return this.#requireRuntime("cocosCreateRuntimeSkin").createRuntimeSkin(options);
  }
  copyRuntimeSkin(
    idOrName: string,
    options: Partial<RuntimeSkinBuilderOptionsV1> & Pick<RuntimeSkinBuilderOptionsV1, "id">,
  ): RuntimeSkinBuilderV1 {
    return this.#requireRuntime("cocosCopyRuntimeSkin").copyRuntimeSkin(idOrName, options);
  }
  queryRuntimeResources(): RuntimeResourceSnapshotV1 {
    return this.#requireRuntime("cocosQueryRuntimeResources").queryRuntimeResources();
  }
  applyRuntimeResources(changes: RuntimeResourceChangesV1 | RuntimeResourceTransactionV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosApplyRuntimeResources").applyRuntimeResources(changes);
  }
  installRuntimeSkin(skin: RuntimeSkinV1 | RuntimeSkinBuilderV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosInstallRuntimeSkin").installRuntimeSkin(skin);
  }
  removeRuntimeSkin(skinId: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosRemoveRuntimeSkin").removeRuntimeSkin(skinId);
  }
  installRuntimeAttachment(attachment: RuntimeAttachmentV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosInstallRuntimeAttachment").installRuntimeAttachment(attachment);
  }
  removeRuntimeAttachment(attachmentId: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosRemoveRuntimeAttachment").removeRuntimeAttachment(attachmentId);
  }
  installRuntimeImage(image: RuntimeImageV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosInstallRuntimeImage").installRuntimeImage(image);
  }
  removeRuntimeImage(imageId: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosRemoveRuntimeImage").removeRuntimeImage(imageId);
  }
  installRuntimeAtlas(atlas: RuntimeOverlayAtlasV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosInstallRuntimeAtlas").installRuntimeAtlas(atlas);
  }
  removeRuntimeAtlas(atlasId: string): RuntimeFrameV1 {
    return this.#requireRuntime("cocosRemoveRuntimeAtlas").removeRuntimeAtlas(atlasId);
  }
  clearRuntimeResources(): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearRuntimeResources").clearRuntimeResources();
  }

  jitterGeometry(modifier: RuntimeDeterministicJitterModifierV1): this {
    this.#requireRuntime("cocosJitterGeometry").jitterGeometry(modifier); return this;
  }
  radialWaveGeometry(modifier: RuntimeRadialWaveModifierV1): this {
    this.#requireRuntime("cocosRadialWaveGeometry").radialWaveGeometry(modifier); return this;
  }
  modifyGeometry(modifier: RuntimeCustomGeometryModifierV1): this {
    this.#requireRuntime("cocosModifyGeometry").modifyGeometry(modifier); return this;
  }
  setPersistentGeometryModifiers(modifiers: RuntimeGeometryModifiersV1): RuntimeFrameV1 {
    return this.#requireRuntime("cocosSetPersistentGeometryModifiers").setPersistentGeometryModifiers(modifiers);
  }
  clearPersistentGeometryModifiers(): RuntimeFrameV1 {
    return this.#requireRuntime("cocosClearPersistentGeometryModifiers").clearPersistentGeometryModifiers();
  }

  beforeConstraints(listener: RuntimeBeforeConstraintsListenerV1): () => void {
    return this.#requireRuntime("cocosBeforeConstraints").beforeConstraints(listener);
  }
  afterConstraints(listener: RuntimeAfterConstraintsListenerV1): () => void {
    return this.#requireRuntime("cocosAfterConstraints").afterConstraints(listener);
  }
  onEvent(listener: RuntimeEventListenerV1): () => void;
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(kind: Kind, listener: RuntimeEventListenerV1<Kind>): () => void;
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(
    kindOrListener: Kind | RuntimeEventListenerV1,
    listener?: RuntimeEventListenerV1<Kind>,
  ): () => void {
    const runtime = this.#requireRuntime("cocosOnEvent");
    return typeof kindOrListener === "function"
      ? runtime.onEvent(kindOrListener)
      : runtime.onEvent(kindOrListener, listener as RuntimeEventListenerV1<Kind>);
  }

  queryBounds(options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsSnapshotV1 {
    return this.#requireRuntime("cocosQueryBounds").queryBounds(options);
  }

  containsPoint(x: number, y: number, options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsHitV1 | null {
    return this.#requireRuntime("cocosContainsPoint").containsPoint(x, y, options);
  }

  writePointHits(
    x: number,
    y: number,
    output: RuntimeBoundsHitV1[],
    options: RuntimeBoundsOptionsV1 = {},
  ): number {
    return this.#requireRuntime("cocosWritePointHits").writePointHits(x, y, output, options);
  }

  intersectsSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: RuntimeBoundsOptionsV1 = {},
  ): RuntimeBoundsHitV1 | null {
    return this.#requireRuntime("cocosIntersectsSegment").intersectsSegment(x1, y1, x2, y2, options);
  }

  writeSegmentHits(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    output: RuntimeBoundsHitV1[],
    options: RuntimeBoundsOptionsV1 = {},
  ): number {
    return this.#requireRuntime("cocosWriteSegmentHits")
      .writeSegmentHits(x1, y1, x2, y2, output, options);
  }

  containsGlobalPoint(
    point: Readonly<Vec2>,
    options: RuntimeBoundsOptionsV1 = {},
  ): RuntimeBoundsHitV1 | null {
    this.#globalToLocalPoint(point, this.#pointScratch);
    return this.containsPoint(this.#pointScratch.x, this.#pointScratch.y, options);
  }

  intersectsGlobalSegment(
    start: Readonly<Vec2>,
    end: Readonly<Vec2>,
    options: RuntimeBoundsOptionsV1 = {},
  ): RuntimeBoundsHitV1 | null {
    this.#globalToLocalPoint(start, this.#pointScratch);
    this.#globalToLocalPoint(end, this.#pointScratch2);
    return this.intersectsSegment(
      this.#pointScratch.x,
      this.#pointScratch.y,
      this.#pointScratch2.x,
      this.#pointScratch2.y,
      options,
    );
  }

  getBonePosition(idOrName: string, output: Vec2 = new Vec2()): Vec2 {
    return this.#requireRuntime("cocosGetBonePosition").getBonePosition(idOrName, output);
  }

  boneToLocal(idOrName: string, point: RuntimePointV1 = ZERO_POINT_V1, output: Vec2 = new Vec2()): Vec2 {
    return this.#requireRuntime("cocosBoneToLocal").boneToLocal(idOrName, point, output);
  }

  localToBone(idOrName: string, point: RuntimePointV1, output: Vec2 = new Vec2()): Vec2 {
    return this.#requireRuntime("cocosLocalToBone").localToBone(idOrName, point, output);
  }

  getBoneMatrix(idOrName: string): AffineV1 {
    return this.#requireRuntime("cocosGetBoneMatrix").getBoneMatrix(idOrName);
  }

  boneToGlobal(idOrName: string, point: RuntimePointV1 = ZERO_POINT_V1, output: Vec2 = new Vec2()): Vec2 {
    const local = this.boneToLocal(idOrName, point, this.#pointScratch);
    writeCocosMat4ToCaneAffineV1(this.node.worldMatrix, this.#affineScratch);
    return writeTransformCanePointV1(this.#affineScratch, local, output);
  }

  /** Cocos world-space alias matching the common Skeleton socket API vocabulary. */
  boneToWorld(idOrName: string, point: RuntimePointV1 = ZERO_POINT_V1, output: Vec2 = new Vec2()): Vec2 {
    return this.boneToGlobal(idOrName, point, output);
  }

  globalToBone(idOrName: string, point: Readonly<Vec2>, output: Vec2 = new Vec2()): Vec2 {
    writeCocosMat4ToCaneAffineV1(this.node.worldMatrix, this.#affineScratch);
    writeInverseTransformCanePointV1(this.#affineScratch, point, this.#pointScratch);
    return this.localToBone(idOrName, this.#pointScratch, output);
  }

  /** Inverse of boneToWorld; globalToBone remains available for Cocos UI terminology. */
  worldToBone(idOrName: string, point: Readonly<Vec2>, output: Vec2 = new Vec2()): Vec2 {
    return this.globalToBone(idOrName, point, output);
  }

  addBoneObject(idOrName: string, object: Node): Node {
    const followers = this.#followers;
    if (followers === null) this.#requireRuntime("cocosAddBoneObject");
    return this.#followers!.addBoneObject(idOrName, object);
  }

  removeBoneObject(object: Node): boolean {
    return this.#followers?.removeBoneObject(object) ?? false;
  }

  writeBoneObjects(output: Node[], idOrName?: string): number {
    const followers = this.#followers;
    if (followers === null) this.#requireRuntime("cocosWriteBoneObjects");
    return this.#followers!.writeBoneObjects(output, idOrName);
  }

  addSlotObject(
    slotIdOrName: string,
    object: Node,
    placementOrOptions: CaneCocosSlotPlacementV1 | CaneCocosSlotObjectOptionsV1 = "after",
  ): Node {
    const followers = this.#followers;
    if (followers === null) this.#requireRuntime("cocosAddSlotObject");
    return this.#followers!.addSlotObject(slotIdOrName, object, placementOrOptions);
  }

  getSlotObject(
    slotIdOrName: string,
    placement: CaneCocosSlotPlacementV1 = "after",
    index = 0,
  ): Node | null {
    const followers = this.#followers;
    if (followers === null) this.#requireRuntime("cocosGetSlotObject");
    return this.#followers!.getSlotObject(slotIdOrName, placement, index);
  }

  querySlotObject(object: Node): CaneCocosSlotObjectStateV1 | null {
    return this.#followers?.querySlotObject(object) ?? null;
  }

  writeSlotObjects(output: Node[], slotIdOrName?: string): number {
    const followers = this.#followers;
    if (followers === null) this.#requireRuntime("cocosWriteSlotObjects");
    return this.#followers!.writeSlotObjects(output, slotIdOrName);
  }

  removeSlotObject(object: Node): boolean {
    return this.#followers?.removeSlotObject(object) ?? false;
  }

  removeSlotObjects(slotIdOrName?: string): number {
    return this.#followers?.removeSlotObjects(slotIdOrName) ?? 0;
  }

  protected override createRenderEntity(): UIRenderer["renderEntity"] {
    return createCaneCrossedRenderEntityV1(() => super.createRenderEntity());
  }

  protected override _flushAssembler(): void { this.#flushCaneAssembler(); }

  protected override _render(batcher: UI): void {
    this.#renderer?.submit(batcher);
    setCaneCrossedWebTraversalV1(this.node, true);
  }

  #flushCaneAssembler(): void {
    const renderer = this.#renderer;
    // Creator may flush an enabled UIRenderer before async Cane assets finish loading.
    // Installing the assembler at that point makes Creator immediately call createData(),
    // which cannot be valid until the renderer owns its retained buffers.
    if (renderer === null) return;
    if (this._assembler !== CANE_COCOS_ASSEMBLER_V1) {
      this._assembler = CANE_COCOS_ASSEMBLER_V1;
      this._renderData = null;
    }
    if (this._renderData === null) this._renderData = renderer.createRenderData();
    this.markForUpdateRenderData();
  }

  #requireRuntime(operation: string): CaneCocosRuntime {
    if (this.#runtime === null) {
      throw new CaneCocosErrorV1("invalidState", "CaneSkeleton is not initialized; await initialize().", {
        operation,
        field: "runtime",
        entityId: this.node.uuid,
      });
    }
    return this.#runtime;
  }

  #globalToLocalPoint<T extends { x: number; y: number }>(point: Readonly<Vec2>, output: T): T {
    writeCocosMat4ToCaneAffineV1(this.node.worldMatrix, this.#affineScratch);
    return writeInverseTransformCanePointV1(this.#affineScratch, point, output);
  }

  #releaseRuntime(): void {
    const runtime = this.#runtime;
    const renderer = this.#renderer;
    const asset = this.#asset;
    const followers = this.#followers;
    const unsubscribeDeviceLoss = this.#unsubscribeDeviceLoss;
    this.#runtime = null;
    this.#renderer = null;
    this.#asset = null;
    this.#followers = null;
    this.#unsubscribeDeviceLoss = null;
    this._renderData = null;
    unsubscribeDeviceLoss?.();
    followers?.destroy();
    runtime?.destroy();
    if (runtime === null) renderer?.destroy();
    if (asset !== null) void asset.destroy().catch((error: unknown) => this.#reportError(error));
  }

  #reportError(error: unknown): void {
    this.#lastError = error;
    this.node.emit(CaneSkeleton.EventType.ERROR, error, this);
  }

  static readonly EventType = Object.freeze({
    READY: "cane-ready",
    ERROR: "cane-error",
  });
}

const CANE_COCOS_ASSEMBLER_V1: IAssembler = {
  createData(component: UIRenderer) {
    return (component as CaneSkeleton).createCaneRenderData();
  },
  updateRenderData(component: UIRenderer): void {
    (component as CaneSkeleton).prepareCaneRenderData();
  },
};
