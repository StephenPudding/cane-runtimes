# Cane Project Format v1

Status: normative for major version 1.

The exhaustive native `project.cane` schema, including explicit Project ID
spellings and authoring identity metadata, is [Cane Project Model v1](PROJECT_MODEL_V1.md).

A Cane authoring project is a directory. Its portable entry point is the UTF-8 JSON file
`project.cane`; it is not a ZIP and not a binary file.

The saved manifest uses the pretty [Cane Canonical JSON v1](CANONICAL_JSON_V1.md) profile.

```text
Hero/
  project.cane
  images/
  audios/
  fonts/
  sources/
  .cane/
    user.json
    cache/
    thumbnails/
    autosave/
  build/
```

`project.cane` and referenced files under `images`, `audios`, `fonts`, and `sources` are portable
project content. `.cane/user.json` is per-user state. Cache, thumbnail, autosave, and build
directories can be deleted without changing authored animation data.

## Encoding and root

- UTF-8 without a byte-order mark.
- JSON object root; duplicate object keys are invalid.
- JSON names are case-sensitive.
- All numbers used by animation data must be finite.
- Canonical writer indentation is two spaces and the file ends in one LF.
- Required root members occur in this canonical order:

```json
{
  "format": "cane-project",
  "formatVersion": { "major": 1, "minor": 0 },
  "requiredFeatures": [],
  "projectId": "project-hero",
  "name": "Hero",
  "settings": {
    "defaultReferenceScale": 100.0
  },
  "images": [],
  "audios": [],
  "fonts": [],
  "skeletons": [],
  "extensions": {}
}
```

The root must not contain `assets`, `dataUrl`, `editor`, runtime playback state, Bevy entities, AI
prompts, plans, evaluations, or command logs. Their presence is an error, not a legacy alias.

`projectId` and every object ID are nonempty, case-sensitive, opaque UTF-8 strings. Names are
display labels and are never references. IDs are stable across rename, reorder, save, and export.

`requiredFeatures` is unique and sorted by UTF-8 bytes. A reader rejects an unknown entry with
`format.feature-unsupported` before exposing a partial project. `extensions` is a key-sorted map
of optional portable authoring metadata. Readers preserve unknown extension values with their JSON
semantics while the canonical writer may normalize object-key order and whitespace; an extension
whose meaning is necessary to edit the project safely must also declare its feature name in
`requiredFeatures`. Version 1.0 defines no optional required project feature, so every nonempty
`requiredFeatures` list is rejected by a 1.0 reader.

## Resources

Images, audio, and fonts use separate typed tables.

```json
{
  "images": [
    {
      "imageId": "image-body",
      "name": "Body",
      "path": "images/body.png",
      "mimeType": "image/png",
      "width": 512,
      "height": 512
    }
  ],
  "audios": [
    {
      "audioId": "audio-step",
      "name": "Step",
      "path": "audios/step.ogg",
      "mimeType": "audio/ogg"
    }
  ],
  "fonts": [
    {
      "fontId": "font-dialog",
      "name": "Dialog",
      "path": "fonts/dialog.woff2",
      "mimeType": "font/woff2"
    }
  ]
}
```

The optional `sha256` member is a lowercase 64-digit digest of the referenced file. Width and
height, when present, are positive source-image pixels and must match decoded image metadata during
strict validation.

Core references use `imageId`, `imageIds`, `audioId`, and `fontId`. `assetId` is not a native Cane
v1 field. Resource bytes are never embedded in JSON.

## Portable paths

A project path:

- is relative to the project directory and uses `/`;
- has no empty, `.` or `..` segment;
- contains no backslash, colon, NUL, ASCII control, `<`, `>`, `"`, `|`, `?`, or `*`;
- has no segment ending in a space or dot;
- has no Windows device-name segment such as `CON`, `NUL`, `COM1`, or `LPT1`, including names with
  an extension;
- is at most 1,024 UTF-8 bytes and has segments of at most 255 UTF-8 bytes;
- is Unicode NFC;
- resolves beneath the project root after symlink resolution.

Image paths start with `images/`, audio paths with `audios/`, font paths with `fonts/`, and source
paths with `sources/`. ASCII-case-insensitive path collisions are forbidden.

## Skeleton records

One project may author multiple skeletons. Each enabled skeleton exports to an independent runtime
file.

```json
{
  "skeletonId": "skeleton-hero",
  "name": "Hero",
  "visible": true,
  "export": true,
  "referenceScale": 100.0,
  "bones": [],
  "slots": [],
  "attachments": [],
  "constraints": [],
  "skins": [],
  "events": [],
  "animations": [],
  "authoring": {}
}
```

`visible` is shared scene composition state. It does not determine runtime inclusion; `export`
does. `referenceScale` is finite and greater than zero. Bones, slots, attachments, constraints,
skins, events, and animations retain their stable IDs and typed references.

The `authoring` object contains shared information needed to continue editing, such as folders,
display colors/icons, mesh binding metadata, export inclusion, and stable identities. It must not
contain camera, selection, current time, window, panel, or recent-file state.

## Stable timeline and key identities

Every authoring timeline has a `timelineId`, and every authoring key has a `keyId`. These IDs are
part of `project.cane` even though Runtime JSON removes them.

A timeline identity remains unchanged when its target is renamed or its keys are retimed. A key
identity remains unchanged when its time, curve, or value changes. Copying creates new IDs;
moving/reordering retains IDs. Deleting and undoing restores the same IDs. IDs are never derived
from array index, time, target name, or value.

Animation values remain in the production `animations` arrays. Stable identities are a parallel
side table at `skeleton.authoring.timelineIdentities`; the side table does not duplicate times,
curves, or channel values. Each timeline identity binds to exactly one existing typed timeline by:

- `timelineId`;
- `animationId`;
- the target ID (`boneId`, `slotId`, `attachmentId`, `constraintId`, or skeleton ID);
- a closed channel name defined by the Runtime JSON schema;
- `declarationOrdinal`, which disambiguates multiple declarations of the same target/channel pair;
- a `keys` array containing only `keyId` and `declarationOrdinal`.

The timeline `declarationOrdinal` is zero-based within one animation/target/channel binding. Key
ordinals are zero-based indexes into the bound production key array and must cover that array
exactly once. When an editor retimes or reorders production keys it updates this binding while
retaining each stable `keyId`. Equal key times are legal and production declaration order breaks
the tie. Timeline/key IDs must be unique across the complete project.

## Events and resource references

An event definition and event key use `audioId`, never an audio path. A missing audio is invalid.
Attachment regions, meshes, and sequences use `imageId`/`imageIds`. Fonts are referenced only by
features whose schema explicitly accepts `fontId`.

## `.cane/user.json`

Per-user state has its own discriminator and version:

```json
{
  "format": "cane-user-state",
  "formatVersion": { "major": 1, "minor": 0 },
  "projectId": "project-hero",
  "activeSkeletonId": "skeleton-hero",
  "skeletons": {
    "skeleton-hero": {
      "activeAnimationId": "animation-idle",
      "activeSkinIds": ["skin-default"],
      "timeSeconds": 0.0,
      "loop": true,
      "camera": { "x": 0.0, "y": 0.0, "zoom": 1.0 },
      "selection": []
    }
  }
}
```

The editor may ignore or reset invalid user state without changing `project.cane`. User state is
never included in Runtime JSON/CANEB or used to change deterministic animation evaluation.

## Save transaction

The format layer's `save_project_path_v1`/`save_project_directory_v1` functions are atomic
**manifest-only** primitives. They are appropriate only when a caller has already staged an
otherwise immutable resource tree; they validate resource files visible at that location and
replace `project.cane`, but do not claim to transact arbitrary resource edits.

The native editor's public whole-project save flow is
`editor-core::save_native_project_directory_v1`. It validates the complete project and every
referenced resource before replacing the project directory:

1. Allocate a unique staging directory beside the destination project directory.
2. Copy preserved `sources`, `build`, cache, thumbnails, and autosave content from an existing
   project without following symbolic links.
3. Create the required directory layout and write all portable resources, `.cane/user.json`, and
   canonical `project.cane` into staging.
4. Reload/compare the staged manifest, reject embedded payloads, and flush the staging directory.
5. If a destination exists, rename it to a unique sibling rollback directory.
6. Rename the complete staging directory to the destination in one same-parent commit.
7. If that commit fails, restore the rollback directory. After a successful commit, remove the
   rollback directory and flush the parent where supported.

Before the directory rename, the old destination remains authoritative. A failed commit restores
it; if both commit and rollback fail, the structured error reports the retained rollback path.
The save never exposes a destination containing a new manifest paired with only some new
resources.

## Legacy rejection

The loader examines the root discriminator before domain deserialization.

- Missing `format` with old `version/assets/editor` shape: `format.legacy-unsupported`.
- `format` other than `cane-project`: `format.kind-mismatch`.
- unsupported major: `format.version-unsupported`.
- unknown required feature: `format.feature-unsupported`.
- malformed or duplicate JSON: `format.malformed`.
- unsafe path: `format.invalid-relative-path`.
- digest, decoded image, or declared dimension mismatch: `format.resource-mismatch`.

There is no implicit migration from `.cane-editor.json`, `.cane.json`, `.cane.zip`, `cane.json`, or
embedded `dataUrl` projects. Removed entry names are matched ASCII case-insensitively, including
prefixed names such as `Hero.cane.json`; a directory containing only one of those entries fails
with `format.legacy-unsupported` instead of a generic missing-manifest error. Renaming an old JSON
document to `project.cane` does not bypass the check: its old root shape is rejected before domain
deserialization.

The same structured rejection applies to removed native aliases such as generic definition `id`,
bone `transform`/`inherit`/`inheritRotation`/`inheritScale`, PascalCase transform-mode values, and
IK `scaleYMode`. Bone `shearX`, `shearY`, and `transformMode` are required wire members; omission
is malformed Project v1 rather than an invitation to synthesize an old default.

`decode_project_v1`, `load_project_path_v1`, and `load_project_directory_v1` are the public native
read boundary. The in-memory `ProjectFile`/`EditorProjectFile` domain structs are editor
implementation data, not alternate JSON project formats, and no compatibility-normalizing string
loader or migration API is exposed.
