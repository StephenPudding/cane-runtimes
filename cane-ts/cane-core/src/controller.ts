import type {
  RootTransformV1,
  RuntimeAfterConstraintsListenerV1,
  RuntimeAttachmentV1,
  RuntimeBeforeConstraintsListenerV1,
  RuntimeBoneFrameV1,
  RuntimeBoneLocalAdditiveV1,
  RuntimeBoneLocalPatchV1,
  RuntimeBoneLocalStateV1,
  RuntimeBoneLocalV1,
  RuntimeConstraintOverrideV1,
  RuntimeConstraintStateV1,
  RuntimeClippingGeometryV1,
  RuntimeEventListenerV1,
  RuntimeFrameV1,
  RuntimeCustomGeometryModifierV1,
  RuntimeDeterministicJitterModifierV1,
  RuntimeGeometryModifiersV1,
  RuntimeBoundsOptionsV1,
  RuntimeBoundsSnapshotV1,
  RuntimeImageV1,
  RuntimeLifecycleEventKindV1,
  RuntimeOverlayAtlasV1,
  RuntimePhysicsHostMotionModeV1,
  RuntimeResourceChangesV1,
  RuntimeResourceSnapshotV1,
  RuntimeRootTransformOptionsV1,
  RuntimeSamplingV1,
  RuntimeRadialWaveModifierV1,
  RuntimeSkinV1,
  RuntimeSlotStateV1,
  RuntimeStepV1,
} from "./contracts.js";
import { RuntimeErrorV1 } from "./errors.js";
import { RuntimePlayerV1 } from "./player.js";
import { RuntimePoseModifierBufferV1 } from "./pose-modifier-buffer.js";
import { RuntimeGeometryModifierBufferV1 } from "./geometry-modifier-buffer.js";
import { RuntimeBoundsV1 } from "./bounds.js";
import {
  RuntimeAttachmentFactoryV1,
  RuntimeResourceTransactionV1,
  RuntimeSkinBuilderV1,
  type RuntimeSkinBuilderOptionsV1,
} from "./runtime-resources.js";

const AUTHORED_SAMPLING_V1: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });

export type CaneBoneReferenceV1 = string | CaneBoneHandleV1;
export type CaneSlotReferenceV1 = string | CaneSlotHandleV1;
export type CaneConstraintReferenceV1 = string | CaneConstraintHandleV1;

/** Stable-ID Bone proxy. It never stores a second local or world pose. */
export class CaneBoneHandleV1 {
  readonly id: string;
  readonly name: string;
  readonly #owner: CaneRuntimeControllerV1;

  constructor(owner: CaneRuntimeControllerV1, id: string, name: string) {
    this.#owner = owner;
    this.id = id;
    this.name = name;
  }

  get local(): RuntimeBoneLocalStateV1 {
    return this.#owner.player.queryBoneLocalState(this.id);
  }

  get world(): RuntimeBoneFrameV1 {
    return this.#owner.queryBoneWorld(this);
  }

  setPosition(x: number, y: number): this {
    this.#owner.setBonePosition(this, x, y);
    return this;
  }

  setRotation(rotationDegrees: number): this {
    this.#owner.setBoneRotation(this, rotationDegrees);
    return this;
  }

  patchLocal(patch: RuntimeBoneLocalPatchV1): this {
    this.#owner.patchBoneLocal(this, patch);
    return this;
  }

  addLocal(delta: RuntimeBoneLocalAdditiveV1): this {
    this.#owner.addBoneLocal(this, delta);
    return this;
  }

  belongsTo(owner: CaneRuntimeControllerV1): boolean {
    return this.#owner === owner;
  }
}

/** Stable-ID Slot proxy over the player's currently published state. */
export class CaneSlotHandleV1 {
  readonly id: string;
  readonly name: string;
  readonly #owner: CaneRuntimeControllerV1;

  constructor(owner: CaneRuntimeControllerV1, id: string, name: string) {
    this.#owner = owner;
    this.id = id;
    this.name = name;
  }

  get state(): RuntimeSlotStateV1 {
    return this.#owner.player.querySlotState(this.id);
  }

  get attachmentId(): string | null {
    return this.#owner.player.querySlotAttachmentId(this.id);
  }

  setAttachment(attachmentIdOrName: string | null): RuntimeFrameV1 {
    return this.#owner.setAttachment(this, attachmentIdOrName);
  }

  clearAttachmentOverride(): RuntimeFrameV1 {
    return this.#owner.clearAttachment(this);
  }

  belongsTo(owner: CaneRuntimeControllerV1): boolean {
    return this.#owner === owner;
  }
}

/** Stable-ID constraint proxy. Target/mix setters are transient by design. */
export class CaneConstraintHandleV1 {
  readonly id: string;
  readonly name: string;
  readonly kind: RuntimeConstraintStateV1["kind"];
  readonly #owner: CaneRuntimeControllerV1;

  constructor(
    owner: CaneRuntimeControllerV1,
    id: string,
    name: string,
    kind: RuntimeConstraintStateV1["kind"],
  ) {
    this.#owner = owner;
    this.id = id;
    this.name = name;
    this.kind = kind;
  }

  get state(): RuntimeConstraintStateV1 {
    return this.#owner.player.queryConstraintState(this.id);
  }

  setTarget(x: number, y: number): this {
    this.#owner.setConstraintTarget(this, x, y);
    return this;
  }

  setMix(mix: number): this {
    this.#owner.setConstraintMix(this, mix);
    return this;
  }

  belongsTo(owner: CaneRuntimeControllerV1): boolean {
    return this.#owner === owner;
  }
}

/**
 * Spine-style game convenience surface over one authoritative RuntimePlayerV1.
 *
 * Bone and constraint setters append one-frame operations. Call `apply()` or
 * `advance()` once after all game logic has queued its edits. Skin and Slot
 * attachment setters are persistent host overrides and return the immediately
 * rebuilt frame. The low-level player remains available through `player`.
 */
export class CaneRuntimeControllerV1 {
  readonly player: RuntimePlayerV1;
  readonly modifiers: RuntimePoseModifierBufferV1;
  readonly geometry = new RuntimeGeometryModifierBufferV1();
  readonly attachments = new RuntimeAttachmentFactoryV1();

  #catalogIdentity: object | null = null;
  readonly #boneById = new Map<string, CaneBoneHandleV1>();
  readonly #boneByName = new Map<string, CaneBoneHandleV1>();
  readonly #boneIndexById = new Map<string, number>();
  readonly #slotById = new Map<string, CaneSlotHandleV1>();
  readonly #slotByName = new Map<string, CaneSlotHandleV1>();
  readonly #constraintById = new Map<string, CaneConstraintHandleV1>();
  readonly #constraintByName = new Map<string, CaneConstraintHandleV1>();

  constructor(player: RuntimePlayerV1, modifiers = new RuntimePoseModifierBufferV1()) {
    if (!(player instanceof RuntimePlayerV1)) {
      throw new RuntimeErrorV1("invalidArgument", "createController", "player must be a RuntimePlayerV1.", {
        field: "player",
      });
    }
    this.player = player;
    this.modifiers = modifiers;
    this.#ensureCatalog();
  }

  get frame(): RuntimeFrameV1 {
    return this.player.frame;
  }

  findBone(idOrName: string): CaneBoneHandleV1 | null {
    this.#ensureCatalog();
    return this.#boneById.get(idOrName) ?? this.#boneByName.get(idOrName) ?? null;
  }

  queryBone(idOrName: string): CaneBoneHandleV1 {
    const bone = this.findBone(idOrName);
    if (bone === null) throw notFoundV1("queryBone", "bone", idOrName);
    return bone;
  }

  findSlot(idOrName: string): CaneSlotHandleV1 | null {
    this.#ensureCatalog();
    return this.#slotById.get(idOrName) ?? this.#slotByName.get(idOrName) ?? null;
  }

  querySlot(idOrName: string): CaneSlotHandleV1 {
    const slot = this.findSlot(idOrName);
    if (slot === null) throw notFoundV1("querySlot", "slot", idOrName);
    return slot;
  }

  findConstraint(idOrName: string): CaneConstraintHandleV1 | null {
    this.#ensureCatalog();
    return this.#constraintById.get(idOrName) ?? this.#constraintByName.get(idOrName) ?? null;
  }

  queryConstraint(idOrName: string): CaneConstraintHandleV1 {
    const constraint = this.findConstraint(idOrName);
    if (constraint === null) throw notFoundV1("queryConstraint", "constraint", idOrName);
    return constraint;
  }

  queryBoneWorld(reference: CaneBoneReferenceV1): RuntimeBoneFrameV1 {
    const boneId = this.#boneId(reference);
    const index = this.#boneIndexById.get(boneId);
    const indexed = index === undefined ? undefined : this.player.frame.bones[index];
    if (indexed?.id === boneId) return indexed;
    const bone = this.player.frame.bones.find((candidate) => candidate.id === boneId);
    if (bone === undefined) throw notFoundV1("queryBoneWorld", "bone", boneId);
    return bone;
  }

  setBonePosition(reference: CaneBoneReferenceV1, x: number, y: number): this {
    this.modifiers.patchBoneLocal(this.#boneId(reference), { x, y });
    return this;
  }

  setBoneRotation(reference: CaneBoneReferenceV1, rotationDegrees: number): this {
    this.modifiers.patchBoneLocal(this.#boneId(reference), { rotationDegrees });
    return this;
  }

  setBoneLocal(reference: CaneBoneReferenceV1, local: RuntimeBoneLocalV1): this {
    this.modifiers.replaceBoneLocal(this.#boneId(reference), local);
    return this;
  }

  patchBoneLocal(reference: CaneBoneReferenceV1, patch: RuntimeBoneLocalPatchV1): this {
    this.modifiers.patchBoneLocal(this.#boneId(reference), patch);
    return this;
  }

  addBoneLocal(reference: CaneBoneReferenceV1, delta: RuntimeBoneLocalAdditiveV1): this {
    this.modifiers.addBoneLocal(this.#boneId(reference), delta);
    return this;
  }

  /** Explicit persistent full-local override; unlike transient setters it survives apply/advance. */
  setBoneLocalPersistent(reference: CaneBoneReferenceV1, local: RuntimeBoneLocalV1): RuntimeFrameV1 {
    return this.player.setBoneLocalOverride(this.#boneId(reference), local);
  }

  clearBoneLocalPersistent(reference: CaneBoneReferenceV1): RuntimeFrameV1 {
    return this.player.clearBoneLocalOverride(this.#boneId(reference));
  }

  setConstraintTarget(reference: CaneConstraintReferenceV1, x: number, y: number): this {
    const constraint = this.#constraint(reference);
    if (constraint.kind !== "ik") {
      throw new RuntimeErrorV1("invalidArgument", "setConstraintTarget", "Only IK constraints accept a point target.", {
        field: "constraint",
        entityId: constraint.id,
      });
    }
    this.modifiers.setConstraintTarget(constraint.id, x, y);
    return this;
  }

  setConstraintMix(reference: CaneConstraintReferenceV1, mix: number): this {
    const constraint = this.#constraint(reference);
    this.modifiers.setConstraintMix(constraint.id, constraint.kind, mix);
    return this;
  }

  setConstraintPersistent(
    reference: CaneConstraintReferenceV1,
    parameters: RuntimeConstraintOverrideV1,
  ): RuntimeFrameV1 {
    return this.player.setConstraintOverride(this.#constraintId(reference), parameters);
  }

  clearConstraintPersistent(reference: CaneConstraintReferenceV1): RuntimeFrameV1 {
    return this.player.clearConstraintOverride(this.#constraintId(reference));
  }

  setAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    mixSeconds?: number | null,
  ): RuntimeFrameV1 {
    const request = {
      trackIndex,
      animationId: this.#animationId(animationIdOrName),
      looping,
      ...(mixSeconds === undefined ? {} : { mixSeconds }),
    };
    return this.player.setAnimation(request);
  }

  addAnimation(
    trackIndex: number,
    animationIdOrName: string,
    looping: boolean,
    delaySeconds = 0,
  ): RuntimeFrameV1 {
    return this.player.queueAnimation({
      trackIndex,
      animationId: this.#animationId(animationIdOrName),
      looping,
      delaySeconds,
    });
  }

  clearTrack(trackIndex: number): RuntimeFrameV1 {
    return this.player.clearTrack(trackIndex);
  }

  clearTracks(): RuntimeFrameV1 {
    return this.player.clearTracks();
  }

  setSkin(idOrName: string | null): RuntimeFrameV1 {
    return this.player.setSkin(idOrName === null ? null : this.#skinId(idOrName));
  }

  /** Creates a detached runtime-only Skin builder. Installation is explicit and atomic. */
  createRuntimeSkin(options: RuntimeSkinBuilderOptionsV1): RuntimeSkinBuilderV1 {
    return new RuntimeSkinBuilderV1(options);
  }

  /** Copies an exported or runtime-only Skin into a detached mutable builder. */
  copyRuntimeSkin(
    idOrName: string,
    options: Partial<RuntimeSkinBuilderOptionsV1> & Pick<RuntimeSkinBuilderOptionsV1, "id">,
  ): RuntimeSkinBuilderV1 {
    const skinId = this.#skinId(idOrName);
    const skin = this.player.data.document.skins.find((candidate) => candidate.id === skinId);
    if (skin === undefined) throw notFoundV1("copyRuntimeSkin", "skin", idOrName);
    return RuntimeSkinBuilderV1.fromSkin(skin, options);
  }

  queryRuntimeResources(): RuntimeResourceSnapshotV1 {
    return this.player.queryRuntimeResources();
  }

  applyRuntimeResources(
    changes: RuntimeResourceChangesV1 | RuntimeResourceTransactionV1,
  ): RuntimeFrameV1 {
    return this.player.applyRuntimeResources(snapshotRuntimeResourceChangesV1(changes));
  }

  installRuntimeSkin(skin: RuntimeSkinV1 | RuntimeSkinBuilderV1): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().upsertSkin(skin));
  }

  removeRuntimeSkin(skinId: string): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().removeSkin(skinId));
  }

  installRuntimeAttachment(attachment: RuntimeAttachmentV1): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().upsertAttachment(attachment));
  }

  removeRuntimeAttachment(attachmentId: string): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().removeAttachment(attachmentId));
  }

  installRuntimeImage(image: RuntimeImageV1): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().upsertImage(image));
  }

  removeRuntimeImage(imageId: string): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().removeImage(imageId));
  }

  installRuntimeAtlas(resource: RuntimeOverlayAtlasV1): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().upsertAtlas(resource));
  }

  removeRuntimeAtlas(atlasId: string): RuntimeFrameV1 {
    return this.applyRuntimeResources(new RuntimeResourceTransactionV1().removeAtlas(atlasId));
  }

  clearRuntimeResources(): RuntimeFrameV1 {
    return this.player.clearRuntimeResources();
  }

  jitterGeometry(modifier: RuntimeDeterministicJitterModifierV1): this {
    this.geometry.deterministicJitter(modifier);
    return this;
  }

  radialWaveGeometry(modifier: RuntimeRadialWaveModifierV1): this {
    this.geometry.radialWave(modifier);
    return this;
  }

  modifyGeometry(modifier: RuntimeCustomGeometryModifierV1): this {
    this.geometry.custom(modifier);
    return this;
  }

  setPersistentGeometryModifiers(modifiers: RuntimeGeometryModifiersV1): RuntimeFrameV1 {
    return this.player.setGeometryModifiers(modifiers);
  }

  clearPersistentGeometryModifiers(): RuntimeFrameV1 {
    return this.player.clearGeometryModifiers();
  }

  setRootTransform(root: RootTransformV1, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.player.setRootTransform(root, options);
  }

  setRootPosition(x: number, y: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.player.setRootPosition(x, y, options);
  }

  setRootRotation(rotationDegrees: number, options: RuntimeRootTransformOptionsV1 = {}): RuntimeFrameV1 {
    return this.player.setRootRotation(rotationDegrees, options);
  }

  teleportRoot(
    root: RootTransformV1,
    physicsMode: Exclude<RuntimePhysicsHostMotionModeV1, "move"> = "teleport",
    constraintId?: string,
  ): RuntimeFrameV1 {
    return this.player.teleportRoot(root, physicsMode, constraintId);
  }

  queryBounds(options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsSnapshotV1 {
    return this.player.queryBounds(options);
  }

  queryClippingGeometry(attachmentId: string): RuntimeClippingGeometryV1 | null {
    return this.player.queryClippingGeometry(attachmentId);
  }

  /** Returns sampled Slot alpha without allocating a Slot-state DTO. */
  querySlotAlpha(slotReference: CaneSlotReferenceV1): number {
    return this.player.querySlotAlpha(this.#slotId(slotReference));
  }

  writeBounds(output: RuntimeBoundsV1, options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsV1 {
    return this.player.writeBounds(output, options);
  }

  setAttachment(
    slotReference: CaneSlotReferenceV1,
    attachmentIdOrName: string | null,
  ): RuntimeFrameV1 {
    const slotId = this.#slotId(slotReference);
    const attachmentId = attachmentIdOrName === null
      ? null
      : this.#attachmentId(slotId, attachmentIdOrName);
    return this.player.setSlotAttachmentOverride(slotId, attachmentId);
  }

  clearAttachment(slotReference: CaneSlotReferenceV1): RuntimeFrameV1 {
    return this.player.clearSlotAttachmentOverride(this.#slotId(slotReference));
  }

  beforeConstraints(listener: RuntimeBeforeConstraintsListenerV1): () => void {
    return this.player.beforeConstraints(listener);
  }

  afterConstraints(listener: RuntimeAfterConstraintsListenerV1): () => void {
    return this.player.afterConstraints(listener);
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
    if (typeof kindOrListener === "function") return this.player.onEvent(kindOrListener);
    if (listener === undefined) {
      throw new RuntimeErrorV1("invalidArgument", "onEvent", "listener must be a function.", {
        field: "listener",
      });
    }
    return this.player.onEvent(kindOrListener, listener);
  }

  update(deltaSeconds: number): RuntimeStepV1 {
    return this.player.update(deltaSeconds);
  }

  apply(sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING_V1): RuntimeFrameV1 {
    try {
      if (this.modifiers.empty && this.geometry.empty) return this.player.apply(sampling);
      if (this.geometry.empty) return this.player.applyWithModifiers(this.modifiers, sampling);
      if (this.modifiers.empty) return this.player.applyWithGeometryModifiers(this.geometry, sampling);
      return this.player.applyWithFrameModifiers(this.modifiers, this.geometry, sampling);
    } finally {
      this.modifiers.clear();
      this.geometry.clear();
    }
  }

  advance(deltaSeconds: number, sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING_V1): RuntimeFrameV1 {
    try {
      if (this.modifiers.empty && this.geometry.empty) return this.player.advance(deltaSeconds, sampling);
      if (this.geometry.empty) return this.player.advanceWithModifiers(deltaSeconds, this.modifiers, sampling);
      if (this.modifiers.empty) {
        return this.player.advanceWithGeometryModifiers(deltaSeconds, this.geometry, sampling);
      }
      return this.player.advanceWithFrameModifiers(deltaSeconds, this.modifiers, this.geometry, sampling);
    } finally {
      this.modifiers.clear();
      this.geometry.clear();
    }
  }

  #boneId(reference: CaneBoneReferenceV1): string {
    if (reference instanceof CaneBoneHandleV1) {
      if (!reference.belongsTo(this)) throw foreignHandleV1("bone", reference.id);
      return reference.id;
    }
    return this.queryBone(reference).id;
  }

  #slotId(reference: CaneSlotReferenceV1): string {
    if (reference instanceof CaneSlotHandleV1) {
      if (!reference.belongsTo(this)) throw foreignHandleV1("slot", reference.id);
      return reference.id;
    }
    return this.querySlot(reference).id;
  }

  #constraint(reference: CaneConstraintReferenceV1): CaneConstraintHandleV1 {
    if (reference instanceof CaneConstraintHandleV1) {
      if (!reference.belongsTo(this)) throw foreignHandleV1("constraint", reference.id);
      return reference;
    }
    return this.queryConstraint(reference);
  }

  #constraintId(reference: CaneConstraintReferenceV1): string {
    return this.#constraint(reference).id;
  }

  #animationId(idOrName: string): string {
    const animation = this.player.data.document.animations.find(
      (candidate) => candidate.id === idOrName || candidate.name === idOrName,
    );
    if (animation === undefined) throw notFoundV1("setAnimation", "animation", idOrName);
    return animation.id;
  }

  #skinId(idOrName: string): string {
    const skin = this.player.data.document.skins.find(
      (candidate) => candidate.id === idOrName || candidate.name === idOrName,
    );
    if (skin === undefined) throw notFoundV1("setSkin", "skin", idOrName);
    return skin.id;
  }

  #attachmentId(slotId: string, idOrName: string): string {
    const attachment = this.player.data.document.attachments.find(
      (candidate) => candidate.slotId === slotId
        && (candidate.id === idOrName || candidate.name === idOrName),
    );
    if (attachment === undefined) throw notFoundV1("setAttachment", "attachment", idOrName);
    return attachment.id;
  }

  #ensureCatalog(): void {
    const data = this.player.data;
    if (this.#catalogIdentity === data) return;
    this.#catalogIdentity = data;
    this.#boneById.clear();
    this.#boneByName.clear();
    this.#boneIndexById.clear();
    this.#slotById.clear();
    this.#slotByName.clear();
    this.#constraintById.clear();
    this.#constraintByName.clear();
    for (let index = 0; index < data.document.bones.length; index += 1) {
      const bone = data.document.bones[index];
      if (bone === undefined) continue;
      const handle = new CaneBoneHandleV1(this, bone.id, bone.name);
      this.#boneById.set(bone.id, handle);
      if (!this.#boneByName.has(bone.name)) this.#boneByName.set(bone.name, handle);
      this.#boneIndexById.set(bone.id, index);
    }
    for (const slot of data.document.slots) {
      const handle = new CaneSlotHandleV1(this, slot.id, slot.name);
      this.#slotById.set(slot.id, handle);
      if (!this.#slotByName.has(slot.name)) this.#slotByName.set(slot.name, handle);
    }
    for (const constraint of data.document.constraints) {
      const handle = new CaneConstraintHandleV1(this, constraint.id, constraint.name, constraint.type);
      this.#constraintById.set(constraint.id, handle);
      if (!this.#constraintByName.has(constraint.name)) this.#constraintByName.set(constraint.name, handle);
    }
  }
}

function snapshotRuntimeResourceChangesV1(
  changes: RuntimeResourceChangesV1 | RuntimeResourceTransactionV1,
): RuntimeResourceChangesV1 {
  if (changes instanceof RuntimeResourceTransactionV1) return changes.snapshot();
  const snapshot = (changes as RuntimeResourceChangesV1 & { readonly snapshot?: unknown }).snapshot;
  if (typeof snapshot === "function") {
    return (snapshot as (this: unknown) => RuntimeResourceChangesV1).call(changes);
  }
  return changes;
}

function notFoundV1(operation: string, kind: string, idOrName: string): RuntimeErrorV1 {
  return new RuntimeErrorV1("notFound", operation, `Unknown ${kind} '${idOrName}'.`, {
    entityId: idOrName,
  });
}

function foreignHandleV1(kind: string, id: string): RuntimeErrorV1 {
  return new RuntimeErrorV1("invalidArgument", `query${capitalizeV1(kind)}`, `${kind} handle belongs to another controller.`, {
    field: kind,
    entityId: id,
  });
}

function capitalizeV1(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}
