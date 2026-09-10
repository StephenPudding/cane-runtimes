import type {
  AtlasDocumentV1,
  RuntimeAnimationV1,
  RuntimeDecodedAtlasPageSizeV1,
  RuntimeConstraintV1,
  RuntimeAttachmentV1,
  RuntimeDecodedImageSizeV1,
  RuntimeDocumentV1,
  RuntimeDecodedTextureDimensionsV1,
  RuntimeEventDefinitionV1,
  RuntimeImageV1,
  RuntimeLoadOptionsV1,
  RuntimeLoadWarningV1,
  RuntimePlayerOptionsV1,
  RuntimeProjectCatalogV1,
  RuntimeResourceSnapshotV1,
  RuntimeSkinV1,
  RuntimeSlotV1,
} from "./contracts.js";
import { RuntimeErrorV1 } from "./errors.js";
import { RuntimePlayerV1 } from "./player.js";
import {
  inferRuntimeRequiredFeaturesV1,
  parseRuntimeProjectV1,
} from "./validation.js";
import { decodeCanebV1 } from "./binary/caneb.js";
import { deepFreeze } from "./internal.js";
import {
  createRuntimeResourceStateV1,
  runtimeResourceSnapshotV1,
  runtimeResourceStateEmptyV1,
} from "./runtime-resources.js";

export class RuntimeDataV1 {
  readonly document: RuntimeDocumentV1;
  readonly atlases: readonly AtlasDocumentV1[];
  readonly catalog: RuntimeProjectCatalogV1;
  readonly warnings: readonly RuntimeLoadWarningV1[];

  readonly #imageById: ReadonlyMap<string, RuntimeImageV1>;
  readonly #slotById: ReadonlyMap<string, RuntimeSlotV1>;
  readonly #attachmentById: ReadonlyMap<string, RuntimeAttachmentV1>;
  readonly #atlasById: ReadonlyMap<string, AtlasDocumentV1>;
  readonly #animationById: ReadonlyMap<string, RuntimeAnimationV1>;
  readonly #eventById: ReadonlyMap<string, RuntimeEventDefinitionV1>;
  readonly #skinById: ReadonlyMap<string, RuntimeSkinV1>;
  readonly #constraintById: ReadonlyMap<string, RuntimeConstraintV1>;

  private constructor(
    document: RuntimeDocumentV1,
    atlases: readonly AtlasDocumentV1[],
    warnings: readonly RuntimeLoadWarningV1[] = [],
  ) {
    this.document = document;
    this.atlases = atlases;
    this.warnings = deepFreeze([...warnings]);
    this.catalog = createProjectCatalogV1(document, this.warnings);
    this.#imageById = new Map(document.images.map((image) => [image.imageId, image]));
    this.#slotById = new Map(document.slots.map((slot) => [slot.id, slot]));
    this.#attachmentById = new Map(document.attachments.map((attachment) => [attachment.id, attachment]));
    this.#atlasById = new Map(atlases.map((atlas) => [atlas.atlasId, atlas]));
    this.#animationById = new Map(document.animations.map((animation) => [animation.id, animation]));
    this.#eventById = new Map(document.events.map((event) => [event.id, event]));
    this.#skinById = new Map(document.skins.map((skin) => [skin.id, skin]));
    this.#constraintById = new Map(document.constraints.map((constraint) => [constraint.id, constraint]));
    Object.freeze(this);
  }

  static fromJson(input: unknown, options: RuntimeLoadOptionsV1 = {}): RuntimeDataV1 {
    const parsed = parseRuntimeProjectV1(input, options);
    return new RuntimeDataV1(parsed.document, parsed.atlases);
  }

  static fromCaneb(input: ArrayBuffer | ArrayBufferView, options: RuntimeLoadOptionsV1 = {}): RuntimeDataV1 {
    const decoded = decodeCanebV1(input);
    try {
      const parsed = parseRuntimeProjectV1(decoded.document, options);
      return new RuntimeDataV1(parsed.document, parsed.atlases, decoded.warnings);
    } catch (error) {
      if (error instanceof RuntimeErrorV1) {
        throw new RuntimeErrorV1(error.runtimeName, "loadCaneb", error.message, {
          field: error.field,
          entityId: error.entityId,
          cause: error,
        });
      }
      throw error;
    }
  }

  createPlayer(options: RuntimePlayerOptionsV1 = {}): RuntimePlayerV1 {
    return new RuntimePlayerV1(this, options);
  }

  /**
   * Creates a fully revalidated immutable view with instance-local resources
   * overlaid by stable ID. The receiver and all shared callers remain intact.
   */
  withRuntimeResources(resources: RuntimeResourceSnapshotV1): RuntimeDataV1 {
    const state = createRuntimeResourceStateV1(resources, "createRuntimeResourceView");
    if (runtimeResourceStateEmptyV1(state)) return this;
    const snapshot = runtimeResourceSnapshotV1(state);
    const images = mergeByStableIdV1(
      this.document.images,
      snapshot.images,
      (image) => image.imageId,
    );
    const attachments = mergeByStableIdV1(
      this.document.attachments,
      snapshot.attachments,
      (attachment) => attachment.id,
    );
    const skins = mergeByStableIdV1(
      this.document.skins,
      snapshot.skins,
      (skin) => skin.id,
    );
    const atlasReferences = mergeByStableIdV1(
      this.document.atlases,
      snapshot.atlases.map((resource) => resource.reference),
      (atlas) => atlas.atlasId,
    );
    const atlases = mergeByStableIdV1(
      this.atlases,
      snapshot.atlases.map((resource) => resource.atlas),
      (atlas) => atlas.atlasId,
    );
    const requiredFeatures = inferRuntimeRequiredFeaturesV1(
      this.document.slots,
      attachments,
      this.document.constraints,
      skins,
      this.document.events,
      this.document.animations,
    );
    const overlayImagePaths = new Map(snapshot.images.map((image) => [image.imageId, image.path]));
    const overlayAtlasPaths = new Map(snapshot.atlases.map((resource) => [
      resource.atlas.atlasId,
      resource.reference.path,
    ]));
    const overlayPagePaths = new Map<string, string>();
    const overlayAtlasNames = new Map<string, string>();
    for (const resource of snapshot.atlases) {
      overlayAtlasNames.set(resource.atlas.atlasId, resource.atlas.name);
      for (const page of resource.atlas.pages) {
        overlayPagePaths.set(`${resource.atlas.atlasId}\0${page.pageId}`, page.image);
      }
    }
    // Runtime-only resource identifiers may be URLs, asset aliases, or other
    // host keys. Validate the complete Format-shaped model with safe temporary
    // portable paths, then restore only those already-bounded overlay strings.
    const validationImages = images.map((image, index) => overlayImagePaths.has(image.imageId) && image.path !== null
      ? { ...image, path: `runtime-resources/images/${index}` }
      : image);
    const validationAtlasReferences = atlasReferences.map((atlas, index) => overlayAtlasPaths.has(atlas.atlasId)
      ? { ...atlas, path: `runtime-resources/atlases/${index}.json` }
      : atlas);
    const validationAtlases = atlases.map((atlas, atlasIndex) => overlayAtlasPaths.has(atlas.atlasId)
      ? {
          ...atlas,
          name: `runtime-overlay-${atlasIndex}`,
          pages: atlas.pages.map((page, pageIndex) => ({
            ...page,
            image: `runtime-overlay-${atlasIndex}${pageIndex === 0 ? "" : `-${pageIndex + 1}`}.png`,
          })),
        }
      : atlas);
    const parsed = parseRuntimeProjectV1({
      ...this.document,
      requiredFeatures,
      atlases: validationAtlasReferences,
      images: validationImages,
      attachments,
      skins,
    }, { atlases: validationAtlases, allowUnverifiedFeatures: true });
    const restoredDocument = deepFreeze<RuntimeDocumentV1>({
      ...parsed.document,
      atlases: parsed.document.atlases.map((atlas) => {
        const path = overlayAtlasPaths.get(atlas.atlasId);
        return path === undefined ? atlas : { ...atlas, path };
      }),
      images: parsed.document.images.map((image) => {
        const path = overlayImagePaths.get(image.imageId);
        return path === undefined ? image : { ...image, path };
      }),
    });
    const restoredAtlases = deepFreeze(parsed.atlases.map((atlas) => {
      if (!overlayAtlasPaths.has(atlas.atlasId)) return atlas;
      return {
        ...atlas,
        name: overlayAtlasNames.get(atlas.atlasId) ?? atlas.name,
        pages: atlas.pages.map((page) => ({
          ...page,
          image: overlayPagePaths.get(`${atlas.atlasId}\0${page.pageId}`) ?? page.image,
        })),
      };
    }));
    return new RuntimeDataV1(restoredDocument, restoredAtlases, this.warnings);
  }

  /**
   * Cross-checks a complete host-decoded texture catalog against immutable
   * Runtime/Atlas declarations. This performs no I/O and retains no host object.
   */
  validateDecodedTextureCatalog(resources: readonly RuntimeDecodedTextureDimensionsV1[]): void {
    this.#validateDecodedTextureCatalog(resources, "validateDecodedTextureCatalog");
  }

  /** Runtime API 1.1-compatible split-list spelling. */
  validateDecodedTextureSizes(
    directImages: readonly RuntimeDecodedImageSizeV1[],
    atlasPages: readonly RuntimeDecodedAtlasPageSizeV1[],
  ): void {
    const operation = "validateDecodedTextures";
    if (!Array.isArray(directImages)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "directImages must be an array.", {
        field: "directImages",
      });
    }
    if (!Array.isArray(atlasPages)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "atlasPages must be an array.", {
        field: "atlasPages",
      });
    }
    validateDecodedDirectImageSizesV1(this.document, directImages);
    validateDecodedAtlasPageSizesV1(this.document, this.atlases, atlasPages);
  }

  #validateDecodedTextureCatalog(
    resources: readonly RuntimeDecodedTextureDimensionsV1[],
    operation: string,
  ): void {
    if (!Array.isArray(resources)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "resources must be an array.", { field: "resources" });
    }
    const expected = new Map<string, {
      readonly entityId: string;
      readonly width: number | null;
      readonly height: number | null;
      readonly field: string;
    }>();
    for (let index = 0; index < this.document.images.length; index += 1) {
      const image = this.document.images[index];
      if (image === undefined || image.path === null) continue;
      expected.set(`direct\0${image.imageId}`, {
        entityId: image.imageId,
        width: image.width,
        height: image.height,
        field: `images[${index}]`,
      });
    }
    for (let atlasIndex = 0; atlasIndex < this.atlases.length; atlasIndex += 1) {
      const atlas = this.atlases[atlasIndex];
      if (atlas === undefined) continue;
      for (let pageIndex = 0; pageIndex < atlas.pages.length; pageIndex += 1) {
        const page = atlas.pages[pageIndex];
        if (page === undefined) continue;
        expected.set(`atlasPage\0${atlas.atlasId}\0${page.pageId}`, {
          entityId: page.pageId,
          width: page.width,
          height: page.height,
          field: `atlasResources[${atlasIndex}].pages[${pageIndex}]`,
        });
      }
    }

    const seen = new Set<string>();
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index];
      const field = `resources[${index}]`;
      if (resource === null || typeof resource !== "object") {
        throw new RuntimeErrorV1("invalidArgument", operation, "Decoded resource must be an object.", { field });
      }
      let key: string;
      let entityId: string;
      if (resource.kind === "direct") {
        entityId = decodedIdV1(resource.imageId, operation, `${field}.imageId`);
        key = `direct\0${entityId}`;
      } else if (resource.kind === "atlasPage") {
        const atlasId = decodedIdV1(resource.atlasId, operation, `${field}.atlasId`);
        entityId = decodedIdV1(resource.pageId, operation, `${field}.pageId`);
        key = `atlasPage\0${atlasId}\0${entityId}`;
      } else {
        throw new RuntimeErrorV1("invalidArgument", operation, "Unknown decoded texture resource kind.", {
          field: `${field}.kind`,
        });
      }
      if (seen.has(key)) {
        throw new RuntimeErrorV1("validationFailed", operation, "Decoded texture resource is duplicated.", {
          field,
          entityId,
        });
      }
      seen.add(key);
      const declaration = expected.get(key);
      if (declaration === undefined) {
        throw new RuntimeErrorV1("validationFailed", operation, "Decoded texture resource is not declared.", {
          field,
          entityId,
        });
      }
      const width = decodedDimensionV1(resource.width, operation, `${field}.width`);
      const height = decodedDimensionV1(resource.height, operation, `${field}.height`);
      if ((declaration.width !== null && width !== declaration.width)
        || (declaration.height !== null && height !== declaration.height)) {
        const declaredWidth = declaration.width === null ? "unspecified" : String(declaration.width);
        const declaredHeight = declaration.height === null ? "unspecified" : String(declaration.height);
        throw new RuntimeErrorV1(
          "validationFailed",
          operation,
          `Decoded dimensions ${width}x${height} differ from declared ${declaredWidth}x${declaredHeight}.`,
          { field, entityId },
        );
      }
    }
    for (const [key, declaration] of expected) {
      if (!seen.has(key)) {
        throw new RuntimeErrorV1("missingResource", operation, "Decoded texture catalog is incomplete.", {
          field: declaration.field,
          entityId: declaration.entityId,
        });
      }
    }
  }

  image(imageId: string): RuntimeImageV1 {
    const image = this.#imageById.get(imageId);
    if (image === undefined) {
      throw new RuntimeErrorV1("notFound", "queryImage", `Unknown image '${imageId}'.`, {
        field: "imageId",
        entityId: imageId,
      });
    }
    return image;
  }

  slot(slotId: string): RuntimeSlotV1 {
    const slot = this.#slotById.get(slotId);
    if (slot === undefined) {
      throw new RuntimeErrorV1("notFound", "querySlot", `Unknown slot '${slotId}'.`, {
        field: "slotId",
        entityId: slotId,
      });
    }
    return slot;
  }

  attachment(attachmentId: string): RuntimeAttachmentV1 {
    const attachment = this.#attachmentById.get(attachmentId);
    if (attachment === undefined) {
      throw new RuntimeErrorV1("notFound", "queryAttachment", `Unknown attachment '${attachmentId}'.`, {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    return attachment;
  }

  atlas(atlasId: string | null): AtlasDocumentV1 | null {
    if (atlasId === null) return null;
    const atlas = this.#atlasById.get(atlasId);
    if (atlas === undefined) {
      throw new RuntimeErrorV1("missingResource", "queryAtlas", `Missing Atlas '${atlasId}'.`, {
        field: "atlasId",
        entityId: atlasId,
      });
    }
    return atlas;
  }

  animation(animationId: string): RuntimeAnimationV1 {
    const animation = this.#animationById.get(animationId);
    if (animation === undefined) {
      throw new RuntimeErrorV1("notFound", "queryAnimation", `Unknown animation '${animationId}'.`, {
        field: "animationId",
        entityId: animationId,
      });
    }
    return animation;
  }

  eventDefinition(eventId: string): RuntimeEventDefinitionV1 {
    const event = this.#eventById.get(eventId);
    if (event === undefined) {
      throw new RuntimeErrorV1("notFound", "queryEvent", `Unknown event '${eventId}'.`, {
        field: "eventId",
        entityId: eventId,
      });
    }
    return event;
  }

  skin(skinId: string): RuntimeSkinV1 {
    const skin = this.#skinById.get(skinId);
    if (skin === undefined) {
      throw new RuntimeErrorV1("notFound", "querySkin", `Unknown skin '${skinId}'.`, {
        field: "skinId",
        entityId: skinId,
      });
    }
    return skin;
  }

  constraint(constraintId: string): RuntimeConstraintV1 {
    const constraint = this.#constraintById.get(constraintId);
    if (constraint === undefined) {
      throw new RuntimeErrorV1("notFound", "queryConstraint", `Unknown constraint '${constraintId}'.`, {
        field: "constraintId",
        entityId: constraintId,
      });
    }
    return constraint;
  }
}

function createProjectCatalogV1(
  document: RuntimeDocumentV1,
  warnings: readonly RuntimeLoadWarningV1[],
): RuntimeProjectCatalogV1 {
  return deepFreeze<RuntimeProjectCatalogV1>({
    runtimeFormatVersion: { ...document.formatVersion },
    runtimeApiVersion: { ...document.runtimeApiVersion },
    generator: { ...document.generator },
    requiredFeatures: [...document.requiredFeatures],
    skeletonId: document.skeleton.skeletonId,
    name: document.skeleton.name,
    referenceScale: document.skeleton.referenceScale,
    atlases: document.atlases.map((atlas) => ({ ...atlas })),
    images: document.images.map((image) => ({ ...image })),
    audios: document.audios.map((audio) => ({ ...audio })),
    fonts: document.fonts.map((font) => ({ ...font })),
    animations: document.animations.map((animation) => ({
      id: animation.id,
      name: animation.name,
      fps: animation.fps,
      durationSeconds: animation.duration,
    })),
    skins: document.skins.map((skin) => ({ id: skin.id, name: skin.name })),
    bones: document.bones.map((bone) => ({
      id: bone.id,
      name: bone.name,
      parentId: bone.parentId,
      length: bone.length,
    })),
    slots: document.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      boneId: slot.boneId,
      setupAttachmentId: slot.attachmentId,
      zIndex: slot.zIndex,
      blendMode: slot.blendMode,
    })),
    attachments: document.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      slotId: attachment.slotId,
      kind: attachment.type === "boundingbox" ? "boundingBox" : attachment.type,
      imageId: attachment.type === "region" || attachment.type === "mesh" ? attachment.imageId : null,
    })),
    constraints: document.constraints.map((constraint) => ({
      id: constraint.id,
      name: constraint.name,
      kind: constraint.type,
    })),
    events: document.events.map((event) => ({ ...event })),
    warnings,
  });
}

function validateDecodedDirectImageSizesV1(
  document: RuntimeDocumentV1,
  decoded: readonly RuntimeDecodedImageSizeV1[],
): void {
  const operation = "validateDecodedTextures";
  const expected = new Map(
    document.images
      .filter((image) => image.path !== null)
      .map((image) => [image.imageId, image]),
  );
  const supplied = new Set<string>();
  for (const image of decoded) {
    if (image === null || typeof image !== "object") {
      throw new RuntimeErrorV1("invalidArgument", operation, "directImages must contain objects.", {
        field: "directImages",
      });
    }
    const imageId = decodedListIdV1(image.imageId, operation, "directImages");
    if (!isPositiveU32V1(image.width) || !isPositiveU32V1(image.height)) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        operation,
        `decoded direct image \`${imageId}\` must have positive dimensions`,
        { field: "directImages", entityId: imageId },
      );
    }
    const declaration = expected.get(imageId);
    if (declaration === undefined) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded direct image \`${imageId}\` is not a declared direct runtime image`,
        { entityId: imageId },
      );
    }
    if (supplied.has(imageId)) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded direct image \`${imageId}\` occurs more than once`,
        { entityId: imageId },
      );
    }
    supplied.add(imageId);
    if ((declaration.width !== null && declaration.width !== image.width)
      || (declaration.height !== null && declaration.height !== image.height)) {
      const width = declaration.width === null ? "None" : `Some(${declaration.width})`;
      const height = declaration.height === null ? "None" : `Some(${declaration.height})`;
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded direct image \`${imageId}\` is ${image.width}x${image.height}, not declared ${width}x${height}`,
        { entityId: imageId },
      );
    }
  }
  const missing = Array.from(expected.keys())
    .filter((imageId) => !supplied.has(imageId))
    .sort(compareUtf8StringsV1)[0];
  if (missing !== undefined) {
    throw new RuntimeErrorV1(
      "missingResource",
      operation,
      `no decoded dimensions were supplied for direct image \`${missing}\``,
      { entityId: missing },
    );
  }
}

function validateDecodedAtlasPageSizesV1(
  document: RuntimeDocumentV1,
  atlases: readonly AtlasDocumentV1[],
  decoded: readonly RuntimeDecodedAtlasPageSizeV1[],
): void {
  const operation = "validateDecodedTextures";
  const atlasById = new Map(atlases.map((atlas) => [atlas.atlasId, atlas]));
  const supplied = new Map<string, Map<string, RuntimeDecodedAtlasPageSizeV1>>();
  for (const page of decoded) {
    if (page === null || typeof page !== "object") {
      throw new RuntimeErrorV1("invalidArgument", operation, "atlasPages must contain objects.", {
        field: "atlasPages",
      });
    }
    const atlasId = decodedListIdV1(page.atlasId, operation, "atlasPages");
    const pageId = decodedListIdV1(page.pageId, operation, "atlasPages");
    if (!isPositiveU32V1(page.width) || !isPositiveU32V1(page.height)) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        operation,
        `decoded atlas page \`${atlasId}\`/\`${pageId}\` must have positive dimensions`,
        { field: "atlasPages", entityId: pageId },
      );
    }
    const atlas = atlasById.get(atlasId);
    if (atlas === undefined) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded page references unknown atlas \`${atlasId}\``,
        { entityId: atlasId },
      );
    }
    if (!atlas.pages.some((candidate) => candidate.pageId === pageId)) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded page \`${pageId}\` is not declared by atlas \`${atlasId}\``,
        { entityId: pageId },
      );
    }
    const pages = supplied.get(atlasId) ?? new Map<string, RuntimeDecodedAtlasPageSizeV1>();
    if (pages.has(pageId)) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `decoded atlas page \`${atlasId}\`/\`${pageId}\` occurs more than once`,
        { entityId: pageId },
      );
    }
    pages.set(pageId, page);
    supplied.set(atlasId, pages);
  }

  for (const declaration of document.atlases) {
    const atlas = atlasById.get(declaration.atlasId);
    if (atlas === undefined) continue;
    const pages = supplied.get(declaration.atlasId);
    let errorCount = 0;
    for (const declaredPage of atlas.pages) {
      const observed = pages?.get(declaredPage.pageId);
      if (observed === undefined
        || observed.width !== declaredPage.width
        || observed.height !== declaredPage.height) {
        errorCount += 1;
      }
    }
    if (errorCount > 0) {
      throw new RuntimeErrorV1(
        "validationFailed",
        operation,
        `Cane Atlas v1 validation failed with ${errorCount} error(s)`,
        { entityId: declaration.atlasId },
      );
    }
  }
}

function decodedListIdV1(value: string, operation: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} contains an invalid resource ID.`, { field });
  }
  return value;
}

function isPositiveU32V1(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 0xffff_ffff;
}

function compareUtf8StringsV1(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

function decodedIdV1(value: string, operation: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be a non-empty NUL-free string.`, { field });
  }
  return value;
}

function decodedDimensionV1(value: number, operation: string, field: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be a positive u32.`, { field });
  }
  return value;
}

function mergeByStableIdV1<Value>(
  base: readonly Value[],
  overlay: readonly Value[],
  id: (value: Value) => string,
): Value[] {
  const replacements = new Map<string, Value>();
  for (const value of overlay) replacements.set(id(value), value);
  const merged = new Array<Value>(base.length);
  const baseIds = new Set<string>();
  for (let index = 0; index < base.length; index += 1) {
    const value = base[index];
    if (value === undefined) continue;
    const key = id(value);
    baseIds.add(key);
    merged[index] = replacements.get(key) ?? value;
  }
  for (const value of overlay) {
    if (!baseIds.has(id(value))) merged.push(value);
  }
  return merged;
}
