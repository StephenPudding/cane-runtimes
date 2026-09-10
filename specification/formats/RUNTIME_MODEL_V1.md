# Cane Runtime Model v1

This is the normative, language-neutral data model for the **native Cane v1
runtime wire format**.  An implementation of Runtime JSON v1 or CANEB v1 must
be possible from this document and the container documents alone; Rust names
are deliberately not part of the contract.  `RUNTIME_JSON_V1.md` defines the
document/container rules and `CANEB_V1.md` defines the binary envelope.
Exact evaluation of attachment vertices, weights, deform, linked meshes,
clipping, Atlas projection, winding, tint, and renderer color is defined by
[Geometry and Render Algorithms v1](../runtime/GEOMETRY_RENDER_ALGORITHMS_V1.md).
Exact Path sampling, Physics integration, and Slider animation mapping is
defined by
[Path, Physics, and Slider Constraint Algorithms v1](../runtime/PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).

Normative words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have their usual
RFC meanings.  Object members not listed by the applicable table are invalid.
JSON is UTF-8, object keys are unique, and every number is finite.  Canonical
writers sort object keys by UTF-8 byte order; arrays preserve declaration
order.  All runtime IDs are non-empty UTF-8 strings without NUL and reference
the matching ID namespace below.  A nullable field accepts either its stated
value or `null`; an omitted optional field takes its shown default.

## Shared scalar conventions

| notation | JSON representation | meaning |
| --- | --- | --- |
| `id<T>` | string | stable identifier in namespace `T`; references MUST resolve in the same document |
| `number` | JSON number | finite IEEE-754 compatible scalar; positions/lengths use `skeleton.unit`, angles use `skeleton.angleUnit`, time uses seconds |
| `u32` / `u16` | non-negative JSON integer | respectively `0..4294967295` / `0..65535` |
| `color` | string | six hexadecimal RGB digits, with optional leading `#`; canonical writers use `#rrggbb` |
| `curve` | `null`, string, or object | described in [Curves](#curves) |

Unless a table explicitly gives a narrower range, numbers are finite.  Values
used as interpolation mix/opacity/weight have the ranges stated below.  IDs,
names and paths are case-sensitive.  Runtime resource paths are portable
relative paths: no absolute path, drive prefix, `.`/`..` component, empty
component, backslash, or NUL.  Two resource paths MUST NOT collide after ASCII
case folding.

## Root document

The root is a closed object.  Every member in this table is required; an empty
array/object is the representation for an empty collection.

| member | type | meaning / constraints |
| --- | --- | --- |
| `format` | string | exactly `"cane-runtime"` |
| `formatVersion` | `{major:u16,minor:u16}` | v1 reader requires `major: 1`; it may read a supported minor version |
| `runtimeApiVersion` | `{major:u16,minor:u16}` | API compatibility version; v1 requires major `1` |
| `requiredFeatures` | `string[]` | ASCII lower-case feature names (`[a-z0-9.-]`), strictly UTF-8-byte sorted and duplicate-free; each must be supported by the reader |
| `generator` | [Generator](#generator) | producing tool identity |
| `skeleton` | [Skeleton metadata](#skeleton-metadata) | document-wide coordinate metadata |
| `atlases` | [Atlas](#resources)[] | atlas resources |
| `images` | [Image](#resources)[] | image resources |
| `audios` | [Audio](#resources)[] | audio resources |
| `fonts` | [Font](#resources)[] | font resources |
| `bones` | [Bone](#bones)[] | setup-pose hierarchy |
| `slots` | [Slot](#slots)[] | draw order and attachment binding |
| `attachments` | [Attachment](#attachments)[] | drawable and geometric objects |
| `constraints` | [Constraint](#constraints)[] | setup constraints |
| `skins` | [Skin](#skins)[] | named attachment substitutions |
| `events` | [Event definition](#skins-and-events)[] | named event defaults |
| `animations` | [Animation](#animations)[] | runtime animation data |

`requiredFeatures` currently uses these standardized names: `attachment.bounding-box`,
`attachment.clipping`, `attachment.mesh`, `attachment.path`, `attachment.point`,
`attachment.region`, `attachment.sequence`, `blend.add`, `blend.multiply`,
`blend.screen`, `constraint.ik`, `constraint.path`, `constraint.physics`,
`constraint.slider`, `constraint.transform`, `event`, `mesh.deform`,
`mesh.weighted`, `skin`, `timeline.draw-order`, `timeline.skin`, and
`tint.two-color`.  A writer MUST list a feature whenever its document uses it.

### Generator

| member | type | constraint |
| --- | --- | --- |
| `name` | string | non-empty producer name |
| `version` | string | non-empty producer version |

### Skeleton metadata

| member | type | constraint |
| --- | --- | --- |
| `skeletonId` | `id<skeleton>` | document identity |
| `name` | string | non-empty display name |
| `unit` | string | exactly `px` in Runtime Format v1 |
| `angleUnit` | string | exactly `deg` in Runtime Format v1 |
| `referenceScale` | number | positive scale used for editor/runtime conversion |

## Resources

| object | members |
| --- | --- |
| **Atlas** | `atlasId:id<atlas>`, `path:path` |
| **Image** | `imageId:id<image>`, `name:string`, exactly one source: `path:path` **or** `atlasId:id<atlas>`; `mimeType:string`; optional `width:u32>0`, `height:u32>0` |
| **Audio** | `audioId:id<audio>`, `name:string`, `path:path`, `mimeType:string` |
| **Font** | `fontId:id<font>`, `name:string`, `path:path`, `mimeType:string` |

Resource `name` and `mimeType` MUST be non-empty.  `Image.atlasId` resolves to
`atlases[].atlasId`; image/atlas source is exclusive.  Runtime attachment
image references use **`imageId`**, never internal or legacy `assetId`.

## Bones

Each bone is a closed object:

| member | type | default / constraint |
| --- | --- | --- |
| `id` | `id<bone>` | required |
| `name` | string | required, non-empty |
| `parentId` | `id<bone> \| null` | `null` means root; if non-null must resolve and the parent graph must be acyclic |
| `x`, `y`, `length` | number | required; `length >= 0` |
| `rotation`, `shearX`, `shearY` | number | required; degrees |
| `scaleX`, `scaleY` | number | required and non-zero |
| `transformMode` | enum | required in canonical runtime output |

`transformMode` is exactly one of `normal`, `onlyTranslation`,
`noRotationOrReflection`, `noScale`, `noScaleOrReflection`.  It controls which
parent transform components a runtime inherits; implementations must preserve
reflection and shear rather than reconstructing only rotation and scale. The
normative matrices and every degenerate branch are specified by
[Core Animation Algorithms v1](../runtime/CORE_ANIMATION_ALGORITHMS_V1.md).

## Slots

| member | type | default / constraint |
| --- | --- | --- |
| `id` | `id<slot>` | required |
| `name` | string | required, non-empty |
| `boneId` | `id<bone>` | required, resolves to a bone |
| `attachmentId` | `string \| null` | setup logical attachment key; see below |
| `zIndex` | signed integer | required; lower is drawn first |
| `blendMode` | enum | required: `normal`, `add`, `multiply`, `screen` |
| `color` | `color` | default `#ffffff` |
| `alpha` | number | default `1`; inclusive range `0..1` |
| `darkColor` | `color \| null` | default `null`; enables two-color tint when non-null |

For a non-null logical attachment key, the string is either an attachment ID
owned by the slot or a non-empty placeholder name declared by at least one
Skin attachment mapping for that slot. Core retains this key separately from
the final resolved attachment ID. Resolution starts with the directly named
attachment, if any, then applies active skins in order: an unnamed mapping
matches the slot unconditionally, a named mapping matches only the selected
placeholder, and the last matching mapping wins. The first declared Skin is
the default attachment Skin. When the sampled active Skin list is non-empty
and does not explicitly contain that default Skin, Core applies the default
Skin immediately before the active list as an implicit fallback. When the
default Skin is explicitly present, its authored position in the active list
is preserved. An empty active list intentionally opts out of all Skin
mappings. The implicit fallback changes only attachment lookup; it is not
added to `activeSkinIds` or `sampledSkinIds` and does not activate Skin-owned
bones or constraints. If no direct attachment or applicable Skin mapping
resolves a placeholder, the final attachment ID is null and the slot draws
nothing while retaining its logical key.

Final render tint is not reconstructed by the host: it is the component-wise
normalized combination of skeleton/slot/attachment and animated tint as
specified by Runtime API v1.  A conforming renderer consumes the resulting
light and dark colors from the Runtime API frame projection.

## Attachments

All attachments have a closed discriminator `type`, a globally unique
`id:id<attachment>`, non-empty `name`, and `slotId:id<slot>` resolving to the
owning slot.  `type` is one of `region`, `mesh`, `path`, `point`,
`boundingbox`, `clipping` (not aliases).  `imageId`, `imageIds`, and `audioId`
are the native spellings; `assetId`, `assetIds`, and `audioPath` are forbidden.
Every mesh, path, bounding-box, and clipping source has at most 65,536 xy
vertices. The exact boundary is accepted; a larger source is a
`resourceLimit` load failure before runtime instance construction.

### Region (`type: "region"`)

Required: `id`, `name`, `slotId`, `imageId:id<image>`, `x:number`, `y:number`,
`rotation:number`, `scaleX:number!=0`, `scaleY:number!=0`.
Optional/default: `color:#ffffff`, `alpha:1` (0..1), `sequence:null`.
`sequence`, when present, is [Attachment sequence](#attachment-sequence).

### Mesh (`type: "mesh"`)

Required: `id`, `name`, `slotId`, `imageId:id<image>`, `rows:u32`,
`cols:u32`, `vertices:number[]`, `uvs:number[]`, `indices:u16[]`,
`weights:Weight[][]`, `bindInverses:BindInverseMap|null`, `edges:u16[]|null`,
`hull:number[]|null`.  Optional/default: `color:#ffffff`, `alpha:1` (0..1),
`sequence:null`, `link:null`.

For a non-linked mesh, vertex and UV arrays are paired xy components and have
either the vertex-grid count `rows * cols` or the cell-grid count
`(rows + 1) * (cols + 1)`; canonical writers SHOULD use vertex-grid
dimensions. Each triangle contributes three `indices` and every index is in
range. An empty outer `weights` array denotes an unweighted mesh. Otherwise
there is exactly one non-empty weight row per vertex, with 1..16 influences
whose weights are non-negative and sum to 1 within `0.001`. `edges`, if
present, has an even count and in-range indices; `hull`, if present, is
xy-paired. A linked mesh has
`link:{parentMeshId:id<attachment>, inheritDeform:boolean=true}`.  Its parent
MUST be a mesh; it inherits source geometry and may not independently claim
incompatible geometry/deform semantics. A linked mesh MUST encode `rows:0`,
`cols:0`, empty `vertices`, `uvs`, `indices`, and `weights`, plus null
`bindInverses`, `edges`, and `hull`. The displayed linked mesh's own `slotId`
remains its render owner, so a parent in another slot is valid.

### Attachment sequence

`{imageIds:id<image>[], setupIndex:u32=0}`.  `imageIds` is non-empty, every ID
resolves, and `setupIndex < imageIds.length`.

### Weights and bind inverses

`Weight` is `{boneId:id<bone>, weight:number, x:number|null, y:number|null}`;
the coordinate pair is either both supplied or both null.  `BindInverseMap` is
an object whose keys are influencing `boneId`s and values are
`{a:number,b:number,c:number,d:number,tx:number,ty:number}`.  Matrix keys are
sorted by canonical writers. An influence with null coordinates requires a
bind inverse for its bone. Weighted deformation uses local influence offsets;
unweighted deformation uses vertex-position offsets. Exact conversion,
normalization, and blend rules are in
[Geometry and Render Algorithms v1](../runtime/GEOMETRY_RENDER_ALGORITHMS_V1.md).

### Path (`type: "path"`)

Required: `id`, `name`, `slotId`.  Optional/default: `closed:false`,
`constantSpeed:true`, `lengths:[]`, `vertices:[]`, `weights:[]`,
`bindInverses:null`.  `vertices` is xy-paired cubic path data, with six values
per knot; there are at least two knots.  `lengths`, if provided, has one
finite, non-negative, non-decreasing cumulative length per knot. Weight and
bind-inverse rules are the same as mesh geometry. For `constantSpeed:false`,
an empty `lengths` array selects the normative deterministic fallback rather
than making the attachment invalid.

### Point (`type: "point"`)

Required: `id`, `name`, `slotId`; optional/default `x:0`, `y:0`, `rotation:0`.

### Bounding box (`type: "boundingbox"`)

Required: `id`, `name`, `slotId`; optional/default `vertices:[]`, `weights:[]`,
`bindInverses:null`.  Vertices are xy-paired and obey the weighted geometry
rules above.

### Clipping (`type: "clipping"`)

Required: `id`, `name`, `slotId`; optional/default `endSlotId:null`,
`convex:false`, `inverse:false`, `vertices:[]`, `weights:[]`,
`bindInverses:null`.  `endSlotId`, when non-null, resolves to a slot at or
after the clipping slot in draw order.  `convex` and `inverse` may only be true
for a valid clipping polygon.

### Current-pose geometry projection (Runtime API only)

Path, BoundingBox, and Clipping source arrays above remain immutable Runtime
Format data. Runtime API v1 additionally exposes an owned
`RuntimeAttachmentGeometryV1` query result with `attachmentId`, closed
`kind:"path"|"boundingBox"|"clipping"`, finite flat `worldVerticesXy`, and
`closed:boolean|null`. This result applies the current sampled bones, weights,
and deform once. It is transient API output: it is not a member of
`Hero.json`, CANEB, Project Format, or RenderPacket.

## Constraints

Every constraint is a closed tagged object with `type`, `id:id<constraint>`,
and non-empty `name`.  `type` is exactly `ik`, `transform`, `path`, `physics`,
or `slider`; IDs are unique across all five kinds.

### IK (`type: "ik"`)

Required members: `chainBoneIds:id<bone>[]` (non-empty, unique, direct
parent-to-child ordered chain),
`targetBoneId:id<bone>|null`, `target:{x:number,y:number}`, `mix:number`
(0..1), `bendPositive:boolean`, `compress:boolean`, `stretch:boolean`,
`uniform:false|true|"volume"`, `softness:number>=0`, `iterations:u32>0`,
`threshold:number>=0`.  `uniform:false` means no scale-Y mode, `true` means
uniform, and `"volume"` means volume preservation.  `scaleYMode` is forbidden
in native Runtime JSON v1.

### Transform (`type: "transform"`)

Required: `boneIds:id<bone>[]` (non-empty), `targetBoneId:id<bone>`.
Optional/default: `local:false`, `relative:false`, `rotation:0`, `x:0`, `y:0`,
`scaleX:0`, `scaleY:0`, `shearY:0`, `mixRotate:1`, `mixX:1`, `mixY:1`,
`mixScaleX:1`, `mixScaleY:1`, `mixShearY:1`, `mapping:null`.  All mix fields
are finite and may extrapolate below zero or above one. A mapping is
`{localSource:false,localTarget:false,clamp:false,properties:SourceMap[]}`.
`SourceMap` is `{property,offset:0,targets:TargetMap[]}` and `TargetMap` is
`{property,offset:0,max:1,scale:1}`.  `property` is exactly `rotate`, `x`,
`y`, `scaleX`, `scaleY`, or `shearY`. Each supplied source has at least one
target. An explicit mapping with an empty `properties` array is a valid no-op;
it is distinct from `mapping:null`, which selects the legacy canonical
same-property Transform behavior.

The exact IK and Transform evaluation order, activation, analytic/CCD,
mapping, reflection, degeneracy, and match-offset behavior is specified by
[IK and Transform Constraint Algorithms v1](../runtime/IK_TRANSFORM_ALGORITHMS_V1.md).

### Path (`type: "path"`)

Required: `boneIds:id<bone>[]` (non-empty), `targetSlotId:id<slot>` (whose
currently selected attachment must be a Path when evaluated),
`positionMode:"fixed"|"percent"`,
`spacingMode:"length"|"fixed"|"percent"|"proportional"`,
`rotateMode:"tangent"|"chain"|"chainScale"`, `rotation:number`,
`position:number`, `spacing:number`, `mixRotate:number`, `mixX:number`,
`mixY:number`. Mixes are 0..1. Exact control-point layout, distance
parameterization, spacing, reflection, solve order, and degeneracy are
specified by
[Path, Physics, and Slider Constraint Algorithms v1](../runtime/PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).

### Physics (`type: "physics"`)

Required: `boneId:id<bone>`.  Optional/default members are `x:0`, `y:0`,
`rotate:0`, `scaleX:0`, `scaleYMode:"none"`, `shearX:0`, `limit:5000`,
`fps:60`, `inertia:1`, `strength:100`, `damping:1`, `mass:1`, `wind:0`,
`gravity:0`, `mix:1`, and each of `inertiaGlobal`, `strengthGlobal`,
`dampingGlobal`, `massGlobal`, `windGlobal`, `gravityGlobal`, `mixGlobal` as
`false`. `scaleYMode` is `none|uniform|volume`; `limit>=0`, `fps>0`;
`x/y/rotate/scaleX/shearX/inertia/damping/mix` are 0..1; `strength>=0`;
and `mass>0`. Fixed-step state, environment forces, reset edges, resource
limits, scale-Y modes, and degeneracy are specified by
[Path, Physics, and Slider Constraint Algorithms v1](../runtime/PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).

### Slider (`type: "slider"`)

Required: `animationId:id<animation>`.  Optional/default: `looping:false`,
`additive:false`, `sourceBoneId:null`, `sourceProperty:"rotate"`,
`sourceOffset:0`, `timeOffset:0`, `timeScale:1`, `rangeMax:0`, `local:false`,
`time:0`, `mix:1`.  `sourceProperty` is one of the transform mapping
properties. `timeScale` is any finite value, including zero and negative;
`rangeMax>=0`; and `mix` is any finite value, including negative and greater
than one. `rangeMax` is authoring/inspection metadata and does not clamp
Runtime API v1 evaluation. `sourceBoneId`, when present, resolves to a bone.
Source spaces, time mapping, layer blending, declaration order, and the
recursion barrier are specified by
[Path, Physics, and Slider Constraint Algorithms v1](../runtime/PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).

## Skins and events

### Skin

`{id:id<skin>, name:string, attachments:SkinAttachment[],
boneIds:id<bone>[], constraintIds:id<constraint>[], export:boolean}`; `name`
is non-empty. A skin attachment is
`{slotId:id<slot>, attachmentId:id<attachment>|null, name:string|null}`.
A non-null attachment must belong to that slot; one skin may not define the
same slot/placeholder twice. `boneIds` and `constraintIds` are unique,
resolving activation memberships. A member listed by no skin is always
active; a listed member is active iff at least one sampled active skin lists
it. A skin ID is referenced by animation skin keys.

### Event definition

`{id:id<event>,name:string,integerValue:integer|null,stringValue:string|null,
numberValue:number|null,audioId:id<audio>|null,volume:number=1,balance:number=0}`.
Name is non-empty; `audioId` resolves when non-null.  `volume` is 0..1 and
`balance` is -1..1.  The native spelling is `audioId` in both definitions and
timeline keys.

## Animations

`Animation` is a closed object:

| member | type / constraint |
| --- | --- |
| `id` | `id<animation>` |
| `name` | non-empty string |
| `fps` | positive number |
| `duration` | non-negative number; at least the latest key time |
| `boneTimelines` | [bone timeline](#bone-timelines)[] |
| `slotTimelines` | [slot timeline](#slot-timelines)[] |
| `attachmentTimelines` | [attachment timeline](#attachment-timelines)[] |
| `constraintTimelines` | [constraint timeline](#constraint-timelines)[] |
| `events` | [event key](#event-and-order-keys)[] |
| `drawOrder` | [draw-order key](#event-and-order-keys)[] |
| `drawOrderFolders` | [draw-order folder](#event-and-order-keys)[] |
| `skins` | [skin key](#event-and-order-keys)[] |

All timeline key arrays are in non-decreasing `time` order; same-time entries
keep declaration order.  Timeline targets resolve and must not duplicate the
same target/channel in an animation.

### Curves

Every interpolated key has `time:number>=0` and `curve:curve|null`.  `null` or
`"linear"` is linear and `"stepped"` is hold. Runtime JSON v1 additionally
has these closed curve objects:

* percent Bezier:
  `{type:"bezier",cx1:number,cy1:number,cx2:number,cy2:number}`;
* value Bezier:
  `{type:"bezier-value",cx1:number,dy1:number,cx2:number,dy2:number}`;
* a one-level property bundle:
  `{type:"properties",default?:simpleCurve|null,
  properties:{canonicalProperty:(simpleCurve|null),...}}`.

A `simpleCurve` is `null`, `"linear"`, `"stepped"`, percent Bezier, or value
Bezier; a property bundle cannot contain another property bundle. `properties`
is non-empty. An explicit null property selects linear interpolation. A
missing property uses `default`, and a missing/null default is linear.
Runtime property names are the following canonical snake-case vocabulary:

```text
x y rotation scale_x scale_y
color_r color_g color_b dark_r dark_g dark_b alpha
target_x target_y mix softness
mix_rotate mix_x mix_y mix_scale_x mix_scale_y mix_shear_y
position spacing
inertia strength damping mass wind gravity slider_time
```

Paired bone keys query `x` or `y`; slot color queries its seven color/alpha
members; region keys query their five transform members; constraint keys query
the corresponding member above. A vocabulary member not queried by that key
is inert. Aliases such as `mixX` are not valid Runtime wire names. The native
exporter canonicalizes authoring aliases and removes authoring-only
`outTangent`/`inTangent` modes; those members are forbidden in Runtime JSON.

All four controls are finite. X controls may lie outside `[0,1]`; exact
monotonic classification and the deterministic non-monotonic fallback are
part of the public algorithm. Discrete channels (attachment, inherit,
sequence, event, draw order, skin) use stepped sampling even if an accepted
curve member is present. Exact duplicate-time selection, interpolation,
Bezier solving, property selection, and pre-first-key behavior are specified
by
[Core Animation Algorithms v1](../runtime/CORE_ANIMATION_ALGORITHMS_V1.md).

### Bone timelines

`{boneId:id<bone>, translate?, translateX?, translateY?, rotate?, scale?,
scaleX?, scaleY?, shear?, shearX?, shearY?, inherit?}`.  Each `?` is an array
or `null`/omitted.  `translate` keys add `x,y`; scalar axes add `value`;
`rotate` adds `angle`; `scale`/`shear` add `x,y`; all additionally use the
common `time,curve`.  `inherit` keys are `{time,inherit:BoneTransformMode}`.
Bone animation scale values are finite and may be zero or negative. A zero
animated scale produces its singular affine matrix; it is not replaced by
epsilon or setup scale. Setup bone scales remain non-zero. The channel names
and `BoneTransformMode` enum are closed as described above.

### Slot timelines

`{slotId:id<slot>,attachment?,color?,alpha?}`.  Attachment keys are
`{time,curve,attachmentId:string|null}` and select the same logical key used by
the setup slot.  Color keys are `{time,curve,color:color,alpha:number,
darkColor:color|null}` with alpha 0..1.  Alpha keys are `{time,curve,alpha}`
with alpha 0..1.

### Attachment timelines

`{attachmentId:id<attachment>,region?,deform?,deformSpace?,sequence?}`.
`region` is only for region attachments and keys are `{time,curve,x,y,rotation,
scaleX,scaleY}`. `deform` is for mesh, Path, bounding-box, and clipping
attachments and keys are `{time,curve,vertices:number[]}`; its length is the
source vertex-position component count for
`deformSpace:"vertexPositions"` (default), or the weighted influence component
count for `"weightedInfluenceOffsets"`. Linked-mesh inheritance rules still
apply. `sequence` is only for region/mesh attachments with a setup sequence and keys are
`{time,mode,index:u32,delay:number}`; mode is `hold|once|loop|pingpong|
onceReverse|loopReverse|pingpongReverse`, and `index` is within the sequence.

### Constraint timelines

Each is `{type, constraintId:id<constraint>, keys:object[]}` and its `type`
matches the referenced setup constraint.  Every key has `time,curve` plus only
the members allowed for its type:

| type | additional optional key members |
| --- | --- |
| `ik` | `targetX`, `targetY`, `mix`, `bendPositive`, `compress`, `stretch`, `softness` |
| `transform` | `mixRotate`, `mixX`, `mixY`, `mixScaleX`, `mixScaleY`, `mixShearY` |
| `path` | `position`, `spacing`, `mixRotate`, `mixX`, `mixY` |
| `physics` | `mix`, `inertia`, `strength`, `damping`, `mass`, `wind`, `gravity`, `reset` |
| `slider` | `sliderTime`, `mix` |

Numeric fields have the corresponding setup-field range except that Slider
`sliderTime` and `mix` are any finite value. Physics mass remains strictly
positive after sampling; if blending crosses zero, the solver uses the
smallest positive binary32 value as specified by its algorithm document.
Boolean fields must be JSON booleans. A constraint timeline key cannot contain
unknown members.

### Event and order keys

* Event key: `{time,curve,eventId:id<event>|null,name:string,integerValue?,
  stringValue?,numberValue?,audioId?,volume?,balance?}`.  `eventId` resolves
  when non-null; supplied audio/volume/balance obey event-definition rules.
* Draw order key: `{time,curve,slotIds:id<slot>[]}`.  It contains every slot
  exactly once, establishing the complete draw order.
* Draw-order folder: `{folderPath:string,slotIds:id<slot>[],keys:DrawOrderKey[]}`.
  Folder paths are display/grouping paths, not filesystem paths; member slots
  are unique and each key orders those slots.
* Skin key: `{time,curve,skinId:id<skin>|null}`; null clears active skin.

## Cross-object legality

Readers MUST reject unresolved references other than declared Slot attachment
placeholder keys, duplicate IDs in a namespace,
attachment/slot ownership mismatches, non-finite numbers, invalid enum/tag
values, cycles in bones, malformed weighted geometry, and unknown members in
closed Runtime JSON v1 objects.  A runtime document MUST NOT carry authoring
members such as `timelineId`, `keyId`, `dataUrl`, `editor`, or `undoHistory`.
Project-only spellings and identity metadata are defined by
`PROJECT_MODEL_V1.md` and are not runtime data.

## Verified wire examples

The field spellings and tag shapes above were checked against
`fixtures/runtime-conformance/v1/inputs/native/runtime-matrix.json` and the
native serializer/strict decoder. The fixture and strict Runtime Format v1
boundary require `unit:"px"` and `angleUnit:"deg"`. Native v1 decoding rejects
legacy aliases (`assetId`, `assetIds`, `audioPath`, generic Project definition
`id`, and IK `scaleYMode`); the spellings in this document are the only native
v1 wire contract.
