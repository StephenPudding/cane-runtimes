# Cane Project Model v1

This is the normative native wire schema for `project.cane`, the editable
project manifest. It is UTF-8 JSON, not a ZIP and not a binary format. A
project directory keeps resource files beside the manifest (for example
`images/`, `audios/`, `fonts/`); resources are never embedded as data URLs.
`PROJECT_V1.md` specifies directory/save behavior. The production skeleton
payload uses the complete model in `RUNTIME_MODEL_V1.md`; this document defines
the project root, resource records, native ID spellings, and authoring data.

All JSON objects are closed unless a table explicitly says values are extension
JSON. JSON keys are unique, numbers are finite, IDs are non-empty UTF-8 strings
without NUL, and canonical output sorts object keys by UTF-8 bytes. `?` means
optional; omission takes the stated default. `null` is accepted only where
stated.

## Root manifest

All root members are required:

| member | type | v1 constraint |
| --- | --- | --- |
| `format` | string | exactly `"cane-project"` |
| `formatVersion` | `{major:u16,minor:u16}` | major is `1`; reader accepts supported minor versions |
| `requiredFeatures` | `string[]` | ASCII lower-case feature names, byte-sorted and duplicate-free; v1 has no standardized project feature |
| `projectId` | `id<project>` | stable project identity |
| `name` | string | non-empty display name |
| `settings` | object | `{defaultReferenceScale:number>0}`; new document default `100` |
| `images` | [image](#resources)[] | may be empty |
| `audios` | [audio](#resources)[] | may be empty |
| `fonts` | [font](#resources)[] | may be empty |
| `skeletons` | [project skeleton](#project-skeletons)[] | non-empty |
| `extensions` | `object<string, JSON value>` | vendor/project extensions |

Unknown root fields, old roots such as `assets`/`editor`, embedded `dataUrl`,
and generic `id` fields are rejected. Project-only data MUST NOT be put in a
runtime export; Runtime JSON rejects `timelineId`, `keyId`, editor state and
undo history.

## Resources

Resource records are closed. `path` is a portable relative forward-slash path
under the project directory: no absolute path, drive prefix, `.`/`..`/empty
component, backslash, or NUL. The file must exist and resolve inside the
project directory. Paths cannot collide after ASCII case folding. `sha256`, if
present, is the lower-case hexadecimal SHA-256 of the resource bytes.

| object | required members | optional members |
| --- | --- | --- |
| Image | `imageId:id<image>`, `name:string`, `path:path`, `mimeType:string` | `width:u32>0`, `height:u32>0`, `sha256:string` |
| Audio | `audioId:id<audio>`, `name:string`, `path:path`, `mimeType:string` | `sha256:string` |
| Font | `fontId:id<font>`, `name:string`, `path:path`, `mimeType:string` | `sha256:string` |

`name` and `mimeType` are non-empty. A recorded image size must equal the
decoded image. Every supplied digest is verified at load. There is no
`atlasId` here; atlas packing is export data.

## Project skeletons

Each skeleton is a closed object:

| member | type | constraint |
| --- | --- | --- |
| `skeletonId` | `id<skeleton>` | unique stable ID |
| `name` | string | non-empty |
| `visible` | boolean | editor visibility only |
| `export` | boolean | export selection |
| `referenceScale` | number | positive |
| `bones`, `slots`, `attachments`, `constraints`, `skins`, `events`, `animations` | arrays | required production payload collections |
| `authoring` | [authoring metadata](#authoring-metadata) | required |

All setup and animation fields use `RUNTIME_MODEL_V1.md`, including every
attachment, weight, bind inverse, mesh link, constraint, skin, event,
timeline, curve, draw-order and legality rule. IDs have the same namespace and
reference targets as the runtime model, but the **definition key spelling** is
different in the project file.

### Native definition ID spellings

Runtime JSON uses `id` for a definition. Project v1 gives each definition an
explicit key. References do not change: they use `boneId`, `slotId`,
`attachmentId`, `constraintId`, `skinId`, `eventId`, and `animationId`.
Generic `id` is invalid in the rows below.

| collection | Project definition key | Runtime export key | namespace |
| --- | --- | --- | --- |
| `bones[]` | `boneId` | `id` | `id<bone>` |
| `slots[]` | `slotId` | `id` | `id<slot>` |
| `attachments[]` | `attachmentId` | `id` | `id<attachment>` |
| `constraints[]` | `constraintId` | `id` | `id<constraint>` |
| `skins[]` | `skinId` | `id` | `id<skin>` |
| `events[]` | `eventId` | `id` | `id<event>` |
| `animations[]` | `animationId` | `id` | `id<animation>` |

Thus a Project bone starts `{"boneId":"root","name":"root",...}` but its
runtime export starts `{"id":"root","name":"root",...}`. This is only a
wire-name substitution, not a second ID or a changed reference. Attachment
images are always `imageId`/`imageIds`; event audio is always `audioId`.
`assetId`, `assetIds`, `audioPath`, and IK `scaleYMode` are forbidden native
spellings; IK uses `uniform:false|true|"volume"`.

### Production payload rules in project form

Project production payload is the shared model after the substitution table:

* Bones keep parent, shear, transform mode and reflection-preserving scale;
  slots keep attachment, z-order, blend, light/dark tint; all six attachment
  tags retain their geometry, sequences, linked mesh, weights and inverses.
* IK, transform, path, physics and slider constraints use the same closed
  members/defaults/ranges. Skins/events and every animation timeline/key/curve
  family use the same fields and reference checks.
* A selected skeleton exports by removing `authoring`, renaming only definition
  keys to `id`, selecting matching resources, and building the Runtime root.
  An exporter MUST NOT invent a separate animation model.

## Authoring metadata

`authoring` is a closed object:

| member | type | default |
| --- | --- | --- |
| `timelineIdentities` | [timeline identity](#timeline-identity)[] | `[]`; omitted by compact output when empty |
| `shared` | `object<string, JSON value>` | `{}`; omitted by compact output when empty |

It stores stable editor identity and semantic authoring information only; it
does not change animation evaluation. In `authoring` and `extensions`, a key at
any nesting level is prohibited if case/underscore-insensitively it is one of:
`camera`, `selection`, `selected`, `cursor`, `currentTime`, `playhead`,
`playing`, `playback`, `viewport`, `window`, `layout`, `dock`, `panel`,
`recent`, `history`, `undo`, `redo`, `prompt`, `plan`, `evaluation`,
`commandLog`, `session`. This excludes transient UI state and AI execution
data from the project.

### Timeline identity

| member | type | constraint |
| --- | --- | --- |
| `timelineId` | `id<timeline>` | unique in owning skeleton |
| `animationId` | `id<animation>` | resolves in owning skeleton |
| `boneId`, `slotId`, `attachmentId`, `constraintId`, `skeletonId` | nullable IDs | target selected by channel; absent otherwise |
| `channel` | [closed enum](#timeline-channel-enum) | determines target kind and production channel |
| `declarationOrdinal` | `u32` | zero-based occurrence for target/channel |
| `keys` | [key identity](#key-identity)[] | one per production key in declaration order |

Target fields are mutually exclusive. `bone.*` needs `boneId`, `slot.*` needs
`slotId`, `attachment.*` needs `attachmentId`, `constraint.*` needs
`constraintId`, and `skeleton.*` needs the owning `skeletonId`. The identity
binds `(animationId,target,channel,declarationOrdinal)` to an existing
production timeline; it contains no animation values.

### Timeline channel enum

`bone.translate`, `bone.translate-x`, `bone.translate-y`, `bone.rotate`,
`bone.scale`, `bone.scale-x`, `bone.scale-y`, `bone.shear`, `bone.shear-x`,
`bone.shear-y`, `bone.transform-mode`, `slot.attachment`, `slot.tint`,
`slot.alpha`, `attachment.region-transform`, `attachment.deform`,
`attachment.sequence`, `constraint.ik`, `constraint.transform`,
`constraint.path`, `constraint.physics`, `constraint.slider`, `skeleton.event`,
`skeleton.draw-order`, `skeleton.draw-order-folder`, `skeleton.skin`.

The channel must correspond to a populated matching production timeline/array
in the referenced animation.

### Key identity

`{keyId:id<key>,declarationOrdinal:u32}`. `keyId` is unique within its timeline
identity. Ordinal is zero-based persisted key order, not a time/frame number;
key identity count equals the production key count.

## Extensions

`extensions` maps non-empty vendor-qualified keys (recommended
`vendor.feature`) to JSON values. Values MAY carry unmodeled semantic
authoring data, but MUST NOT shadow standard fields, alter runtime behavior,
or contain runtime caches, UI/session state, undo/redo, AI prompts/plans,
evaluations, or command logs. Unknown extensions are preserved as semantic JSON
where safe, and are never exported into Runtime JSON/CANEB.

## Checked examples

The native spellings and hierarchy were checked against
`fixtures/editor/spine-mesh-attachments/project.cane` and
`fixtures/editor/two-skeleton-workspace/project.cane`. Existing validation
converts native project IDs before applying shared production validators. The
strict Project v1 boundary rejects generic definition `id`, `assetId`,
`assetIds`, `audioPath`, IK `scaleYMode`, embedded `dataUrl`, and legacy root
members. It also rejects old bone `transform`, `inherit`, `inheritRotation`,
and `inheritScale` aliases plus PascalCase transform-mode values. Native bones
must explicitly carry `shearX`, `shearY`, and `transformMode`; the spellings in
this document are the only Project v1 wire contract.
