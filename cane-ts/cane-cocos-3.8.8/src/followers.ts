import {
  Graphics,
  Mask,
  Node,
  UIOpacity,
  UISkew,
  UITransform,
} from "cc";
import {
  RuntimeErrorV1,
  type RuntimeBoneFrameV1,
  type RuntimeClippingGeometryV1,
  type RuntimeFrameV1,
  type RuntimePlayerV1,
} from "@cane-runtime/core";
import {
  writeCaneAffineToCocosNodeChannelsV1,
  type CaneCocosAffineNodeChannelsV1,
} from "./coordinates.js";
import type { CaneCocosRuntime } from "./runtime.js";

export type CaneCocosSlotPlacementV1 = "before" | "after";
export type CaneCocosSlotClippingV1 = "inherit" | "none";

export interface CaneCocosSlotObjectOptionsV1 {
  readonly placement?: CaneCocosSlotPlacementV1;
  readonly followAttachmentVisibility?: boolean;
  readonly visibleWhenAttachment?: string | readonly string[];
  readonly inheritSlotAlpha?: boolean;
  readonly clipping?: CaneCocosSlotClippingV1;
}

export interface CaneCocosSlotObjectStateV1 {
  readonly slotId: string;
  readonly placement: CaneCocosSlotPlacementV1;
  readonly attachmentId: string | null;
  readonly active: boolean;
  readonly slotAlpha: number;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly clippingAttachmentId: string | null;
  readonly inverseClipping: boolean;
}

/**
 * A Cocos child that must be walked between two published Cane attachments.
 * `cursor` is an attachment boundary in the range 0..attachmentCount.
 */
export interface CaneCocosSceneNodeEntryV1 {
  cursor: number;
  node: Node;
  source: "slot" | "child";
  lastSeenSequence: number;
}

export interface CaneCocosFollowerStatsV1 {
  readonly boneObjects: number;
  readonly slotObjects: number;
  readonly activeSlotObjects: number;
  readonly maskedSlotObjects: number;
  readonly clippingMaskVertexWrites: number;
}

interface MutableFollowerStatsV1 {
  boneObjects: number;
  slotObjects: number;
  activeSlotObjects: number;
  maskedSlotObjects: number;
  clippingMaskVertexWrites: number;
}

interface BoneMountV1 {
  readonly boneId: string;
  readonly mount: Node;
  readonly skew: UISkew;
  readonly channels: CaneCocosAffineNodeChannelsV1;
  readonly objects: Set<Node>;
}

interface BoneObjectRecordV1 {
  readonly object: Node;
  readonly bone: BoneMountV1;
}

interface SlotObjectRecordV1 {
  readonly object: Node;
  readonly slotId: string;
  readonly boneId: string;
  readonly placement: CaneCocosSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachmentIds: readonly string[] | null;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CaneCocosSlotClippingV1;
  readonly root: Node;
  readonly mount: Node;
  readonly skew: UISkew;
  readonly opacity: UIOpacity;
  readonly mask: Mask;
  readonly graphics: Graphics;
  readonly channels: CaneCocosAffineNodeChannelsV1;
  attachmentId: string | null;
  slotAlpha: number;
  active: boolean;
  clip: RuntimeClippingGeometryV1 | null;
}

interface NormalizedSlotObjectOptionsV1 {
  readonly placement: CaneCocosSlotPlacementV1;
  readonly followAttachmentVisibility: boolean;
  readonly visibleWhenAttachment: string | readonly string[] | undefined;
  readonly inheritSlotAlpha: boolean;
  readonly clipping: CaneCocosSlotClippingV1;
}

const IDENTITY_CHANNELS_V1: CaneCocosAffineNodeChannelsV1 = Object.freeze({
  x: 0,
  y: 0,
  rotationDegrees: 0,
  scaleX: 1,
  scaleY: 1,
  skewXDegrees: 0,
  skewYDegrees: 0,
});

/**
 * Projects final Core Bone matrices and Slot state onto foreign Cocos Nodes.
 * It never samples animation, solves constraints, or computes attachment vertices.
 */
export class CaneCocosFollowerManagerV1 {
  readonly #host: Node;
  readonly #runtime: CaneCocosRuntime;
  readonly #player: RuntimePlayerV1;
  readonly #invalidate: () => void;
  readonly #boneMounts = new Map<string, BoneMountV1>();
  readonly #boneMountList: BoneMountV1[] = [];
  readonly #boneObjects = new Map<Node, BoneObjectRecordV1>();
  readonly #slotObjects = new Map<Node, SlotObjectRecordV1>();
  readonly #slotObjectList: SlotObjectRecordV1[] = [];
  readonly #slotBeforeById = new Map<string, SlotObjectRecordV1[]>();
  readonly #slotAfterById = new Map<string, SlotObjectRecordV1[]>();
  readonly #slotRoots = new Set<Node>();
  readonly #internalNodes = new Set<Node>();
  readonly #boneFrameById = new Map<string, RuntimeBoneFrameV1>();
  readonly #slotBoneById = new Map<string, string>();
  readonly #clippingAttachmentIds = new Set<string>();
  readonly #beforeClipBySlotId = new Map<string, RuntimeClippingGeometryV1 | null>();
  readonly #afterClipBySlotId = new Map<string, RuntimeClippingGeometryV1 | null>();
  readonly #attachmentIndexBySlotId = new Map<string, number>();
  readonly #drawOrderSlotIds: string[] = [];
  readonly #sceneEntries: CaneCocosSceneNodeEntryV1[] = [];
  readonly #sceneEntryPool: CaneCocosSceneNodeEntryV1[] = [];
  readonly #stats: MutableFollowerStatsV1 = {
    boneObjects: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    clippingMaskVertexWrites: 0,
  };
  #catalogIdentity: RuntimePlayerV1["data"] | null = null;
  #destroyed = false;

  constructor(host: Node, runtime: CaneCocosRuntime, invalidate: () => void = () => undefined) {
    this.#host = host;
    this.#runtime = runtime;
    this.#player = runtime.player;
    this.#invalidate = invalidate;
    this.#ensureCatalog();
  }

  get sceneEntries(): readonly CaneCocosSceneNodeEntryV1[] { return this.#sceneEntries; }

  addBoneObject(idOrName: string, object: Node): Node {
    this.#requireAlive("cocosAddBoneObject");
    this.#assertForeignObject(object, "cocosAddBoneObject");
    const boneId = this.#runtime.queryBone(idOrName).id;
    this.removeBoneObject(object);
    this.removeSlotObject(object);
    let bone = this.#boneMounts.get(boneId);
    if (bone === undefined) {
      const mount = new Node(`CaneBone:${boneId}`);
      mount.addComponent(UITransform);
      const skew = mount.addComponent(UISkew);
      skew.rotational = false;
      this.#host.addChild(mount);
      this.#internalNodes.add(mount);
      bone = {
        boneId,
        mount,
        skew,
        channels: createChannelsV1(),
        objects: new Set<Node>(),
      };
      this.#boneMounts.set(boneId, bone);
      this.#boneMountList.push(bone);
    }
    bone.mount.addChild(object);
    bone.objects.add(object);
    this.#boneObjects.set(object, { object, bone });
    this.#updateBoneMount(bone);
    this.#invalidate();
    return object;
  }

  removeBoneObject(object: Node): boolean {
    const record = this.#boneObjects.get(object);
    if (record === undefined) return false;
    this.#boneObjects.delete(object);
    record.bone.objects.delete(object);
    if (object.parent === record.bone.mount) object.removeFromParent();
    if (record.bone.objects.size === 0) {
      record.bone.mount.removeFromParent();
      record.bone.mount.destroy();
      this.#internalNodes.delete(record.bone.mount);
      this.#boneMounts.delete(record.bone.boneId);
      const index = this.#boneMountList.indexOf(record.bone);
      if (index >= 0) this.#boneMountList.splice(index, 1);
    }
    this.#invalidate();
    return true;
  }

  writeBoneObjects(output: Node[], idOrName?: string): number {
    const boneId = idOrName === undefined ? null : this.#runtime.queryBone(idOrName).id;
    let count = 0;
    for (const record of this.#boneObjects.values()) {
      if (boneId !== null && record.bone.boneId !== boneId) continue;
      output[count] = record.object;
      count += 1;
    }
    output.length = count;
    return count;
  }

  addSlotObject(
    slotIdOrName: string,
    object: Node,
    placementOrOptions: CaneCocosSlotPlacementV1 | CaneCocosSlotObjectOptionsV1 = "after",
  ): Node {
    this.#requireAlive("cocosAddSlotObject");
    this.#assertForeignObject(object, "cocosAddSlotObject");
    const options = normalizeSlotOptionsV1(placementOrOptions);
    const slotId = this.#runtime.querySlot(slotIdOrName).id;
    this.#ensureCatalog();
    const boneId = this.#slotBoneById.get(slotId);
    if (boneId === undefined) {
      throw new RuntimeErrorV1("notFound", "cocosAddSlotObject", "Slot Bone is unavailable.", {
        entityId: slotId,
      });
    }
    const visibleWhenAttachmentIds = resolveVisibleAttachmentsV1(
      this.#player,
      slotId,
      options.visibleWhenAttachment,
    );
    this.removeBoneObject(object);
    this.removeSlotObject(object);

    const root = new Node(`CaneSlot:${slotId}:${options.placement}`);
    root.addComponent(UITransform);
    const graphics = root.addComponent(Graphics);
    const mask = root.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    mask.enabled = false;
    const opacity = root.addComponent(UIOpacity);
    const mount = new Node(`CaneSlotMount:${slotId}`);
    mount.addComponent(UITransform);
    const skew = mount.addComponent(UISkew);
    skew.rotational = false;
    root.addChild(mount);
    mount.addChild(object);
    root.active = false;
    this.#host.addChild(root);
    this.#internalNodes.add(root);
    this.#internalNodes.add(mount);

    const record: SlotObjectRecordV1 = {
      object,
      slotId,
      boneId,
      placement: options.placement,
      followAttachmentVisibility: options.followAttachmentVisibility,
      visibleWhenAttachmentIds,
      inheritSlotAlpha: options.inheritSlotAlpha,
      clipping: options.clipping,
      root,
      mount,
      skew,
      opacity,
      mask,
      graphics,
      channels: createChannelsV1(),
      attachmentId: null,
      slotAlpha: 1,
      active: false,
      clip: null,
    };
    this.#slotObjects.set(object, record);
    this.#slotObjectList.push(record);
    this.#slotRoots.add(root);
    this.#slotList(slotId, options.placement, true).push(record);
    this.apply(this.#player.currentFrame);
    this.#invalidate();
    return object;
  }

  getSlotObject(
    slotIdOrName: string,
    placement: CaneCocosSlotPlacementV1 = "after",
    index = 0,
  ): Node | null {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new RuntimeErrorV1("invalidArgument", "cocosGetSlotObject", "index must be non-negative.");
    }
    const slotId = this.#runtime.querySlot(slotIdOrName).id;
    return this.#slotList(slotId, placement, false)?.[index]?.object ?? null;
  }

  querySlotObject(object: Node): CaneCocosSlotObjectStateV1 | null {
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

  writeSlotObjects(output: Node[], slotIdOrName?: string): number {
    const slotId = slotIdOrName === undefined ? null : this.#runtime.querySlot(slotIdOrName).id;
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

  removeSlotObject(object: Node): boolean {
    const record = this.#slotObjects.get(object);
    if (record === undefined) return false;
    this.#removeSlotRecord(record, true);
    return true;
  }

  removeSlotObjects(slotIdOrName?: string): number {
    const slotId = slotIdOrName === undefined ? null : this.#runtime.querySlot(slotIdOrName).id;
    let removed = 0;
    for (let index = this.#slotObjectList.length - 1; index >= 0; index -= 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined || (slotId !== null && record.slotId !== slotId)) continue;
      this.#removeSlotRecord(record, false);
      removed += 1;
    }
    if (removed > 0) {
      this.apply(this.#player.currentFrame);
      this.#invalidate();
    }
    return removed;
  }

  apply(frame: RuntimeFrameV1): void {
    if (this.#destroyed) return;
    this.#ensureCatalog();
    this.#boneFrameById.clear();
    for (let index = 0; index < frame.bones.length; index += 1) {
      const bone = frame.bones[index];
      if (bone !== undefined) this.#boneFrameById.set(bone.id, bone);
    }
    for (let index = 0; index < this.#boneMountList.length; index += 1) {
      const bone = this.#boneMountList[index];
      if (bone !== undefined) this.#updateBoneMount(bone);
    }
    this.#player.writeDrawOrderSlotIds(this.#drawOrderSlotIds);
    this.#attachmentIndexBySlotId.clear();
    for (let index = 0; index < frame.renderPacket.attachments.length; index += 1) {
      const attachment = frame.renderPacket.attachments[index];
      if (attachment !== undefined) this.#attachmentIndexBySlotId.set(attachment.slotId, index);
    }
    this.#prepareSlotObjects();
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record !== undefined) this.#updateSlotMount(record);
    }
    this.#composeSceneEntries(frame);
    this.#stats.boneObjects = this.#boneObjects.size;
    this.#stats.slotObjects = this.#slotObjects.size;
  }

  writeStats<T extends MutableFollowerStatsV1>(output: T): T {
    output.boneObjects = this.#stats.boneObjects;
    output.slotObjects = this.#stats.slotObjects;
    output.activeSlotObjects = this.#stats.activeSlotObjects;
    output.maskedSlotObjects = this.#stats.maskedSlotObjects;
    output.clippingMaskVertexWrites = this.#stats.clippingMaskVertexWrites;
    return output;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (let index = this.#slotObjectList.length - 1; index >= 0; index -= 1) {
      const record = this.#slotObjectList[index];
      if (record !== undefined) this.#removeSlotRecord(record, false);
    }
    for (const record of this.#boneObjects.values()) {
      if (record.object.parent === record.bone.mount) record.object.removeFromParent();
    }
    this.#boneObjects.clear();
    for (let index = 0; index < this.#boneMountList.length; index += 1) {
      const bone = this.#boneMountList[index];
      if (bone === undefined) continue;
      bone.mount.removeFromParent();
      bone.mount.destroy();
    }
    this.#boneMounts.clear();
    this.#boneMountList.length = 0;
    this.#internalNodes.clear();
    this.#sceneEntries.length = 0;
    this.#sceneEntryPool.length = 0;
  }

  #prepareSlotObjects(): void {
    this.#beforeClipBySlotId.clear();
    this.#afterClipBySlotId.clear();
    let activeClip: RuntimeClippingGeometryV1 | null = null;
    for (let index = 0; index < this.#drawOrderSlotIds.length; index += 1) {
      const slotId = this.#drawOrderSlotIds[index];
      if (slotId === undefined) continue;
      const attachmentId = this.#player.querySlotAttachmentId(slotId);
      if (attachmentId === null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
      this.#beforeClipBySlotId.set(slotId, activeClip);
      if (attachmentId !== null && this.#clippingAttachmentIds.has(attachmentId)) {
        activeClip = this.#player.queryClippingGeometry(attachmentId);
      }
      this.#afterClipBySlotId.set(slotId, activeClip);
      if (attachmentId !== null && clippingEndsAtSlotV1(activeClip, slotId)) activeClip = null;
    }

    this.#stats.activeSlotObjects = 0;
    this.#stats.maskedSlotObjects = 0;
    this.#stats.clippingMaskVertexWrites = 0;
    for (let index = 0; index < this.#slotObjectList.length; index += 1) {
      const record = this.#slotObjectList[index];
      if (record === undefined) continue;
      record.attachmentId = this.#player.querySlotAttachmentId(record.slotId);
      record.slotAlpha = this.#player.querySlotAlpha(record.slotId);
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
      if (record.active) {
        this.#stats.activeSlotObjects += 1;
        if (record.clip !== null) {
          this.#stats.maskedSlotObjects += 1;
          for (let polygonIndex = 0; polygonIndex < record.clip.convexPolygonsXy.length; polygonIndex += 1) {
            const polygon = record.clip.convexPolygonsXy[polygonIndex];
            if (polygon !== undefined) this.#stats.clippingMaskVertexWrites += polygon.length / 2;
          }
        }
      }
    }
  }

  #composeSceneEntries(frame: RuntimeFrameV1): void {
    let count = 0;
    let attachmentCursor = 0;
    for (let slotIndex = 0; slotIndex < this.#drawOrderSlotIds.length; slotIndex += 1) {
      const slotId = this.#drawOrderSlotIds[slotIndex];
      if (slotId === undefined) continue;
      const attachmentIndex = this.#attachmentIndexBySlotId.get(slotId);
      const hasAttachment = attachmentIndex !== undefined;
      if (hasAttachment && attachmentIndex !== attachmentCursor) {
        throw new RuntimeErrorV1(
          "validationFailed",
          "cocosComposeSceneEntries",
          "RenderPacket order differs from the published Slot draw order.",
          { entityId: slotId },
        );
      }
      count = this.#appendActiveSlotObjects(
        this.#slotBeforeById.get(slotId),
        attachmentCursor,
        frame.sequence,
        count,
      );
      if (hasAttachment) attachmentCursor += 1;
      count = this.#appendActiveSlotObjects(
        this.#slotAfterById.get(slotId),
        attachmentCursor,
        frame.sequence,
        count,
      );
    }
    if (attachmentCursor !== frame.renderPacket.attachments.length) {
      throw new RuntimeErrorV1(
        "validationFailed",
        "cocosComposeSceneEntries",
        "RenderPacket references a Slot absent from the published draw order.",
      );
    }
    const children = this.#host.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined || this.#slotRoots.has(child) || !child.active) continue;
      count = this.#writeSceneEntry(count, attachmentCursor, child, "child", frame.sequence);
    }
    this.#sceneEntries.length = count;
  }

  #appendActiveSlotObjects(
    records: readonly SlotObjectRecordV1[] | undefined,
    cursor: number,
    sequence: number,
    count: number,
  ): number {
    if (records === undefined) return count;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined || !record.active) continue;
      count = this.#writeSceneEntry(count, cursor, record.root, "slot", sequence);
    }
    return count;
  }

  #writeSceneEntry(
    index: number,
    cursor: number,
    node: Node,
    source: CaneCocosSceneNodeEntryV1["source"],
    sequence: number,
  ): number {
    let entry = this.#sceneEntryPool[index];
    if (entry === undefined) {
      entry = { cursor, node, source, lastSeenSequence: sequence };
      this.#sceneEntryPool[index] = entry;
    } else {
      entry.cursor = cursor;
      entry.node = node;
      entry.source = source;
      entry.lastSeenSequence = sequence;
    }
    this.#sceneEntries[index] = entry;
    return index + 1;
  }

  #updateBoneMount(bone: BoneMountV1): void {
    const frame = this.#boneFrameById.get(bone.boneId);
    if (frame === undefined) {
      bone.mount.active = false;
      return;
    }
    bone.mount.active = true;
    applyAffineToNodeV1(frame.matrix, bone.mount, bone.skew, bone.channels);
  }

  #updateSlotMount(record: SlotObjectRecordV1): void {
    const frame = this.#boneFrameById.get(record.boneId);
    if (frame === undefined || !record.active) {
      record.root.active = false;
      if (record.mask.enabled) record.mask.enabled = false;
      return;
    }
    record.root.active = true;
    record.opacity.opacity = record.inheritSlotAlpha
      ? Math.max(0, Math.min(255, Math.round(record.slotAlpha * 255)))
      : 255;
    applyAffineToNodeV1(frame.matrix, record.mount, record.skew, record.channels);
    this.#applySlotMask(record);
  }

  #applySlotMask(record: SlotObjectRecordV1): void {
    const clip = record.clip;
    if (clip === null) {
      if (record.mask.enabled) record.mask.enabled = false;
      record.graphics.clear();
      return;
    }
    if (!record.mask.enabled) record.mask.enabled = true;
    record.mask.inverted = clip.inverse;
    const graphics = record.graphics;
    graphics.clear();
    let hasPolygon = false;
    for (let polygonIndex = 0; polygonIndex < clip.convexPolygonsXy.length; polygonIndex += 1) {
      const polygon = clip.convexPolygonsXy[polygonIndex];
      if (polygon === undefined || polygon.length < 6) continue;
      graphics.moveTo(polygon[0] ?? 0, polygon[1] ?? 0);
      for (let offset = 2; offset < polygon.length; offset += 2) {
        graphics.lineTo(polygon[offset] ?? 0, polygon[offset + 1] ?? 0);
      }
      graphics.close();
      hasPolygon = true;
    }
    if (hasPolygon) graphics.fill();
    else record.mask.enabled = false;
  }

  #removeSlotRecord(record: SlotObjectRecordV1, reproject: boolean): void {
    this.#slotObjects.delete(record.object);
    const recordIndex = this.#slotObjectList.indexOf(record);
    if (recordIndex >= 0) this.#slotObjectList.splice(recordIndex, 1);
    const records = this.#slotList(record.slotId, record.placement, false);
    if (records !== undefined) {
      const index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
      if (records.length === 0) {
        (record.placement === "before" ? this.#slotBeforeById : this.#slotAfterById)
          .delete(record.slotId);
      }
    }
    this.#slotRoots.delete(record.root);
    this.#internalNodes.delete(record.root);
    this.#internalNodes.delete(record.mount);
    if (record.object.parent === record.mount) record.object.removeFromParent();
    record.root.removeFromParent();
    record.root.destroy();
    if (reproject && !this.#destroyed) {
      this.apply(this.#player.currentFrame);
      this.#invalidate();
    }
  }

  #slotList(slotId: string, placement: CaneCocosSlotPlacementV1, create: true): SlotObjectRecordV1[];
  #slotList(
    slotId: string,
    placement: CaneCocosSlotPlacementV1,
    create: false,
  ): SlotObjectRecordV1[] | undefined;
  #slotList(
    slotId: string,
    placement: CaneCocosSlotPlacementV1,
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
    if (this.#catalogIdentity === this.#player.data) return;
    this.#catalogIdentity = this.#player.data;
    this.#slotBoneById.clear();
    this.#clippingAttachmentIds.clear();
    for (const slot of this.#player.data.document.slots) this.#slotBoneById.set(slot.id, slot.boneId);
    for (const attachment of this.#player.data.document.attachments) {
      if (attachment.type === "clipping") this.#clippingAttachmentIds.add(attachment.id);
    }
  }

  #assertForeignObject(object: Node, operation: string): void {
    if (!(object instanceof Node) || !object.isValid || object === this.#host) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        operation,
        "object must be a live foreign Cocos Node.",
      );
    }
    if (this.#internalNodes.has(object)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "Managed Cane mount Nodes cannot be reattached.");
    }
    let ancestor: Node | null = this.#host;
    while (ancestor !== null) {
      if (ancestor === object) {
        throw new RuntimeErrorV1(
          "invalidArgument",
          operation,
          "Attaching an ancestor would create a scene graph cycle.",
        );
      }
      ancestor = ancestor.parent;
    }
  }

  #requireAlive(operation: string): void {
    if (this.#destroyed) {
      throw new RuntimeErrorV1("invalidState", operation, "Follower manager is destroyed.");
    }
  }
}

function normalizeSlotOptionsV1(
  value: CaneCocosSlotPlacementV1 | CaneCocosSlotObjectOptionsV1,
): NormalizedSlotObjectOptionsV1 {
  const options = typeof value === "string" ? { placement: value } : value;
  const placement = options.placement ?? "after";
  const clipping = options.clipping ?? "inherit";
  if ((placement !== "before" && placement !== "after")
    || (clipping !== "inherit" && clipping !== "none")) {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "cocosAddSlotObject",
      "Invalid Slot placement or clipping option.",
    );
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
  const values = typeof filter === "string" ? [filter] : filter;
  const resolved: string[] = [];
  for (const value of values) {
    const attachment = player.data.document.attachments.find(
      (candidate) => candidate.slotId === slotId
        && (candidate.id === value || candidate.name === value),
    );
    if (attachment === undefined) {
      throw new RuntimeErrorV1(
        "notFound",
        "cocosAddSlotObject",
        `Unknown Slot attachment '${value}'.`,
        { entityId: value },
      );
    }
    if (!resolved.includes(attachment.id)) resolved.push(attachment.id);
  }
  return Object.freeze(resolved);
}

function createChannelsV1(): CaneCocosAffineNodeChannelsV1 {
  return { ...IDENTITY_CHANNELS_V1 };
}

function applyAffineToNodeV1(
  affine: RuntimeBoneFrameV1["matrix"],
  node: Node,
  skew: UISkew,
  scratch: CaneCocosAffineNodeChannelsV1,
): void {
  const channels = writeCaneAffineToCocosNodeChannelsV1(affine, scratch);
  node.setPosition(channels.x, channels.y, 0);
  node.setRotationFromEuler(0, 0, channels.rotationDegrees);
  node.setScale(channels.scaleX, channels.scaleY, 1);
  skew.setSkew(channels.skewXDegrees, channels.skewYDegrees);
}

function clippingEndsAtSlotV1(clip: RuntimeClippingGeometryV1 | null, slotId: string): boolean {
  return clip !== null && clip.endSlotId === slotId;
}
