# Cane Runtime JSON Format v1

Status: normative for major version 1.

The exhaustive language-neutral field schema (tags, defaults, ranges,
references and timeline keys) is [Cane Runtime Model v1](RUNTIME_MODEL_V1.md).
This document defines the JSON container and compatibility rules.

`Hero.json` is the readable runtime representation of one skeleton. It is not an authoring project
and contains no editor/user state, source-library paths, timeline IDs, or key IDs.

## Root contract

```json
{
  "format": "cane-runtime",
  "formatVersion": { "major": 1, "minor": 0 },
  "runtimeApiVersion": { "major": 1, "minor": 0 },
  "generator": { "name": "Coolbones", "version": "0.1.0" },
  "requiredFeatures": ["attachment.region"],
  "skeleton": {
    "skeletonId": "skeleton-hero",
    "name": "Hero",
    "unit": "px",
    "angleUnit": "deg",
    "referenceScale": 100.0
  },
  "atlases": [],
  "images": [],
  "audios": [],
  "fonts": [],
  "bones": [],
  "slots": [],
  "attachments": [],
  "constraints": [],
  "skins": [],
  "events": [],
  "animations": []
}
```

All displayed members are required, even when an array is empty. `requiredFeatures` is sorted by
UTF-8 bytes and contains no duplicate. Unknown required features are rejected before a runtime
instance is created.

Runtime JSON uses UTF-8, rejects duplicate object keys, finite numbers only, case-sensitive IDs,
seconds for time, `px` for distances, `deg` for angles, X-right/Y-up Cartesian coordinates, and
declaration-order arrays. `skeleton.unit` and `skeleton.angleUnit` are closed v1 literals (`"px"`
and `"deg"`); other strings are errors rather than conversion requests. A compact canonical writer
uses [Cane Canonical JSON v1](CANONICAL_JSON_V1.md).

## Resource records

- `images`: `imageId`, `name`, `mimeType`, optional positive `width`/`height`, and exactly one
  resource source:
  - `path` for an unatlased external image; or
  - `atlasId` for an image resolved by that atlas's direct `imageId` region mapping.
- `audios`: `audioId`, `name`, `path`, `mimeType`.
- `fonts`: `fontId`, `name`, `path`, `mimeType`.
- `atlases`: `atlasId`, `path`, with `path` naming a `cane-atlas` JSON file.

Paths use the portable path rules from Project Format v1 and are relative to the runtime build
directory. A referenced `atlasId` must exist in `atlases`; the corresponding atlas must contain
exactly one region for the `imageId` before a renderable instance can be created. Attachments use
`imageId`/`imageIds`; event defaults and event keys use `audioId`.
`assetId`, `assetIds`, `audioPath`, and embedded `dataUrl` are invalid.

Direct image texels have closed v1 semantics: `rgba8`, sRGB, straight alpha. Atlas-backed image
texel semantics come from the referenced Atlas JSON. A renderer supplies actual decoded direct
image and atlas-page dimensions to `validateDecodedTextureSizes`; declared dimensions never
silently override decoded resource facts.

## Identity and order

Runtime objects retain stable IDs for skeleton, atlas, image, audio, font, bone, slot, attachment,
constraint, skin, event, and animation. References never use names or array positions.

Declaration order is normative for:

- parent-before-child bones;
- slot setup draw order;
- attachment/skin resolution tie-breaking;
- constraint evaluation order;
- animation timelines and equal-time keys;
- event order.

CANEB may use dense indices internally, but its public catalog maps them back to these stable IDs.

## Setup and animation data

The closed v1 setup families are:

- bones: local translation, rotation, shear, scale, length, parent, transform inheritance mode;
- slots: bone, setup attachment, light/dark tint, alpha, blend mode, setup draw index;
- attachments: region, mesh, path, point, bounding box, clipping;
- mesh data: vertices, UVs, triangle indices, hull, weights, bind inverses, linked-mesh source;
- skins: attachment, bone, and constraint membership;
- constraints: IK, transform, path, physics, slider;
- events: typed defaults and optional `audioId`;
- animations: bone, slot, attachment/deform/sequence, constraint, event, draw-order, and skin
  timelines.

Every timeline family and value object is tagged by a closed `type` or `channel`. Unknown values are
errors unless a later minor explicitly pairs them with a declared feature. A runtime never treats
an unknown constraint timeline as opaque JSON.

Runtime keys omit authoring `timelineId` and `keyId`. They keep finite non-negative `time`, typed
values, and the optional curve needed for playback. Keys are sorted by `(time, declarationOrder)`.

## Curves

The v1 curve values are:

- omitted or `"linear"`: linear interpolation;
- `"stepped"`: hold the previous value;
- `{ "type": "bezier", "cx1": x1, "cy1": y1, "cx2": x2, "cy2": y2 }`;
- `{ "type": "bezier-value", "cx1": x1, "dy1": d1, "cx2": x2, "dy2": d2 }`;
- `{ "type": "properties", "default": simpleCurve?, "properties": {...} }`.

All controls are finite. X controls may be outside `[0,1]`. Percent Bezier evaluates Y between
zero and one. Value Bezier evaluates Y through `from+dy1` and `to+dy2`, so it preserves absolute
value overshoot even when the endpoints are equal. Runtime API v1 defines the exact monotonic-X
test, 24-iteration solve, and fixed ten-segment non-monotonic fallback.

A property bundle is one level deep. `default` and every property value are a simple curve or
null, never another property bundle. `properties` is non-empty. Null explicitly means linear;
an absent member falls back to `default`, then linear. Its closed canonical property vocabulary
is:

```text
x y rotation scale_x scale_y
color_r color_g color_b dark_r dark_g dark_b alpha
target_x target_y mix softness
mix_rotate mix_x mix_y mix_scale_x mix_scale_y mix_shear_y
position spacing inertia strength damping mass wind gravity slider_time
```

Runtime JSON rejects aliases, duplicate/unknown property spellings, nested bundles, and authoring
`outTangent`/`inTangent` fields. Native export canonicalizes the authoring spellings before writing
the Runtime model. Discrete channels are stepped regardless of an omitted or accepted curve.

At an exact duplicate key time, the last declared key at that time wins. A zero-length segment
does not divide by zero.

## Feature names

The initial closed feature names are:

```text
attachment.region
attachment.mesh
attachment.path
attachment.point
attachment.bounding-box
attachment.clipping
mesh.weighted
mesh.deform
attachment.sequence
skin
timeline.draw-order
timeline.skin
event
tint.two-color
blend.add
blend.multiply
blend.screen
constraint.ik
constraint.transform
constraint.path
constraint.physics
constraint.slider
```

The exporter derives the minimal required set from actual content. It must not claim a feature that
is absent merely because the exporter can produce it.

## Validation

Validation is whole-document and precedes runtime allocation. It includes:

- format/version/required-feature checks;
- unique IDs and valid references;
- parent order and cycle rejection;
- finite setup, timeline, curve, constraint, and weight values;
- normalized positive weights within documented tolerance;
- valid mesh pair counts, UV counts, indices, hulls, and deform lengths;
- sorted keys and legal animation durations;
- typed resource paths and atlas references;
- no authoring-only or legacy fields.

JSON and CANEB decoding must produce equal validated runtime models and equal sampled output.
