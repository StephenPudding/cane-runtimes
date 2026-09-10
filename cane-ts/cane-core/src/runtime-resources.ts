import type {
  AffineV1,
  AtlasDocumentV1,
  AtlasRegionV1,
  RuntimeAttachmentV1,
  RuntimeBoundingBoxAttachmentV1,
  RuntimeClippingAttachmentV1,
  RuntimeImageV1,
  RuntimeMeshAttachmentV1,
  RuntimeOverlayAtlasV1,
  RuntimePathAttachmentV1,
  RuntimePointAttachmentV1,
  RuntimeRegionAttachmentV1,
  RuntimeResourceChangesV1,
  RuntimeResourceOperationV1,
  RuntimeResourceSnapshotV1,
  RuntimeSkinAttachmentV1,
  RuntimeSkinV1,
  RuntimeWeightV1,
} from "./contracts.js";
import { RuntimeErrorV1 } from "./errors.js";
import { deepFreeze } from "./internal.js";

export type RuntimeRegionAttachmentCreateV1 = Omit<RuntimeRegionAttachmentV1, "type">;
export type RuntimeMeshAttachmentCreateV1 = Omit<RuntimeMeshAttachmentV1, "type">;
export type RuntimePathAttachmentCreateV1 = Omit<RuntimePathAttachmentV1, "type">;
export type RuntimePointAttachmentCreateV1 = Omit<RuntimePointAttachmentV1, "type">;
export type RuntimeBoundingBoxAttachmentCreateV1 = Omit<RuntimeBoundingBoxAttachmentV1, "type">;
export type RuntimeClippingAttachmentCreateV1 = Omit<RuntimeClippingAttachmentV1, "type">;

export interface RuntimeSkinBuilderOptionsV1 {
  readonly id: string;
  readonly name?: string;
  readonly boneIds?: readonly string[];
  readonly constraintIds?: readonly string[];
  readonly export?: boolean;
}

export interface RuntimeResourceStateV1 {
  readonly images: Map<string, RuntimeImageV1>;
  readonly atlases: Map<string, RuntimeOverlayAtlasV1>;
  readonly attachments: Map<string, RuntimeAttachmentV1>;
  readonly skins: Map<string, RuntimeSkinV1>;
}

/** Detached mutable builder. Installed snapshots are copied and cannot be mutated through it. */
export class RuntimeSkinBuilderV1 {
  readonly #id: string;
  #name: string;
  #export: boolean;
  readonly #attachments = new Map<string, RuntimeSkinAttachmentV1>();
  readonly #boneIds: string[] = [];
  readonly #constraintIds: string[] = [];
  #disposed = false;

  constructor(options: RuntimeSkinBuilderOptionsV1) {
    if (options === null || typeof options !== "object") {
      throw invalidResourceArgumentV1("createRuntimeSkin", "options", "options must be an object.");
    }
    this.#id = resourceIdV1(options.id, "createRuntimeSkin", "id");
    this.#name = resourceNameV1(options.name ?? options.id, "createRuntimeSkin", "name");
    this.#export = options.export ?? false;
    if (typeof this.#export !== "boolean") {
      throw invalidResourceArgumentV1("createRuntimeSkin", "export", "export must be boolean.", this.#id);
    }
    appendUniqueIdsV1(this.#boneIds, options.boneIds ?? [], "createRuntimeSkin", "boneIds");
    appendUniqueIdsV1(this.#constraintIds, options.constraintIds ?? [], "createRuntimeSkin", "constraintIds");
  }

  static fromSkin(
    skin: RuntimeSkinV1,
    options: Partial<RuntimeSkinBuilderOptionsV1> & Pick<RuntimeSkinBuilderOptionsV1, "id">,
  ): RuntimeSkinBuilderV1 {
    if (skin === null || typeof skin !== "object") {
      throw invalidResourceArgumentV1("copyRuntimeSkin", "skin", "skin must be an object.");
    }
    const builder = new RuntimeSkinBuilderV1({
      id: options.id,
      name: options.name ?? skin.name,
      boneIds: options.boneIds ?? skin.boneIds,
      constraintIds: options.constraintIds ?? skin.constraintIds,
      export: options.export ?? skin.export,
    });
    return builder.addSkin(skin);
  }

  get id(): string {
    return this.#id;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  setName(name: string): this {
    this.#assertLive("setRuntimeSkinName");
    this.#name = resourceNameV1(name, "setRuntimeSkinName", "name");
    return this;
  }

  setExport(value: boolean): this {
    this.#assertLive("setRuntimeSkinExport");
    if (typeof value !== "boolean") {
      throw invalidResourceArgumentV1("setRuntimeSkinExport", "export", "export must be boolean.", this.#id);
    }
    this.#export = value;
    return this;
  }

  setAttachment(slotId: string, name: string | null, attachmentId: string | null): this {
    this.#assertLive("setRuntimeSkinAttachment");
    const slot = resourceIdV1(slotId, "setRuntimeSkinAttachment", "slotId");
    const keyName = name === null ? null : resourceNameV1(name, "setRuntimeSkinAttachment", "name");
    const resolvedAttachment = attachmentId === null
      ? null
      : resourceIdV1(attachmentId, "setRuntimeSkinAttachment", "attachmentId");
    const mapping = deepFreeze<RuntimeSkinAttachmentV1>({
      slotId: slot,
      attachmentId: resolvedAttachment,
      name: keyName,
    });
    this.#attachments.set(skinAttachmentKeyV1(slot, keyName), mapping);
    return this;
  }

  /** Convenience spelling for the common one-key-per-Slot case. */
  setSlotAttachment(slotId: string, attachmentId: string | null, name: string | null = null): this {
    return this.setAttachment(slotId, name, attachmentId);
  }

  getAttachment(slotId: string, name: string | null): RuntimeSkinAttachmentV1 | null {
    this.#assertLive("queryRuntimeSkinAttachment");
    const slot = resourceIdV1(slotId, "queryRuntimeSkinAttachment", "slotId");
    const keyName = name === null ? null : resourceNameV1(name, "queryRuntimeSkinAttachment", "name");
    const mapping = this.#attachments.get(skinAttachmentKeyV1(slot, keyName));
    return mapping === undefined ? null : deepFreeze({ ...mapping });
  }

  removeAttachment(slotId: string, name: string | null): boolean {
    this.#assertLive("removeRuntimeSkinAttachment");
    const slot = resourceIdV1(slotId, "removeRuntimeSkinAttachment", "slotId");
    const keyName = name === null ? null : resourceNameV1(name, "removeRuntimeSkinAttachment", "name");
    return this.#attachments.delete(skinAttachmentKeyV1(slot, keyName));
  }

  addBone(boneId: string): this {
    this.#assertLive("addRuntimeSkinBone");
    pushUniqueV1(this.#boneIds, resourceIdV1(boneId, "addRuntimeSkinBone", "boneId"));
    return this;
  }

  removeBone(boneId: string): boolean {
    this.#assertLive("removeRuntimeSkinBone");
    return removeValueV1(this.#boneIds, resourceIdV1(boneId, "removeRuntimeSkinBone", "boneId"));
  }

  addConstraint(constraintId: string): this {
    this.#assertLive("addRuntimeSkinConstraint");
    pushUniqueV1(
      this.#constraintIds,
      resourceIdV1(constraintId, "addRuntimeSkinConstraint", "constraintId"),
    );
    return this;
  }

  removeConstraint(constraintId: string): boolean {
    this.#assertLive("removeRuntimeSkinConstraint");
    return removeValueV1(
      this.#constraintIds,
      resourceIdV1(constraintId, "removeRuntimeSkinConstraint", "constraintId"),
    );
  }

  /** Merges another Skin in source order; matching Slot/name mappings are replaced. */
  addSkin(skin: RuntimeSkinV1): this {
    this.#assertLive("mergeRuntimeSkin");
    if (skin === null || typeof skin !== "object" || !Array.isArray(skin.attachments)) {
      throw invalidResourceArgumentV1("mergeRuntimeSkin", "skin", "skin must be a RuntimeSkinV1 object.");
    }
    for (const mapping of skin.attachments) {
      this.setAttachment(mapping.slotId, mapping.name, mapping.attachmentId);
    }
    appendUniqueIdsV1(this.#boneIds, skin.boneIds, "mergeRuntimeSkin", "boneIds");
    appendUniqueIdsV1(this.#constraintIds, skin.constraintIds, "mergeRuntimeSkin", "constraintIds");
    return this;
  }

  clear(): this {
    this.#assertLive("clearRuntimeSkin");
    this.#attachments.clear();
    this.#boneIds.length = 0;
    this.#constraintIds.length = 0;
    return this;
  }

  snapshot(): RuntimeSkinV1 {
    this.#assertLive("snapshotRuntimeSkin");
    return cloneRuntimeSkinV1({
      id: this.#id,
      name: this.#name,
      attachments: [...this.#attachments.values()],
      boneIds: this.#boneIds,
      constraintIds: this.#constraintIds,
      export: this.#export,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#attachments.clear();
    this.#boneIds.length = 0;
    this.#constraintIds.length = 0;
    this.#disposed = true;
  }

  #assertLive(operation: string): void {
    if (this.#disposed) {
      throw new RuntimeErrorV1("invalidState", operation, "Runtime Skin builder is disposed.", {
        entityId: this.#id,
      });
    }
  }
}

/** Creates detached typed attachment values; a Player transaction performs full reference validation. */
export class RuntimeAttachmentFactoryV1 {
  region(input: RuntimeRegionAttachmentCreateV1): RuntimeRegionAttachmentV1 {
    return this.#create({ ...input, type: "region" });
  }

  mesh(input: RuntimeMeshAttachmentCreateV1): RuntimeMeshAttachmentV1 {
    return this.#create({ ...input, type: "mesh" });
  }

  path(input: RuntimePathAttachmentCreateV1): RuntimePathAttachmentV1 {
    return this.#create({ ...input, type: "path" });
  }

  point(input: RuntimePointAttachmentCreateV1): RuntimePointAttachmentV1 {
    return this.#create({ ...input, type: "point" });
  }

  boundingBox(input: RuntimeBoundingBoxAttachmentCreateV1): RuntimeBoundingBoxAttachmentV1 {
    return this.#create({ ...input, type: "boundingbox" });
  }

  clipping(input: RuntimeClippingAttachmentCreateV1): RuntimeClippingAttachmentV1 {
    return this.#create({ ...input, type: "clipping" });
  }

  copy<Attachment extends RuntimeAttachmentV1>(
    source: Attachment,
    patch: Partial<Omit<Attachment, "type">> = {},
  ): Attachment {
    if (source === null || typeof source !== "object") {
      throw invalidResourceArgumentV1("copyRuntimeAttachment", "source", "source must be an attachment.");
    }
    return this.#create({ ...source, ...patch, type: source.type } as Attachment);
  }

  #create<Attachment extends RuntimeAttachmentV1>(attachment: Attachment): Attachment {
    assertAttachmentHeaderV1(attachment, "createRuntimeAttachment");
    return cloneRuntimeAttachmentV1(attachment) as Attachment;
  }
}

/** Fluent cold-path builder for one atomic Player resource transaction. */
export class RuntimeResourceTransactionV1 {
  readonly #operations: RuntimeResourceOperationV1[] = [];

  get operations(): readonly RuntimeResourceOperationV1[] {
    return this.#operations;
  }

  upsertImage(image: RuntimeImageV1): this {
    this.#operations.push({ operation: "upsertImage", image });
    return this;
  }

  removeImage(imageId: string): this {
    this.#operations.push({ operation: "removeImage", imageId });
    return this;
  }

  upsertAtlas(resource: RuntimeOverlayAtlasV1): this {
    this.#operations.push({ operation: "upsertAtlas", resource });
    return this;
  }

  removeAtlas(atlasId: string): this {
    this.#operations.push({ operation: "removeAtlas", atlasId });
    return this;
  }

  upsertAttachment(attachment: RuntimeAttachmentV1): this {
    this.#operations.push({ operation: "upsertAttachment", attachment });
    return this;
  }

  removeAttachment(attachmentId: string): this {
    this.#operations.push({ operation: "removeAttachment", attachmentId });
    return this;
  }

  upsertSkin(skin: RuntimeSkinV1 | RuntimeSkinBuilderV1): this {
    this.#operations.push({
      operation: "upsertSkin",
      // Engine bundlers may retain two equivalent ESM instances of Core when
      // workspace/link dependencies resolve through different real paths.
      // Do not make this public boundary depend only on realm-local identity.
      skin: snapshotRuntimeSkinInputV1(skin),
    });
    return this;
  }

  removeSkin(skinId: string): this {
    this.#operations.push({ operation: "removeSkin", skinId });
    return this;
  }

  clear(): this {
    this.#operations.length = 0;
    return this;
  }

  snapshot(): RuntimeResourceChangesV1 {
    return deepFreeze({ operations: this.#operations.map(cloneRuntimeResourceOperationV1) });
  }
}

function snapshotRuntimeSkinInputV1(
  skin: RuntimeSkinV1 | RuntimeSkinBuilderV1,
): RuntimeSkinV1 {
  if (skin instanceof RuntimeSkinBuilderV1) return skin.snapshot();
  const snapshot = (skin as RuntimeSkinV1 & { readonly snapshot?: unknown }).snapshot;
  if (typeof snapshot === "function") {
    return (snapshot as (this: unknown) => RuntimeSkinV1).call(skin);
  }
  return skin;
}

export function createRuntimeResourceStateV1(
  snapshot: RuntimeResourceSnapshotV1 | null = null,
  operation = "createPlayer",
): RuntimeResourceStateV1 {
  const state: RuntimeResourceStateV1 = {
    images: new Map(),
    atlases: new Map(),
    attachments: new Map(),
    skins: new Map(),
  };
  if (snapshot === null) return state;
  if (typeof snapshot !== "object") {
    throw invalidResourceArgumentV1(operation, "runtimeResources", "runtimeResources must be an object.");
  }
  installUniqueSnapshotValuesV1(snapshot.images, state.images, (value) => value.imageId, "images", operation, cloneRuntimeImageV1);
  installUniqueSnapshotValuesV1(snapshot.atlases, state.atlases, (value) => value.atlas.atlasId, "atlases", operation, cloneRuntimeOverlayAtlasV1);
  installUniqueSnapshotValuesV1(snapshot.attachments, state.attachments, (value) => value.id, "attachments", operation, cloneRuntimeAttachmentV1);
  installUniqueSnapshotValuesV1(snapshot.skins, state.skins, (value) => value.id, "skins", operation, cloneRuntimeSkinV1);
  return state;
}

export function cloneRuntimeResourceStateV1(source: RuntimeResourceStateV1): RuntimeResourceStateV1 {
  return {
    images: new Map(source.images),
    atlases: new Map(source.atlases),
    attachments: new Map(source.attachments),
    skins: new Map(source.skins),
  };
}

export function stageRuntimeResourceChangesV1(
  source: RuntimeResourceStateV1,
  changes: RuntimeResourceChangesV1,
  operation = "applyRuntimeResources",
): RuntimeResourceStateV1 {
  if (changes === null || typeof changes !== "object" || !Array.isArray(changes.operations)) {
    throw invalidResourceArgumentV1(operation, "operations", "changes.operations must be an array.");
  }
  const next = cloneRuntimeResourceStateV1(source);
  for (let index = 0; index < changes.operations.length; index += 1) {
    const candidate = changes.operations[index];
    if (candidate === undefined || candidate === null || typeof candidate !== "object") {
      throw invalidResourceArgumentV1(operation, `operations[${index}]`, "Resource operation must be an object.");
    }
    const field = `operations[${index}]`;
    switch (candidate.operation) {
      case "upsertImage": {
        const image = cloneRuntimeImageV1(candidate.image);
        next.images.set(resourceIdV1(image.imageId, operation, `${field}.image.imageId`), image);
        break;
      }
      case "removeImage":
        next.images.delete(resourceIdV1(candidate.imageId, operation, `${field}.imageId`));
        break;
      case "upsertAtlas": {
        const resource = cloneRuntimeOverlayAtlasV1(candidate.resource);
        const atlasId = resourceIdV1(resource.atlas.atlasId, operation, `${field}.resource.atlas.atlasId`);
        if (resource.reference.atlasId !== atlasId) {
          throw new RuntimeErrorV1("validationFailed", operation, "Atlas reference and document IDs differ.", {
            field: `${field}.resource.reference.atlasId`,
            entityId: atlasId,
          });
        }
        next.atlases.set(atlasId, resource);
        break;
      }
      case "removeAtlas":
        next.atlases.delete(resourceIdV1(candidate.atlasId, operation, `${field}.atlasId`));
        break;
      case "upsertAttachment": {
        const attachment = cloneRuntimeAttachmentV1(candidate.attachment);
        assertAttachmentHeaderV1(attachment, operation, `${field}.attachment`);
        next.attachments.set(attachment.id, attachment);
        break;
      }
      case "removeAttachment":
        next.attachments.delete(resourceIdV1(candidate.attachmentId, operation, `${field}.attachmentId`));
        break;
      case "upsertSkin": {
        const skin = cloneRuntimeSkinV1(candidate.skin);
        next.skins.set(resourceIdV1(skin.id, operation, `${field}.skin.id`), skin);
        break;
      }
      case "removeSkin":
        next.skins.delete(resourceIdV1(candidate.skinId, operation, `${field}.skinId`));
        break;
      default:
        throw invalidResourceArgumentV1(operation, `${field}.operation`, "Unknown resource operation.");
    }
  }
  return next;
}

export function runtimeResourceSnapshotV1(state: RuntimeResourceStateV1): RuntimeResourceSnapshotV1 {
  return deepFreeze({
    images: Array.from(state.images.values(), cloneRuntimeImageV1),
    atlases: Array.from(state.atlases.values(), cloneRuntimeOverlayAtlasV1),
    attachments: Array.from(state.attachments.values(), cloneRuntimeAttachmentV1),
    skins: Array.from(state.skins.values(), cloneRuntimeSkinV1),
  });
}

export function runtimeResourceStateEmptyV1(state: RuntimeResourceStateV1): boolean {
  return state.images.size === 0
    && state.atlases.size === 0
    && state.attachments.size === 0
    && state.skins.size === 0;
}

export function cloneRuntimeAttachmentV1(attachment: RuntimeAttachmentV1): RuntimeAttachmentV1 {
  assertAttachmentHeaderV1(attachment, "cloneRuntimeAttachment");
  switch (attachment.type) {
    case "region":
      return deepFreeze({ ...attachment, sequence: cloneSequenceV1(attachment.sequence) });
    case "mesh":
      return deepFreeze({
        ...attachment,
        sequence: cloneSequenceV1(attachment.sequence),
        vertices: [...attachment.vertices],
        uvs: [...attachment.uvs],
        indices: [...attachment.indices],
        weights: cloneWeightsV1(attachment.weights),
        bindInverses: cloneBindInversesV1(attachment.bindInverses),
        edges: attachment.edges === null ? null : [...attachment.edges],
        hull: attachment.hull === null ? null : [...attachment.hull],
        link: attachment.link === null ? null : { ...attachment.link },
      });
    case "path":
      return deepFreeze({
        ...attachment,
        lengths: [...attachment.lengths],
        vertices: [...attachment.vertices],
        weights: cloneWeightsV1(attachment.weights),
        bindInverses: cloneBindInversesV1(attachment.bindInverses),
      });
    case "point":
      return deepFreeze({ ...attachment });
    case "boundingbox":
      return deepFreeze({
        ...attachment,
        vertices: [...attachment.vertices],
        weights: cloneWeightsV1(attachment.weights),
        bindInverses: cloneBindInversesV1(attachment.bindInverses),
      });
    case "clipping":
      return deepFreeze({
        ...attachment,
        vertices: [...attachment.vertices],
        weights: cloneWeightsV1(attachment.weights),
        bindInverses: cloneBindInversesV1(attachment.bindInverses),
      });
  }
}

export function cloneRuntimeSkinV1(skin: RuntimeSkinV1): RuntimeSkinV1 {
  if (skin === null || typeof skin !== "object") {
    throw invalidResourceArgumentV1("cloneRuntimeSkin", "skin", "skin must be an object.");
  }
  return deepFreeze({
    ...skin,
    attachments: skin.attachments.map((mapping) => ({ ...mapping })),
    boneIds: [...skin.boneIds],
    constraintIds: [...skin.constraintIds],
  });
}

function cloneRuntimeImageV1(image: RuntimeImageV1): RuntimeImageV1 {
  if (image === null || typeof image !== "object") {
    throw invalidResourceArgumentV1("cloneRuntimeImage", "image", "image must be an object.");
  }
  resourceIdV1(image.imageId, "cloneRuntimeImage", "image.imageId");
  resourceNameV1(image.name, "cloneRuntimeImage", "image.name");
  // Rust/JSON projections omit absent Option fields while the in-process TS
  // DTO uses explicit nulls. Normalize both spellings at this boundary.
  const path = image.path ?? null;
  if (path !== null) runtimeResourcePathV1(path, "cloneRuntimeImage", "image.path");
  return deepFreeze({
    ...image,
    path,
    atlasId: image.atlasId ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  });
}

function cloneRuntimeOverlayAtlasV1(resource: RuntimeOverlayAtlasV1): RuntimeOverlayAtlasV1 {
  if (resource === null || typeof resource !== "object" || resource.reference === null
    || typeof resource.reference !== "object" || resource.atlas === null || typeof resource.atlas !== "object") {
    throw invalidResourceArgumentV1("cloneRuntimeAtlas", "resource", "resource must contain an Atlas reference and document.");
  }
  resourceIdV1(resource.reference.atlasId, "cloneRuntimeAtlas", "resource.reference.atlasId");
  runtimeResourcePathV1(resource.reference.path, "cloneRuntimeAtlas", "resource.reference.path");
  resourceIdV1(resource.atlas.atlasId, "cloneRuntimeAtlas", "resource.atlas.atlasId");
  for (let index = 0; index < resource.atlas.pages.length; index += 1) {
    const page = resource.atlas.pages[index];
    if (page === undefined) continue;
    resourceIdV1(page.pageId, "cloneRuntimeAtlas", `resource.atlas.pages[${index}].pageId`);
    runtimeResourcePathV1(page.image, "cloneRuntimeAtlas", `resource.atlas.pages[${index}].image`);
  }
  return deepFreeze({
    reference: { ...resource.reference },
    atlas: {
      ...resource.atlas,
      pages: resource.atlas.pages.map((page) => ({ ...page })),
      regions: resource.atlas.regions.map(cloneAtlasRegionV1),
    },
  });
}

function cloneAtlasRegionV1(region: AtlasRegionV1): AtlasRegionV1 {
  return {
    ...region,
    uvs: region.uvs.map((uv) => [uv[0], uv[1]] as [number, number]),
  };
}

function cloneRuntimeResourceOperationV1(operation: RuntimeResourceOperationV1): RuntimeResourceOperationV1 {
  switch (operation.operation) {
    case "upsertImage": return { operation: "upsertImage", image: cloneRuntimeImageV1(operation.image) };
    case "removeImage": return { ...operation };
    case "upsertAtlas": return { operation: "upsertAtlas", resource: cloneRuntimeOverlayAtlasV1(operation.resource) };
    case "removeAtlas": return { ...operation };
    case "upsertAttachment": return { operation: "upsertAttachment", attachment: cloneRuntimeAttachmentV1(operation.attachment) };
    case "removeAttachment": return { ...operation };
    case "upsertSkin": return { operation: "upsertSkin", skin: cloneRuntimeSkinV1(operation.skin) };
    case "removeSkin": return { ...operation };
  }
}

function cloneSequenceV1(sequence: RuntimeRegionAttachmentV1["sequence"]): RuntimeRegionAttachmentV1["sequence"] {
  return sequence === null ? null : { ...sequence, imageIds: [...sequence.imageIds] };
}

function cloneWeightsV1(weights: readonly (readonly RuntimeWeightV1[])[]): readonly (readonly RuntimeWeightV1[])[] {
  return weights.map((influences) => influences.map((influence) => ({ ...influence })));
}

function cloneBindInversesV1(
  bindInverses: Readonly<Record<string, AffineV1>> | null,
): Readonly<Record<string, AffineV1>> | null {
  if (bindInverses === null) return null;
  const result: Record<string, AffineV1> = {};
  for (const boneId of Object.keys(bindInverses)) {
    const affine = bindInverses[boneId];
    if (affine !== undefined) result[boneId] = { ...affine };
  }
  return result;
}

function assertAttachmentHeaderV1(
  attachment: RuntimeAttachmentV1,
  operation: string,
  field = "attachment",
): void {
  if (attachment === null || typeof attachment !== "object") {
    throw invalidResourceArgumentV1(operation, field, "attachment must be an object.");
  }
  resourceIdV1(attachment.id, operation, `${field}.id`);
  const attachmentId = attachment.id;
  resourceNameV1(attachment.name, operation, `${field}.name`);
  resourceIdV1(attachment.slotId, operation, `${field}.slotId`);
  if (attachment.type !== "region" && attachment.type !== "mesh" && attachment.type !== "path"
    && attachment.type !== "point" && attachment.type !== "boundingbox" && attachment.type !== "clipping") {
    throw invalidResourceArgumentV1(operation, `${field}.type`, "Unknown attachment type.", attachmentId);
  }
}

function installUniqueSnapshotValuesV1<Value>(
  values: readonly Value[],
  target: Map<string, Value>,
  id: (value: Value) => string,
  field: string,
  operation: string,
  clone: (value: Value) => Value,
): void {
  if (!Array.isArray(values)) {
    throw invalidResourceArgumentV1(operation, `runtimeResources.${field}`, `${field} must be an array.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw invalidResourceArgumentV1(operation, `runtimeResources.${field}[${index}]`, "Resource is unavailable.");
    }
    const cloned = clone(value);
    const key = resourceIdV1(id(cloned), operation, `runtimeResources.${field}[${index}]`);
    if (target.has(key)) {
      throw new RuntimeErrorV1("validationFailed", operation, "Runtime resource ID is duplicated.", {
        field: `runtimeResources.${field}[${index}]`,
        entityId: key,
      });
    }
    target.set(key, cloned);
  }
}

function skinAttachmentKeyV1(slotId: string, name: string | null): string {
  return `${slotId}\0${name ?? ""}`;
}

function appendUniqueIdsV1(
  target: string[],
  values: readonly string[],
  operation: string,
  field: string,
): void {
  if (!Array.isArray(values)) {
    throw invalidResourceArgumentV1(operation, field, `${field} must be an array.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    pushUniqueV1(target, resourceIdV1(value, operation, `${field}[${index}]`));
  }
}

function pushUniqueV1(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function removeValueV1(target: string[], value: string): boolean {
  const index = target.indexOf(value);
  if (index < 0) return false;
  target.splice(index, 1);
  return true;
}

function resourceIdV1(value: string, operation: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw invalidResourceArgumentV1(operation, field, `${field} must be a non-empty NUL-free string.`);
  }
  return value;
}

function resourceNameV1(value: string, operation: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw invalidResourceArgumentV1(operation, field, `${field} must be a non-empty NUL-free string.`);
  }
  return value;
}

function runtimeResourcePathV1(value: string, operation: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw invalidResourceArgumentV1(operation, field, `${field} must be a non-empty NUL-free string.`);
  }
  return value;
}

function invalidResourceArgumentV1(
  operation: string,
  field: string,
  message: string,
  entityId: string | null = null,
): RuntimeErrorV1 {
  return new RuntimeErrorV1("invalidArgument", operation, message, { field, entityId });
}
