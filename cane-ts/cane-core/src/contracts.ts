export interface RuntimeVersionV1 {
  readonly major: number;
  readonly minor: number;
}

export interface RuntimeApiInfoV1 {
  readonly apiMajor: 1;
  readonly apiMinor: 3;
  readonly apiPatch: 0;
  readonly wireSchema: "cane.runtime/v1";
  /** Safe integer bitset; Runtime API v1 currently uses bits 0 through 41. */
  readonly featureBits: number;
}

export type BoneTransformModeV1 =
  | "normal"
  | "onlyTranslation"
  | "noRotationOrReflection"
  | "noScale"
  | "noScaleOrReflection";

export type RuntimeBlendModeV1 = "normal" | "add" | "multiply" | "screen";

export interface AffineV1 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface RootTransformV1 {
  readonly x: number;
  readonly y: number;
  readonly rotationDegrees: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface RuntimeSkeletonMetadataV1 {
  readonly skeletonId: string;
  readonly name: string;
  readonly unit: "px";
  readonly angleUnit: "deg";
  readonly referenceScale: number;
}

export interface RuntimeGeneratorV1 {
  readonly name: string;
  readonly version: string;
}

export interface RuntimeAtlasReferenceV1 {
  readonly atlasId: string;
  readonly path: string;
}

export interface RuntimeBoneV1 {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly shearX: number;
  readonly shearY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly length: number;
  readonly transformMode: BoneTransformModeV1;
}

export interface RuntimeSlotV1 {
  readonly id: string;
  readonly name: string;
  readonly boneId: string;
  readonly attachmentId: string | null;
  readonly zIndex: number;
  readonly blendMode: RuntimeBlendModeV1;
  readonly color: string;
  readonly alpha: number;
  readonly darkColor: string | null;
}

export interface RuntimeImageV1 {
  readonly imageId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly path: string | null;
  readonly atlasId: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface RuntimeDecodedImageSizeV1 {
  readonly imageId: string;
  readonly width: number;
  readonly height: number;
}

export interface RuntimeDecodedAtlasPageSizeV1 {
  readonly atlasId: string;
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
}

export interface RuntimeDecodedDirectImageDimensionsV1 extends RuntimeDecodedImageSizeV1 {
  readonly kind: "direct";
}

export interface RuntimeDecodedAtlasPageDimensionsV1 extends RuntimeDecodedAtlasPageSizeV1 {
  readonly kind: "atlasPage";
}

/** Host-observed dimensions after an image resource has actually decoded. */
export type RuntimeDecodedTextureDimensionsV1 =
  | RuntimeDecodedDirectImageDimensionsV1
  | RuntimeDecodedAtlasPageDimensionsV1;

export interface RuntimeAudioV1 {
  readonly audioId: string;
  readonly name: string;
  readonly path: string;
  readonly mimeType: string;
}

export interface RuntimeFontV1 {
  readonly fontId: string;
  readonly name: string;
  readonly path: string;
  readonly mimeType: string;
}

export interface RuntimeRegionAttachmentV1 {
  readonly type: "region";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly imageId: string;
  readonly color: string;
  readonly alpha: number;
  readonly sequence: RuntimeAttachmentSequenceV1 | null;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface RuntimeAttachmentSequenceV1 {
  readonly imageIds: readonly string[];
  readonly setupIndex: number;
}

export interface RuntimeWeightV1 {
  readonly boneId: string;
  readonly weight: number;
  readonly x: number | null;
  readonly y: number | null;
}

export type RuntimeBindInverseMapV1 = Readonly<Record<string, AffineV1>>;

export interface RuntimeMeshLinkV1 {
  readonly parentMeshId: string;
  readonly inheritDeform: boolean;
}

export interface RuntimeMeshAttachmentV1 {
  readonly type: "mesh";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly imageId: string;
  readonly color: string;
  readonly alpha: number;
  readonly sequence: RuntimeAttachmentSequenceV1 | null;
  readonly rows: number;
  readonly cols: number;
  readonly vertices: readonly number[];
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
  readonly weights: readonly (readonly RuntimeWeightV1[])[];
  readonly bindInverses: RuntimeBindInverseMapV1 | null;
  readonly edges: readonly number[] | null;
  readonly hull: readonly number[] | null;
  readonly link: RuntimeMeshLinkV1 | null;
}

export interface RuntimePathAttachmentV1 {
  readonly type: "path";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly closed: boolean;
  readonly constantSpeed: boolean;
  readonly lengths: readonly number[];
  readonly vertices: readonly number[];
  readonly weights: readonly (readonly RuntimeWeightV1[])[];
  readonly bindInverses: RuntimeBindInverseMapV1 | null;
}

export interface RuntimePointAttachmentV1 {
  readonly type: "point";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface RuntimeBoundingBoxAttachmentV1 {
  readonly type: "boundingbox";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly vertices: readonly number[];
  readonly weights: readonly (readonly RuntimeWeightV1[])[];
  readonly bindInverses: RuntimeBindInverseMapV1 | null;
}

export interface RuntimeClippingAttachmentV1 {
  readonly type: "clipping";
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly endSlotId: string | null;
  readonly convex: boolean;
  readonly inverse: boolean;
  readonly vertices: readonly number[];
  readonly weights: readonly (readonly RuntimeWeightV1[])[];
  readonly bindInverses: RuntimeBindInverseMapV1 | null;
}

export type RuntimeAttachmentV1 =
  | RuntimeRegionAttachmentV1
  | RuntimeMeshAttachmentV1
  | RuntimePathAttachmentV1
  | RuntimePointAttachmentV1
  | RuntimeBoundingBoxAttachmentV1
  | RuntimeClippingAttachmentV1;

export interface RuntimeSkinAttachmentV1 {
  readonly slotId: string;
  readonly attachmentId: string | null;
  readonly name: string | null;
}

export interface RuntimeSkinV1 {
  readonly id: string;
  readonly name: string;
  readonly attachments: readonly RuntimeSkinAttachmentV1[];
  readonly boneIds: readonly string[];
  readonly constraintIds: readonly string[];
  readonly export: boolean;
}

/** One instance-local Atlas resource installed without changing Runtime Format data. */
export interface RuntimeOverlayAtlasV1 {
  readonly reference: RuntimeAtlasReferenceV1;
  readonly atlas: AtlasDocumentV1;
}

/** Complete owned snapshot of one player's instance-local resource overlay. */
export interface RuntimeResourceSnapshotV1 {
  readonly images: readonly RuntimeImageV1[];
  readonly atlases: readonly RuntimeOverlayAtlasV1[];
  readonly attachments: readonly RuntimeAttachmentV1[];
  readonly skins: readonly RuntimeSkinV1[];
}

/** Ordered operations committed atomically to one player's resource overlay. */
export type RuntimeResourceOperationV1 =
  | { readonly operation: "upsertImage"; readonly image: RuntimeImageV1 }
  | { readonly operation: "removeImage"; readonly imageId: string }
  | { readonly operation: "upsertAtlas"; readonly resource: RuntimeOverlayAtlasV1 }
  | { readonly operation: "removeAtlas"; readonly atlasId: string }
  | { readonly operation: "upsertAttachment"; readonly attachment: RuntimeAttachmentV1 }
  | { readonly operation: "removeAttachment"; readonly attachmentId: string }
  | { readonly operation: "upsertSkin"; readonly skin: RuntimeSkinV1 }
  | { readonly operation: "removeSkin"; readonly skinId: string };

export interface RuntimeResourceChangesV1 {
  readonly operations: readonly RuntimeResourceOperationV1[];
}

/**
 * Host-owned resource protocol. Core emits immutable texture descriptors but
 * never retains renderer/GPU objects returned by this interface.
 */
export interface RuntimeExternalResourceResolverV1<Resource> {
  acquire(descriptor: RuntimeTextureV1): Resource | Promise<Resource>;
  release(descriptor: RuntimeTextureV1, resource: Resource): void | Promise<void>;
}

export type RuntimeTransformPropertyV1 = "rotate" | "x" | "y" | "scaleX" | "scaleY" | "shearY";

export interface RuntimeTransformTargetMapV1 {
  readonly property: RuntimeTransformPropertyV1;
  readonly offset: number;
  readonly max: number;
  readonly scale: number;
}

export interface RuntimeTransformSourceMapV1 {
  readonly property: RuntimeTransformPropertyV1;
  readonly offset: number;
  readonly targets: readonly RuntimeTransformTargetMapV1[];
}

export interface RuntimeTransformMappingV1 {
  readonly localSource: boolean;
  readonly localTarget: boolean;
  readonly clamp: boolean;
  readonly properties: readonly RuntimeTransformSourceMapV1[];
}

export interface RuntimeIkConstraintV1 {
  readonly type: "ik";
  readonly id: string;
  readonly name: string;
  readonly chainBoneIds: readonly string[];
  readonly targetBoneId: string | null;
  readonly target: { readonly x: number; readonly y: number };
  readonly mix: number;
  readonly bendPositive: boolean;
  readonly compress: boolean;
  readonly stretch: boolean;
  readonly uniform: false | true | "volume";
  readonly softness: number;
  readonly iterations: number;
  readonly threshold: number;
}

export interface RuntimeTransformConstraintV1 {
  readonly type: "transform";
  readonly id: string;
  readonly name: string;
  readonly boneIds: readonly string[];
  readonly targetBoneId: string;
  readonly local: boolean;
  readonly relative: boolean;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearY: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly mixScaleX: number;
  readonly mixScaleY: number;
  readonly mixShearY: number;
  readonly mapping: RuntimeTransformMappingV1 | null;
}

export interface RuntimePathConstraintV1 {
  readonly type: "path";
  readonly id: string;
  readonly name: string;
  readonly boneIds: readonly string[];
  readonly targetSlotId: string;
  readonly positionMode: "fixed" | "percent";
  readonly spacingMode: "length" | "fixed" | "percent" | "proportional";
  readonly rotateMode: "tangent" | "chain" | "chainScale";
  readonly rotation: number;
  readonly position: number;
  readonly spacing: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
}

export interface RuntimePhysicsConstraintV1 {
  readonly type: "physics";
  readonly id: string;
  readonly name: string;
  readonly boneId: string;
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly scaleYMode: "none" | "uniform" | "volume";
  readonly shearX: number;
  readonly limit: number;
  readonly fps: number;
  readonly inertia: number;
  readonly strength: number;
  readonly damping: number;
  readonly mass: number;
  readonly wind: number;
  readonly gravity: number;
  readonly mix: number;
  readonly inertiaGlobal: boolean;
  readonly strengthGlobal: boolean;
  readonly dampingGlobal: boolean;
  readonly massGlobal: boolean;
  readonly windGlobal: boolean;
  readonly gravityGlobal: boolean;
  readonly mixGlobal: boolean;
}

export interface RuntimeSliderConstraintV1 {
  readonly type: "slider";
  readonly id: string;
  readonly name: string;
  readonly animationId: string;
  readonly looping: boolean;
  readonly additive: boolean;
  readonly sourceBoneId: string | null;
  readonly sourceProperty: RuntimeTransformPropertyV1;
  readonly sourceOffset: number;
  readonly timeOffset: number;
  readonly timeScale: number;
  readonly rangeMax: number;
  readonly local: boolean;
  readonly time: number;
  readonly mix: number;
}

export type RuntimeConstraintV1 =
  | RuntimeIkConstraintV1
  | RuntimeTransformConstraintV1
  | RuntimePathConstraintV1
  | RuntimePhysicsConstraintV1
  | RuntimeSliderConstraintV1;

export type RuntimeCurvePropertyNameV1 =
  | "x"
  | "y"
  | "rotation"
  | "scale_x"
  | "scale_y"
  | "color_r"
  | "color_g"
  | "color_b"
  | "dark_r"
  | "dark_g"
  | "dark_b"
  | "alpha"
  | "target_x"
  | "target_y"
  | "mix"
  | "softness"
  | "mix_rotate"
  | "mix_x"
  | "mix_y"
  | "mix_scale_x"
  | "mix_scale_y"
  | "mix_shear_y"
  | "position"
  | "spacing"
  | "inertia"
  | "strength"
  | "damping"
  | "mass"
  | "wind"
  | "gravity"
  | "slider_time";

export interface RuntimeBezierCurveV1 {
  readonly type: "bezier";
  readonly cx1: number;
  readonly cy1: number;
  readonly cx2: number;
  readonly cy2: number;
}

export interface RuntimeValueBezierCurveV1 {
  readonly type: "bezier-value";
  readonly cx1: number;
  readonly dy1: number;
  readonly cx2: number;
  readonly dy2: number;
}

export type RuntimeSimpleCurveV1 =
  | null
  | "linear"
  | "stepped"
  | RuntimeBezierCurveV1
  | RuntimeValueBezierCurveV1;

export interface RuntimePropertyCurveV1 {
  readonly type: "properties";
  readonly default: RuntimeSimpleCurveV1;
  readonly properties: Readonly<Partial<Record<RuntimeCurvePropertyNameV1, RuntimeSimpleCurveV1>>>;
}

export type RuntimeCurveV1 = RuntimeSimpleCurveV1 | RuntimePropertyCurveV1;

export interface RuntimeTranslateKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly x: number;
  readonly y: number;
}

export interface RuntimeScalarKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly value: number;
}

export interface RuntimeRotateKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly angle: number;
}

export interface RuntimePairKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly x: number;
  readonly y: number;
}

export interface RuntimeInheritKeyV1 {
  readonly time: number;
  readonly inherit: BoneTransformModeV1;
}

export interface RuntimeBoneTimelineV1 {
  readonly boneId: string;
  readonly translate: readonly RuntimeTranslateKeyV1[] | null;
  readonly translateX: readonly RuntimeScalarKeyV1[] | null;
  readonly translateY: readonly RuntimeScalarKeyV1[] | null;
  readonly rotate: readonly RuntimeRotateKeyV1[] | null;
  readonly scale: readonly RuntimePairKeyV1[] | null;
  readonly scaleX: readonly RuntimeScalarKeyV1[] | null;
  readonly scaleY: readonly RuntimeScalarKeyV1[] | null;
  readonly shear: readonly RuntimePairKeyV1[] | null;
  readonly shearX: readonly RuntimeScalarKeyV1[] | null;
  readonly shearY: readonly RuntimeScalarKeyV1[] | null;
  readonly inherit: readonly RuntimeInheritKeyV1[] | null;
}

export interface RuntimeSlotAttachmentKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly attachmentId: string | null;
}

export interface RuntimeSlotColorKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly color: string;
  readonly alpha: number;
  readonly darkColor: string | null;
}

export interface RuntimeSlotAlphaKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly alpha: number;
}

export interface RuntimeSlotTimelineV1 {
  readonly slotId: string;
  readonly attachment: readonly RuntimeSlotAttachmentKeyV1[] | null;
  readonly color: readonly RuntimeSlotColorKeyV1[] | null;
  readonly alpha: readonly RuntimeSlotAlphaKeyV1[] | null;
}

export interface RuntimeRegionKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface RuntimeDeformKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly vertices: readonly number[];
}

export type RuntimeSequenceModeV1 =
  | "hold"
  | "once"
  | "loop"
  | "pingpong"
  | "onceReverse"
  | "loopReverse"
  | "pingpongReverse";

export interface RuntimeSequenceKeyV1 {
  readonly time: number;
  readonly mode: RuntimeSequenceModeV1;
  readonly index: number;
  readonly delay: number;
}

export type RuntimeDeformSpaceV1 = "vertexPositions" | "weightedInfluenceOffsets";

export interface RuntimeAttachmentTimelineV1 {
  readonly attachmentId: string;
  readonly region: readonly RuntimeRegionKeyV1[] | null;
  readonly deform: readonly RuntimeDeformKeyV1[] | null;
  readonly deformSpace: RuntimeDeformSpaceV1;
  readonly sequence: readonly RuntimeSequenceKeyV1[] | null;
}

export interface RuntimeEventDefinitionV1 {
  readonly id: string;
  readonly name: string;
  readonly integerValue: number | null;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly audioId: string | null;
  readonly volume: number;
  readonly balance: number;
}

export interface RuntimeEventKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly eventId: string | null;
  readonly name: string;
  readonly integerValue: number | null;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly audioId: string | null;
  readonly volume: number;
  readonly balance: number;
}

export interface RuntimeDrawOrderKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly slotIds: readonly string[];
}

export interface RuntimeDrawOrderFolderV1 {
  readonly folderPath: string;
  readonly slotIds: readonly string[];
  readonly keys: readonly RuntimeDrawOrderKeyV1[];
}

export interface RuntimeSkinKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly skinId: string | null;
}

interface RuntimeConstraintKeyBaseV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
}

export interface RuntimeIkConstraintKeyV1 extends RuntimeConstraintKeyBaseV1 {
  readonly targetX: number | null;
  readonly targetY: number | null;
  readonly mix: number | null;
  readonly bendPositive: boolean | null;
  readonly compress: boolean | null;
  readonly stretch: boolean | null;
  readonly softness: number | null;
}

export interface RuntimeTransformConstraintKeyV1 extends RuntimeConstraintKeyBaseV1 {
  readonly mixRotate: number | null;
  readonly mixX: number | null;
  readonly mixY: number | null;
  readonly mixScaleX: number | null;
  readonly mixScaleY: number | null;
  readonly mixShearY: number | null;
}

export interface RuntimePathConstraintKeyV1 extends RuntimeConstraintKeyBaseV1 {
  readonly position: number | null;
  readonly spacing: number | null;
  readonly mixRotate: number | null;
  readonly mixX: number | null;
  readonly mixY: number | null;
}

export interface RuntimePhysicsConstraintKeyV1 extends RuntimeConstraintKeyBaseV1 {
  readonly mix: number | null;
  readonly inertia: number | null;
  readonly strength: number | null;
  readonly damping: number | null;
  readonly mass: number | null;
  readonly wind: number | null;
  readonly gravity: number | null;
  readonly reset: boolean | null;
}

export interface RuntimeSliderConstraintKeyV1 extends RuntimeConstraintKeyBaseV1 {
  readonly sliderTime: number | null;
  readonly mix: number | null;
}

export type RuntimeConstraintTimelineV1 =
  | { readonly type: "ik"; readonly constraintId: string; readonly keys: readonly RuntimeIkConstraintKeyV1[] }
  | { readonly type: "transform"; readonly constraintId: string; readonly keys: readonly RuntimeTransformConstraintKeyV1[] }
  | { readonly type: "path"; readonly constraintId: string; readonly keys: readonly RuntimePathConstraintKeyV1[] }
  | { readonly type: "physics"; readonly constraintId: string; readonly keys: readonly RuntimePhysicsConstraintKeyV1[] }
  | { readonly type: "slider"; readonly constraintId: string; readonly keys: readonly RuntimeSliderConstraintKeyV1[] };

export interface RuntimeAnimationV1 {
  readonly id: string;
  readonly name: string;
  readonly fps: number;
  readonly duration: number;
  readonly boneTimelines: readonly RuntimeBoneTimelineV1[];
  readonly slotTimelines: readonly RuntimeSlotTimelineV1[];
  readonly attachmentTimelines: readonly RuntimeAttachmentTimelineV1[];
  readonly constraintTimelines: readonly RuntimeConstraintTimelineV1[];
  readonly events: readonly RuntimeEventKeyV1[];
  readonly drawOrder: readonly RuntimeDrawOrderKeyV1[];
  readonly drawOrderFolders: readonly RuntimeDrawOrderFolderV1[];
  readonly skins: readonly RuntimeSkinKeyV1[];
}

/** Lightweight, immutable host-facing animation catalog entry. */
export interface RuntimeAnimationCatalogV1 {
  readonly id: string;
  readonly name: string;
  readonly fps: number;
  readonly durationSeconds: number;
}

export interface RuntimeSkinCatalogV1 {
  readonly id: string;
  readonly name: string;
}

export interface RuntimeBoneCatalogV1 {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly length: number;
}

export interface RuntimeSlotCatalogV1 {
  readonly id: string;
  readonly name: string;
  readonly boneId: string;
  readonly setupAttachmentId: string | null;
  readonly zIndex: number;
  readonly blendMode: RuntimeBlendModeV1;
}

export type RuntimeAttachmentKindV1 =
  | "region"
  | "mesh"
  | "path"
  | "point"
  | "boundingBox"
  | "clipping";

export interface RuntimeAttachmentDefinitionV1 {
  readonly id: string;
  readonly name: string;
  readonly slotId: string;
  readonly kind: RuntimeAttachmentKindV1;
  readonly imageId: string | null;
}

export type RuntimeConstraintKindV1 = "ik" | "transform" | "path" | "physics" | "slider";

export interface RuntimeConstraintCatalogV1 {
  readonly id: string;
  readonly name: string;
  readonly kind: RuntimeConstraintKindV1;
}

/**
 * Stable resource and entity inventory for hosts. It intentionally excludes
 * authoring timelines and setup-pose implementation details.
 */
export interface RuntimeProjectCatalogV1 {
  readonly runtimeFormatVersion: RuntimeVersionV1;
  readonly runtimeApiVersion: RuntimeVersionV1;
  readonly generator: RuntimeGeneratorV1;
  readonly requiredFeatures: readonly string[];
  readonly skeletonId: string;
  readonly name: string;
  readonly referenceScale: number;
  readonly atlases: readonly RuntimeAtlasReferenceV1[];
  readonly images: readonly RuntimeImageV1[];
  readonly audios: readonly RuntimeAudioV1[];
  readonly fonts: readonly RuntimeFontV1[];
  readonly animations: readonly RuntimeAnimationCatalogV1[];
  readonly skins: readonly RuntimeSkinCatalogV1[];
  readonly bones: readonly RuntimeBoneCatalogV1[];
  readonly slots: readonly RuntimeSlotCatalogV1[];
  readonly attachments: readonly RuntimeAttachmentDefinitionV1[];
  readonly constraints: readonly RuntimeConstraintCatalogV1[];
  readonly events: readonly RuntimeEventDefinitionV1[];
  readonly warnings: readonly RuntimeLoadWarningV1[];
}

export interface RuntimeDocumentV1 {
  readonly format: "cane-runtime";
  readonly formatVersion: RuntimeVersionV1;
  readonly runtimeApiVersion: RuntimeVersionV1;
  readonly generator: RuntimeGeneratorV1;
  readonly requiredFeatures: readonly string[];
  readonly skeleton: RuntimeSkeletonMetadataV1;
  readonly atlases: readonly RuntimeAtlasReferenceV1[];
  readonly images: readonly RuntimeImageV1[];
  readonly audios: readonly RuntimeAudioV1[];
  readonly fonts: readonly RuntimeFontV1[];
  readonly bones: readonly RuntimeBoneV1[];
  readonly slots: readonly RuntimeSlotV1[];
  readonly attachments: readonly RuntimeAttachmentV1[];
  readonly constraints: readonly RuntimeConstraintV1[];
  readonly skins: readonly RuntimeSkinV1[];
  readonly events: readonly RuntimeEventDefinitionV1[];
  readonly animations: readonly RuntimeAnimationV1[];
}

export type AtlasColorSpaceV1 = "srgb" | "linear";
export type AtlasAlphaModeV1 = "straight" | "premultiplied";

export interface AtlasPageV1 {
  readonly pageId: string;
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: string;
  readonly minFilter: string;
  readonly magFilter: string;
  readonly wrapU: string;
  readonly wrapV: string;
}

export interface AtlasRegionV1 {
  readonly regionId: string;
  readonly imageId: string;
  readonly pageId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly rotation: "none" | "clockwise90";
  readonly edgeExtension: number;
  readonly uvs: readonly [number, number][];
}

export interface AtlasDocumentV1 {
  readonly format: "cane-atlas";
  readonly formatVersion: RuntimeVersionV1;
  readonly atlasId: string;
  readonly name: string;
  readonly colorSpace: AtlasColorSpaceV1;
  readonly alphaMode: AtlasAlphaModeV1;
  readonly pages: readonly AtlasPageV1[];
  readonly regions: readonly AtlasRegionV1[];
}

export interface RuntimeDirectTextureV1 {
  readonly kind: "direct";
  readonly imageId: string;
  readonly path: string;
  readonly colorSpace: "srgb";
  readonly alphaMode: "straight";
}

export interface RuntimeAtlasTextureV1 {
  readonly kind: "atlas";
  readonly imageId: string;
  readonly atlasId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly regionId: string;
  readonly colorSpace: AtlasColorSpaceV1;
  readonly alphaMode: AtlasAlphaModeV1;
}

export type RuntimeTextureV1 = RuntimeDirectTextureV1 | RuntimeAtlasTextureV1;

export interface RuntimeFinalTintV1 {
  readonly lightRgb: readonly [number, number, number];
  readonly alpha: number;
  readonly darkRgb: readonly [number, number, number] | null;
}

export type RuntimeTriangleFacingV1 = "towardViewer" | "awayFromViewer" | "edgeOn";

export interface RuntimeRenderAttachmentV1 {
  readonly drawIndex: number;
  readonly sourceZIndex: number;
  readonly slotId: string;
  readonly attachmentId: string;
  readonly imageId: string;
  readonly geometryKind: "regionQuad" | "meshTriangles";
  readonly texture: RuntimeTextureV1;
  readonly blendMode: RuntimeBlendModeV1;
  readonly tint: RuntimeFinalTintV1;
  readonly twoColor: boolean;
  readonly sourceAffine: AffineV1;
  readonly worldVerticesXy: readonly number[];
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
  readonly authoredTriangleFacing: readonly RuntimeTriangleFacingV1[];
  readonly frontFace: "counterClockwise";
}

export interface RuntimeRenderPacketV1 {
  readonly coordinateSystem: "xRightYUp";
  readonly uvOrigin: "topLeft";
  readonly tintColorSpace: "srgb";
  readonly tintAlphaMode: "straight";
  readonly attachments: readonly RuntimeRenderAttachmentV1[];
}

export interface RuntimeBoneFrameV1 {
  readonly id: string;
  readonly matrix: AffineV1;
  readonly x: number;
  readonly y: number;
  readonly rotationDegrees: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export type RuntimeLifecycleEventKindV1 =
  | "start"
  | "interrupt"
  | "end"
  | "dispose"
  | "complete"
  | "user";

export interface RuntimeEventV1 {
  readonly trackIndex: number;
  readonly animationId: string | null;
  readonly kind: RuntimeLifecycleEventKindV1;
  readonly timelineTimeSeconds: number | null;
  readonly eventId: string | null;
  readonly name: string | null;
  readonly integerValue: number | null;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly audioId: string | null;
  readonly volume: number;
  readonly balance: number;
}

export interface RuntimeFrameV1 {
  readonly sequence: number;
  readonly timeSeconds: number;
  readonly bones: readonly RuntimeBoneFrameV1[];
  readonly activeSkinIds: readonly string[];
  readonly sampledSkinIds: readonly string[];
  readonly events: readonly RuntimeEventV1[];
  readonly renderPacket: RuntimeRenderPacketV1;
}

export interface RuntimeBoneLocalV1 {
  readonly x: number;
  readonly y: number;
  readonly rotationDegrees: number;
  readonly shearXDegrees: number;
  readonly shearYDegrees: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface RuntimeBoneLocalStateV1 {
  readonly boneId: string;
  readonly local: RuntimeBoneLocalV1;
  readonly transformMode: BoneTransformModeV1;
}

export interface RuntimeRegionAttachmentPoseV1 {
  readonly attachmentId: string;
  readonly x: number;
  readonly y: number;
  readonly rotationDegrees: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface RuntimeSlotStateV1 {
  readonly slotId: string;
  readonly attachmentKey: string | null;
  readonly attachmentId: string | null;
  readonly tint: RuntimeFinalTintV1;
  readonly drawIndex: number;
}

export interface RuntimePointAttachmentPoseV1 {
  readonly attachmentId: string;
  readonly x: number;
  readonly y: number;
  readonly rotationDegrees: number;
}

export interface RuntimePointV1 {
  readonly x: number;
  readonly y: number;
}

export interface RuntimePathConstraintPositionV1 {
  readonly constraintId: string;
  readonly point: RuntimePointV1;
  readonly tangentDegrees: number;
  readonly distance: number;
  readonly pathLength: number;
  readonly pathStart: RuntimePointV1;
  readonly pathEnd: RuntimePointV1;
  readonly closed: boolean;
}

/** Canonical Transform-constraint offsets that preserve the current sampled pose. */
export interface RuntimeTransformConstraintOffsetsV1 {
  readonly rotationDegrees: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearYDegrees: number;
}

export interface RuntimeIkConstraintParametersV1 {
  readonly type: "ik";
  readonly target: RuntimePointV1;
  readonly mix: number;
  readonly bendPositive: boolean;
  readonly compress: boolean;
  readonly stretch: boolean;
  readonly softness: number;
}

export interface RuntimeTransformConstraintParametersV1 {
  readonly type: "transform";
  readonly rotationDegrees: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearYDegrees: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly mixScaleX: number;
  readonly mixScaleY: number;
  readonly mixShearY: number;
}

export interface RuntimePathConstraintParametersV1 {
  readonly type: "path";
  readonly rotationDegrees: number;
  readonly position: number;
  readonly spacing: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
}

export interface RuntimePhysicsConstraintParametersV1 {
  readonly type: "physics";
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly shearX: number;
  readonly limit: number;
  readonly fps: number;
  readonly inertia: number;
  readonly strength: number;
  readonly damping: number;
  readonly mass: number;
  readonly wind: number;
  readonly gravity: number;
  readonly mix: number;
}

export interface RuntimeSliderConstraintParametersV1 {
  readonly type: "slider";
  readonly sourceOffset: number;
  readonly timeOffset: number;
  readonly timeScale: number;
  readonly rangeMax: number;
  readonly time: number;
  readonly mix: number;
}

export type RuntimeConstraintParametersV1 =
  | RuntimeIkConstraintParametersV1
  | RuntimeTransformConstraintParametersV1
  | RuntimePathConstraintParametersV1
  | RuntimePhysicsConstraintParametersV1
  | RuntimeSliderConstraintParametersV1;

export interface RuntimeSlotTintOverrideV1 {
  readonly lightRgb: readonly [number, number, number];
  readonly alpha: number;
  readonly darkRgb: readonly [number, number, number] | null;
}

export interface RuntimeIkConstraintOverrideV1 {
  readonly type: "ik";
  readonly target?: RuntimePointV1 | null;
  readonly mix?: number | null;
  readonly bendPositive?: boolean | null;
  readonly compress?: boolean | null;
  readonly stretch?: boolean | null;
  readonly softness?: number | null;
}

export interface RuntimeTransformConstraintOverrideV1 {
  readonly type: "transform";
  readonly rotationDegrees?: number | null;
  readonly x?: number | null;
  readonly y?: number | null;
  readonly scaleX?: number | null;
  readonly scaleY?: number | null;
  readonly shearYDegrees?: number | null;
  readonly mixRotate?: number | null;
  readonly mixX?: number | null;
  readonly mixY?: number | null;
  readonly mixScaleX?: number | null;
  readonly mixScaleY?: number | null;
  readonly mixShearY?: number | null;
}

export interface RuntimePathConstraintOverrideV1 {
  readonly type: "path";
  readonly rotationDegrees?: number | null;
  readonly position?: number | null;
  readonly spacing?: number | null;
  readonly mixRotate?: number | null;
  readonly mixX?: number | null;
  readonly mixY?: number | null;
}

export interface RuntimePhysicsConstraintOverrideV1 {
  readonly type: "physics";
  readonly x?: number | null;
  readonly y?: number | null;
  readonly rotate?: number | null;
  readonly scaleX?: number | null;
  readonly shearX?: number | null;
  readonly limit?: number | null;
  readonly fps?: number | null;
  readonly inertia?: number | null;
  readonly strength?: number | null;
  readonly damping?: number | null;
  readonly mass?: number | null;
  readonly wind?: number | null;
  readonly gravity?: number | null;
  readonly mix?: number | null;
}

export interface RuntimeSliderConstraintOverrideV1 {
  readonly type: "slider";
  readonly sourceOffset?: number | null;
  readonly timeOffset?: number | null;
  readonly timeScale?: number | null;
  readonly rangeMax?: number | null;
  readonly time?: number | null;
  readonly mix?: number | null;
}

export type RuntimeConstraintOverrideV1 =
  | RuntimeIkConstraintOverrideV1
  | RuntimeTransformConstraintOverrideV1
  | RuntimePathConstraintOverrideV1
  | RuntimePhysicsConstraintOverrideV1
  | RuntimeSliderConstraintOverrideV1;

/** Partial local-channel replacement for one animation-after evaluation. */
export interface RuntimeBoneLocalPatchV1 {
  readonly x?: number | null;
  readonly y?: number | null;
  readonly rotationDegrees?: number | null;
  readonly shearXDegrees?: number | null;
  readonly shearYDegrees?: number | null;
  readonly scaleX?: number | null;
  readonly scaleY?: number | null;
}

/** Binary32 deltas added to the current sampled local channels. */
export interface RuntimeBoneLocalAdditiveV1 {
  readonly xDelta?: number | null;
  readonly yDelta?: number | null;
  readonly rotationDegreesDelta?: number | null;
  readonly shearXDegreesDelta?: number | null;
  readonly shearYDegreesDelta?: number | null;
  readonly scaleXDelta?: number | null;
  readonly scaleYDelta?: number | null;
}

/** One ordered animation-after, constraint-before operation. */
export type RuntimePoseModifierOperationV1 =
  | {
      readonly operation: "replaceBoneLocal";
      readonly boneId: string;
      readonly local: RuntimeBoneLocalV1;
    }
  | {
      readonly operation: "patchBoneLocal";
      readonly boneId: string;
      readonly patch: RuntimeBoneLocalPatchV1;
    }
  | {
      readonly operation: "addBoneLocal";
      readonly boneId: string;
      readonly delta: RuntimeBoneLocalAdditiveV1;
    }
  | {
      readonly operation: "patchConstraint";
      readonly constraintId: string;
      readonly parameters: RuntimeConstraintOverrideV1;
    };

/** Transient operations consumed by exactly one evaluation. */
export interface RuntimePoseModifiersV1 {
  readonly operations: readonly RuntimePoseModifierOperationV1[];
}

export interface RuntimeGeometryModifierFilterV1 {
  /** Empty or omitted means every published render attachment. */
  readonly attachmentIds?: readonly string[];
  /** Empty or omitted means every Slot. Both filters must match when supplied. */
  readonly slotIds?: readonly string[];
}

/** Stable pseudo-random world-position displacement; no project state is mutated. */
export interface RuntimeDeterministicJitterModifierV1 extends RuntimeGeometryModifierFilterV1 {
  readonly type: "deterministicJitter";
  readonly seed: number;
  readonly amplitudeX: number;
  readonly amplitudeY: number;
  /** Zero produces a static pattern. Positive values select a deterministic time tick. */
  readonly frequencyHz?: number;
}

/** Deterministic radial displacement plus angular wave around a world-space center. */
export interface RuntimeRadialWaveModifierV1 extends RuntimeGeometryModifierFilterV1 {
  readonly type: "radialWave";
  readonly centerX: number;
  readonly centerY: number;
  readonly radialAmplitude: number;
  readonly angularAmplitudeDegrees: number;
  readonly wavelength: number;
  readonly phaseDegrees?: number;
  readonly speedHz?: number;
  /** Zero means no distance falloff; otherwise influence reaches zero at radius. */
  readonly radius?: number;
}

/** Ephemeral safe view over one candidate render attachment. */
export interface RuntimeGeometryEditorV1 {
  readonly slotId: string;
  readonly attachmentId: string;
  readonly drawIndex: number;
  readonly vertexCount: number;
  writePosition(vertexIndex: number, output: { x: number; y: number }): boolean;
  setPosition(vertexIndex: number, x: number, y: number): void;
  addPosition(vertexIndex: number, deltaX: number, deltaY: number): void;
  writeUv(vertexIndex: number, output: { u: number; v: number }): boolean;
  setUv(vertexIndex: number, u: number, v: number): void;
  setLightTint(redByte: number, greenByte: number, blueByte: number, alpha: number): void;
  setDarkTint(redByte: number, greenByte: number, blueByte: number): void;
  clearDarkTint(): void;
}

export interface RuntimeGeometryModifierContextV1 {
  readonly sequence: number;
  readonly timeSeconds: number;
  readonly persistent: boolean;
  readonly operationIndex: number;
}

export type RuntimeGeometryModifierListenerV1 = (
  geometry: RuntimeGeometryEditorV1,
  context: RuntimeGeometryModifierContextV1,
) => void;

/** Runtime-only callback. It is never serialized into Runtime JSON or CANEB. */
export interface RuntimeCustomGeometryModifierV1 extends RuntimeGeometryModifierFilterV1 {
  readonly type: "custom";
  readonly apply: RuntimeGeometryModifierListenerV1;
}

export type RuntimeGeometryModifierOperationV1 =
  | RuntimeDeterministicJitterModifierV1
  | RuntimeRadialWaveModifierV1
  | RuntimeCustomGeometryModifierV1;

export interface RuntimeGeometryModifiersV1 {
  readonly operations: readonly RuntimeGeometryModifierOperationV1[];
}

export interface RuntimeGeometryModifierStatsV1 {
  readonly persistentOperations: number;
  readonly transientOperations: number;
  readonly attachmentVisits: number;
  readonly vertexWrites: number;
  readonly uvWrites: number;
  readonly tintWrites: number;
}

/** Ephemeral animation-after pose editor passed to `beforeConstraints`. */
export interface RuntimePoseEditorV1 {
  queryBone(boneId: string): RuntimeBoneLocalV1;
  writeBone(boneId: string, output: {
    x: number;
    y: number;
    rotationDegrees: number;
    shearXDegrees: number;
    shearYDegrees: number;
    scaleX: number;
    scaleY: number;
  }): boolean;
  replaceBoneLocal(boneId: string, local: RuntimeBoneLocalV1): void;
  patchBoneLocal(boneId: string, patch: RuntimeBoneLocalPatchV1): void;
  addBoneLocal(boneId: string, delta: RuntimeBoneLocalAdditiveV1): void;
  patchConstraint(constraintId: string, parameters: RuntimeConstraintOverrideV1): void;
  setConstraintTarget(constraintId: string, x: number, y: number): void;
  setConstraintMix(constraintId: string, mix: number): void;
}

export type RuntimeBeforeConstraintsListenerV1 = (pose: RuntimePoseEditorV1) => void;
export type RuntimeAfterConstraintsListenerV1 = (frame: RuntimeFrameV1) => void;
export type RuntimeEventListenerV1<Kind extends RuntimeLifecycleEventKindV1 = RuntimeLifecycleEventKindV1> =
  (event: RuntimeEventV1 & { readonly kind: Kind }) => void;

export interface RuntimeVertexDeformOverrideV1 {
  readonly space: RuntimeVertexDeformSpaceV1;
  readonly values: readonly number[];
}

/** Complete owned deform buffer produced by a read-only inverse authoring query. */
export interface RuntimeVertexDeformV1 {
  readonly attachmentId: string;
  readonly deformAttachmentId: string;
  readonly space: RuntimeVertexDeformSpaceV1;
  readonly values: readonly number[];
}

export type RuntimeVertexDeformInputV1 =
  | {
      readonly source: "playerCurrent";
      readonly space: RuntimeVertexDeformSpaceV1;
    }
  | {
      readonly source: "values";
      readonly space: RuntimeVertexDeformSpaceV1;
      readonly values: readonly number[];
    };

export interface RuntimeVertexWorldTargetV1 {
  readonly attachmentId: string;
  readonly sourceVertexIndex: number;
  readonly targetWorld: RuntimePointV1;
  readonly currentDeform: RuntimeVertexDeformInputV1;
}

/** One ordered mutation in an atomic persistent authoring-preview transaction. */
export type RuntimeAuthoringOverrideOperationV1 =
  | { readonly operation: "setBoneLocal"; readonly boneId: string; readonly local: RuntimeBoneLocalV1 }
  | { readonly operation: "clearBoneLocal"; readonly boneId: string }
  | {
      readonly operation: "setRegionAttachmentPose";
      readonly attachmentId: string;
      readonly pose: RuntimeRegionAttachmentPoseV1;
    }
  | { readonly operation: "clearRegionAttachmentPose"; readonly attachmentId: string }
  | { readonly operation: "setDrawOrder"; readonly slotIds: readonly string[] }
  | { readonly operation: "clearDrawOrder" }
  | {
      readonly operation: "setVertexDeform";
      readonly attachmentId: string;
      readonly space: RuntimeVertexDeformSpaceV1;
      readonly values: readonly number[];
    }
  | { readonly operation: "clearVertexDeform"; readonly attachmentId: string }
  | {
      readonly operation: "setSlotAttachment";
      readonly slotId: string;
      readonly attachmentId: string | null;
    }
  | { readonly operation: "clearSlotAttachment"; readonly slotId: string }
  | { readonly operation: "setSlotTint"; readonly slotId: string; readonly tint: RuntimeSlotTintOverrideV1 }
  | { readonly operation: "clearSlotTint"; readonly slotId: string }
  | {
      readonly operation: "setConstraint";
      readonly constraintId: string;
      readonly parameters: RuntimeConstraintOverrideV1;
    }
  | { readonly operation: "clearConstraint"; readonly constraintId: string };

export interface RuntimeAuthoringOverridesV1 {
  readonly operations: readonly RuntimeAuthoringOverrideOperationV1[];
}

export interface RuntimeIkConstraintDiagnosticV1 {
  readonly type: "ik";
  readonly residual: number;
  readonly threshold: number;
  readonly iterationsUsed: number;
  readonly iterationLimit: number;
  readonly saturated: boolean;
}

export interface RuntimeTransformConstraintDiagnosticV1 {
  readonly type: "transform";
  readonly drivenBoneCount: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly mixScaleX: number;
  readonly mixScaleY: number;
  readonly mixShearY: number;
  readonly maxTranslationResidual: number | null;
  readonly maxRotationResidualDegrees: number | null;
  readonly maxScaleResidual: number | null;
  readonly maxShearResidualDegrees: number | null;
}

export interface RuntimePathConstraintDiagnosticV1 {
  readonly type: "path";
  readonly drivenBoneCount: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly maxTranslationResidual: number | null;
  readonly maxRotationResidualDegrees: number | null;
  readonly maxScaleResidual: number | null;
}

export interface RuntimePhysicsConstraintDiagnosticV1 {
  readonly type: "physics";
  readonly fixedSteps: number;
  readonly translationOffset: number;
  readonly translationSpeed: number;
  readonly rotationOffsetDegrees: number;
  readonly angularSpeedDegrees: number;
  readonly scaleOffset: number;
  readonly scaleSpeed: number;
  readonly configuredLimit: number;
  readonly requiredLimit: number | null;
  readonly limitSaturated: boolean;
}

export interface RuntimeSliderConstraintDiagnosticV1 {
  readonly type: "slider";
  readonly sourceValue: number | null;
  readonly mappedTimeSeconds: number;
  readonly resolvedTimeSeconds: number;
  readonly targetDurationSeconds: number;
  readonly wrapped: boolean;
  readonly clamped: boolean;
}

export type RuntimeConstraintDiagnosticV1 =
  | RuntimeIkConstraintDiagnosticV1
  | RuntimeTransformConstraintDiagnosticV1
  | RuntimePathConstraintDiagnosticV1
  | RuntimePhysicsConstraintDiagnosticV1
  | RuntimeSliderConstraintDiagnosticV1;

export interface RuntimeConstraintStateV1 {
  readonly constraintId: string;
  readonly kind: RuntimeConstraintV1["type"];
  readonly sampledParameters: RuntimeConstraintParametersV1;
  readonly sampledSliderTimeSeconds: number | null;
  readonly diagnostic: RuntimeConstraintDiagnosticV1 | null;
}

export interface RuntimeAttachmentGeometryV1 {
  readonly attachmentId: string;
  readonly kind: "path" | "boundingBox" | "clipping";
  readonly worldVerticesXy: readonly number[];
  readonly closed: boolean | null;
}

/**
 * Core-normalized geometry used by renderer masks for one Clipping attachment.
 * Every polygon is convex and uses final Cane world coordinates. Adapters must
 * consume this result rather than re-evaluating weights, deformation or hulls.
 */
export interface RuntimeClippingGeometryV1 {
  readonly attachmentId: string;
  readonly slotId: string;
  readonly endSlotId: string | null;
  readonly inverse: boolean;
  readonly convexPolygonsXy: readonly (readonly number[])[];
}

export interface RuntimeBoundsOptionsV1 {
  /** Include final visible Region/Mesh packet geometry in the aggregate AABB. Defaults to true. */
  readonly includeRenderGeometry?: boolean;
  /** Include currently selected Bounding Box attachments and expose them as polygons. Defaults to true. */
  readonly includeBoundingBoxes?: boolean;
  /** Include zero-alpha render attachments in the aggregate AABB. Defaults to false. */
  readonly includeTransparent?: boolean;
}

export interface RuntimeBoundsAabbV1 {
  readonly empty: boolean;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface RuntimeBoundsPolygonV1 {
  readonly slotId: string;
  readonly attachmentId: string;
  readonly drawIndex: number;
  readonly worldVerticesXy: readonly number[];
}

export interface RuntimeBoundsHitV1 {
  readonly slotId: string;
  readonly attachmentId: string;
  readonly drawIndex: number;
}

/** Owned convenience snapshot; use RuntimeBoundsV1 for retained no-allocation storage. */
export interface RuntimeBoundsSnapshotV1 {
  readonly frameSequence: number;
  readonly aabb: RuntimeBoundsAabbV1;
  readonly polygons: readonly RuntimeBoundsPolygonV1[];
}

export type RuntimeVertexDeformSpaceV1 = "vertexPositions" | "weightedInfluenceOffsets";

export interface RuntimeVertexAttachmentSourceGeometryV1 {
  readonly attachmentId: string;
  readonly sourceAttachmentId: string;
  readonly deformAttachmentId: string;
  readonly kind: "mesh" | "path" | "boundingBox" | "clipping";
  readonly setupVerticesXy: readonly number[];
  readonly setupWorldVerticesXy: readonly number[];
  readonly sampledVerticesXy: readonly number[];
  readonly worldVerticesXy: readonly number[];
  readonly deformSpace: RuntimeVertexDeformSpaceV1;
  readonly deformValues: readonly number[];
  readonly fullyWeighted: boolean;
}

/** Coherent owned authoring view of one already-published runtime pose. */
export interface RuntimeAuthoringSnapshotV1 {
  readonly frame: RuntimeFrameV1;
  readonly boneLocalStates: readonly RuntimeBoneLocalStateV1[];
  readonly slotStates: readonly RuntimeSlotStateV1[];
  readonly constraintStates: readonly RuntimeConstraintStateV1[];
  readonly pointAttachmentPoses: readonly RuntimePointAttachmentPoseV1[];
  readonly attachmentGeometries: readonly RuntimeAttachmentGeometryV1[];
  readonly vertexAttachmentSourceGeometries: readonly RuntimeVertexAttachmentSourceGeometryV1[];
  readonly pathConstraintPositions: readonly RuntimePathConstraintPositionV1[];
}

export type RuntimeTrackBlendV1 = "replace" | "additive";

export interface RuntimeSetAnimationV1 {
  readonly trackIndex: number;
  readonly animationId: string;
  readonly looping: boolean;
  readonly mixSeconds?: number | null;
}

export interface RuntimeQueueAnimationV1 {
  readonly trackIndex: number;
  readonly animationId: string;
  readonly looping: boolean;
  readonly delaySeconds: number;
}

export interface RuntimeSetEmptyAnimationV1 {
  readonly trackIndex: number;
  readonly mixDurationSeconds: number;
}

export interface RuntimeQueueEmptyAnimationV1 {
  readonly trackIndex: number;
  readonly mixDurationSeconds: number;
  readonly delaySeconds: number;
}

export interface RuntimeQueuedEntryOptionsV1 {
  readonly trackIndex: number;
  readonly queueIndex: number;
  readonly delaySeconds?: number | null;
  readonly mixDurationSeconds?: number | null;
  readonly looping?: boolean | null;
}

export interface RuntimeQueuedTrackEntryV1 {
  readonly trackIndex: number;
  readonly queueIndex: number;
  readonly animationId: string | null;
  readonly delaySeconds: number;
  readonly mixDurationSeconds: number;
  readonly looping: boolean;
}

export interface RuntimeAnimationRangeV1 {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface RuntimeSetTrackAnimationRangeV1 {
  readonly trackIndex: number;
  readonly range: RuntimeAnimationRangeV1 | null;
}

export interface RuntimeSetTrackEndV1 {
  readonly trackIndex: number;
  readonly trackEndSeconds: number | null;
}

export interface RuntimeSetTrackMixDurationV1 {
  readonly trackIndex: number;
  readonly mixDurationSeconds: number;
}

export interface RuntimeMixV1 {
  readonly fromAnimationId: string;
  readonly toAnimationId: string;
  readonly durationSeconds: number;
}

export interface RuntimeTrackOptionsV1 {
  readonly trackIndex: number;
  readonly alpha?: number | null;
  readonly timeScale?: number | null;
  readonly looping?: boolean | null;
  readonly blend?: RuntimeTrackBlendV1 | null;
  readonly eventThreshold?: number | null;
  readonly attachmentThreshold?: number | null;
  readonly drawOrderThreshold?: number | null;
  readonly holdPrevious?: boolean | null;
}

export interface RuntimeTrackStateV1 {
  readonly trackIndex: number;
  readonly animationId: string | null;
  readonly animationTimeSeconds: number;
  readonly animationDurationSeconds: number;
  readonly animationStartSeconds: number;
  readonly animationEndSeconds: number;
  readonly trackTimeSeconds: number;
  readonly delaySeconds: number;
  readonly trackEndSeconds: number;
  readonly timeScale: number;
  readonly alpha: number;
  readonly looping: boolean;
  readonly blend: RuntimeTrackBlendV1;
  readonly mixDurationSeconds: number;
  readonly mixTimeSeconds: number;
  readonly mixProgress: number;
  readonly eventThreshold: number;
  readonly attachmentThreshold: number;
  readonly drawOrderThreshold: number;
  readonly holdPrevious: boolean;
  readonly queuedCount: number;
}

export type RuntimeExecutionModeV1 = "strict" | "performance";

export interface RuntimePlayerOptionsV1 {
  /**
   * `strict` publishes frozen DTOs and preserves transactional rollback.
   * `performance` trusts validated runtime data, mutates clocks/physics in
   * place, and reuses unfrozen frame/packet/event workspaces. Performance-mode
   * frames, step event lists, and their nested DTOs are ephemeral views valid
   * only until the player's next mutating call; copy values that must be
   * retained. Failed evaluation is not promised to preserve the prior
   * ephemeral view. This mode reduces steady-state GC.
   */
  readonly executionMode?: RuntimeExecutionModeV1;
  /** Optional instance-local resources validated before the setup frame is published. */
  readonly runtimeResources?: RuntimeResourceSnapshotV1;
  /** Optional ordered persistent final-geometry effects. */
  readonly geometryModifiers?: RuntimeGeometryModifiersV1;
}

export type RuntimeSamplingV1 =
  | { readonly mode: "authored" }
  | { readonly mode: "forceStepped" }
  | { readonly mode: "fixedFrame"; readonly frameStepSeconds: number }
  | { readonly mode: "fixedFrameStepped"; readonly frameStepSeconds: number };

export interface RuntimeSeekV1 {
  readonly timeSeconds: number;
  readonly fixedStepSeconds: number;
  readonly sampling?: RuntimeSamplingV1;
}

export interface RuntimeStepV1 {
  readonly changed: boolean;
  readonly timeSeconds: number;
  readonly frameSequence: number;
  readonly events: readonly RuntimeEventV1[];
}

/** Diagnostic work counts for the operation that published the current frame. */
export interface RuntimeEvaluationStatsV1 {
  readonly animationSamples: number;
  readonly constraintGeometrySolves: number;
  readonly framesPublished: number;
}

export interface RuntimeLoadOptionsV1 {
  readonly atlases?: readonly unknown[];
  /** Reserved compatibility opt-in for future source paths outside the pinned conformance suite. */
  readonly allowUnverifiedFeatures?: boolean;
}

export interface RuntimeLoadWarningV1 {
  readonly code: "unknownOptionalCanebSectionIgnored";
  readonly operation: "loadCaneb";
  readonly message: string;
  readonly sectionTag: string;
}

export interface RuntimePhysicsEnvironmentV1 {
  readonly windX: number;
  readonly windY: number;
  readonly gravityX: number;
  readonly gravityY: number;
}

/**
 * How existing Physics histories respond when the host replaces the character
 * root transform.
 *
 * - move: keep world histories fixed so Physics reacts to ordinary movement.
 * - teleport: reset targeted simulations at the destination.
 * - preserveInertia: transport histories and velocities through the root delta.
 * - clearInertia: transport the current offset but clear lag and velocity.
 */
export type RuntimePhysicsHostMotionModeV1 =
  | "move"
  | "teleport"
  | "preserveInertia"
  | "clearInertia";

export interface RuntimeRootTransformOptionsV1 {
  readonly physicsMode?: RuntimePhysicsHostMotionModeV1;
  /** Omit to apply the mode to every Physics constraint state. */
  readonly constraintId?: string;
}

export interface RuntimeConformanceStatusV1 {
  readonly suiteVersion: "1.8.0";
  readonly manifestSha256: "b03eda20d50e550782c162bb9826c0340a8243fc03de0e42e50fed7eae690df9";
  readonly status: "passed";
}

export interface RuntimeCapabilitiesV1 {
  readonly implementationName: "cane-typescript-runtime";
  readonly implementationVersion: "0.1.0";
  readonly runtimeFormat: RuntimeVersionV1;
  readonly runtimeApi: RuntimeVersionV1;
  readonly numericPrecision: "binary32";
  readonly supportedRuntimeFeatures: readonly string[];
  readonly limitations: readonly string[];
  readonly conformance: RuntimeConformanceStatusV1;
}
