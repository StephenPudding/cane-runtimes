# Cane Atlas JSON Format v1

Status: normative for major version 1.

`Hero-atlas.json` is Cane's native texture-atlas description. It is UTF-8 JSON and does not use or
embed the Spine `.atlas` grammar.

Native build output uses the compact
[Cane Canonical JSON v1](CANONICAL_JSON_V1.md) encoding.

## Root

```json
{
  "format": "cane-atlas",
  "formatVersion": { "major": 1, "minor": 0 },
  "atlasId": "atlas-hero",
  "name": "Hero",
  "colorSpace": "srgb",
  "alphaMode": "straight",
  "pages": [],
  "regions": []
}
```

`colorSpace` is `srgb` or `linear`. `alphaMode` is `straight` or `premultiplied`. These describe
stored texels. Runtime final tint remains straight and is converted/premultiplied exactly once by
the renderer according to this metadata.

## Pages

```json
{
  "pageId": "page-0",
  "image": "Hero.png",
  "width": 2048,
  "height": 2048,
  "pixelFormat": "rgba8",
  "minFilter": "linear",
  "magFilter": "linear",
  "wrapU": "clamp",
  "wrapV": "clamp"
}
```

Page IDs are stable within an export. Image paths are safe relative paths. Dimensions are positive
pixels and must match the decoded texture. Structural Atlas parsing can occur before texture I/O;
the host must then supply a complete decoded-page size catalog to Runtime API
`validateDecodedTextureSizes` before rendering. The closed v1 pixel format is `rgba8`; filter
values are `nearest` or `linear`; wrap values are `clamp`, `repeat`, or `mirror`.

## Regions

```json
{
  "regionId": "region-body",
  "imageId": "image-body",
  "pageId": "page-0",
  "x": 16,
  "y": 32,
  "width": 120,
  "height": 200,
  "sourceWidth": 128,
  "sourceHeight": 224,
  "sourceX": 4,
  "sourceY": 12,
  "rotation": "none",
  "edgeExtension": 2,
  "uvs": [
    [0.0078125, 0.015625],
    [0.06640625, 0.015625],
    [0.06640625, 0.11328125],
    [0.0078125, 0.11328125]
  ]
}
```

Coordinates use a top-left page origin. `x/y/width/height` describe the packed content rectangle,
excluding edge-extension texels. `sourceWidth/sourceHeight` are the logical untrimmed image extent.
`sourceX/sourceY` place the packed rectangle in that logical source image and are non-negative.
The source rectangle must fit the source extent.

`rotation` is `none` or `clockwise90`. `edgeExtension` is the count of replicated edge pixels
outside the packed content rectangle.

`uvs` contains four normalized page coordinates in the source-quad vertex order:

```text
0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
```

For a rotated region the array is already remapped to those logical corners. Hosts do not guess a
rotation formula. Each value is finite in `[0,1]` and must agree with the integer rectangle,
rotation, page size, and half-open texel-edge convention within `1e-7`.

## Mapping and validation

Every region maps one `imageId` directly. File stems and names are not lookup keys. Each `imageId`
appears at most once in one atlas manifest. Each region references an existing page and a runtime
image. Region rectangles plus edge extension fit inside the page and may not overlap another
region's allocated rectangle.

Errors distinguish at least duplicate IDs, missing image/page, unsafe page path, decoded page-size
mismatch, out-of-bounds region, overlapping allocation, invalid source trim, invalid UV, and
unsupported color/alpha/pixel/filter/wrap mode.

Every v1 atlas uses its `name` as the native page-name base: page zero is `Name.png`, followed by
`Name-2.png`, `Name-3.png`, and so on. This is a format rule, not a filename-guessing lookup:
regions still resolve pages by `pageId` and runtime images by `imageId`.

Logical source-quad placement, rotated corner mapping, Mesh source-UV
projection, source-trim clipping, and renderer color handling are normative in
[Geometry and Render Algorithms v1](../runtime/GEOMETRY_RENDER_ALGORITHMS_V1.md).
