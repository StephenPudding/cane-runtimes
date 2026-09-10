# Cane Runtime v1 Geometry and Render Algorithms

Status: normative for Runtime API 1.0.

This document defines the language-neutral algorithms for attachment geometry,
weighted skinning, deform, linked meshes, clipping, Atlas projection, winding,
draw order, final tint, and renderer color handling. Together with the
[Runtime Model](../formats/RUNTIME_MODEL_V1.md), [Atlas JSON
Format](../formats/ATLAS_JSON_V1.md), [Runtime API](RUNTIME_API_V1.md), and
[Core Animation Algorithms](CORE_ANIMATION_ALGORITHMS_V1.md), it is sufficient
to implement Runtime API v1 geometry and rendering without consulting an
implementation's source code.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
Algorithms below operate only on a validated immutable Runtime document,
attached validated Atlas documents, and the sampled pose produced by the core
animation and constraint stages.

## 1. Coordinate, number, and buffer contract

Runtime geometry uses:

- an X-right, Y-up Cartesian world;
- `px` for positions and lengths;
- degrees for attachment rotation;
- top-left-origin UVs, with U increasing right and V increasing down;
- IEEE 754 binary32 as the reference scalar precision;
- the complete affine matrix `[a,b,c,d,tx,ty]`:

```text
xWorld = a*xLocal + c*yLocal + tx
yWorld = b*xLocal + d*yLocal + ty
```

Affine multiplication, bone local matrices, hierarchy inheritance, and root
transforms are defined by
[Core Animation Algorithms v1](CORE_ANIMATION_ALGORITHMS_V1.md). Geometry MUST
never reconstruct a matrix from diagnostic rotation and scale.

Flat position and UV arrays contain consecutive pairs. Triangle arrays contain
consecutive triples. Runtime Format v1 rejects any source mesh, path,
bounding-box, or clipping attachment above 65,536 xy vertices before instance
creation or runtime geometry cloning. Mesh indices are unsigned 16-bit values,
so the same bound is also the complete addressable range. Every evaluated or
clipped draw attachment has the same v1 limit of 65,536 vertices. RenderPacket
indices are represented as unsigned 32-bit values for a language-neutral wire
type and packet assembly, but that wider type does not raise the
per-attachment limit. All allocation and index arithmetic MUST be checked.
Exceeding the source limit, output limit, or checked arithmetic fails with
`resourceLimit`; a mutating public operation fails atomically. An
implementation MUST NOT wrap, truncate, silently omit the attachment, or emit
a partial attachment.

### 1.1 Public constants

These constants are part of Runtime API 1.0:

| Name | Value | Use |
| --- | ---: | --- |
| `WEIGHT_SUM_TOLERANCE` | `0.001` | load-time comparison of a vertex's declared influence sum to `1` |
| `MAX_INFLUENCES_PER_VERTEX` | `16` | load-time weight-row limit |
| `BINARY32_EPSILON` | `1.1920928955078125e-7` | near-zero tests explicitly named below for direction, positive influence totals, and clipping intersection denominators |
| `CLIP_EPSILON` | `0.00001` | clipping area, half-plane, convexity, and duplicate-position tests |
| `ATLAS_UV_TOLERANCE` | `0.0000001` | Atlas JSON declared-UV validation |
| `ATLAS_SOURCE_TRIM_EPSILON` | `0.000001` | source-UV half-plane and duplicate tests while clipping geometry to a trimmed Atlas region |
| `PMA_UNPREMULTIPLY_EPSILON` | `0.000001` | renderer unpremultiplication branch |
| `MAX_RENDER_ATTACHMENT_VERTICES_V1` | `65536` | maximum vertices in one evaluated, runtime-clipped, or Atlas-trimmed draw attachment |

`BINARY32_EPSILON` is the exact binary32 `EPSILON` value. Matrix invertibility
does not use this tolerance: a finite determinant is singular exactly when it
equals zero. A comparison listed as exact, such as triangle winding `< 0`,
does not use one of these tolerances.

The conformance suite compares published geometry using the tolerances in the
core algorithm specification. Those comparison tolerances do not alter any
branch in this document.

## 2. Geometry validation before instance creation

A loader MUST reject malformed geometry before creating an instance:

- every coordinate, UV, weight, bind matrix, tint alpha, and attachment
  transform is finite;
- every source mesh, path, bounding-box, or clipping attachment has at most
  `MAX_RENDER_ATTACHMENT_VERTICES_V1` xy vertices; an over-limit native
  document fails loading with `resourceLimit` before instance construction;
- a position or UV array has an even length;
- a triangle array has a length divisible by three and every index is in
  range;
- an unweighted attachment has an empty outer `weights` array;
- a weighted attachment has exactly one non-empty weight row per setup point;
- each row has at most 16 influences, each weight is non-negative, and the
  finite row sum differs from `1` by at most `0.001`;
- influence `x` and `y` are either both present or both absent;
- an influence with absent coordinates has a finite bind-inverse entry for
  its `boneId`;
- path, bounding-box, and clipping attachments obey the same weight rules as
  meshes;
- a linked mesh resolves to a mesh, has no parent cycle, and resolves an
  ultimate non-linked geometry source; its `rows` and `cols` are zero, its
  geometry arrays are empty, and its optional geometry fields are null; the
  displayed mesh's own slot remains its render owner even when the geometry
  parent belongs to another slot;
- a clipping polygon has at least three points and non-zero finite signed
  area in setup space;
- a Runtime image attached to an Atlas has exactly one region in that Atlas;
  when Runtime image `width` or `height` is present, it equals the region's
  `sourceWidth` or `sourceHeight`, respectively.

For a non-linked mesh, `rows` and `cols` are positive grid metadata and do not
participate in runtime evaluation. Runtime Format v1 accepts either a
vertex-grid declaration (`vertexCount == rows*cols`) or a cell-grid
declaration (`vertexCount == (rows+1)*(cols+1)`). Writers SHOULD use
vertex-grid dimensions. Geometry, UVs, and indices remain authoritative.

An implementation may build private dense indexes after validation. Stable
IDs remain the public identity and lookup boundary.

## 3. Common vertex-attachment evaluation

Mesh, path, bounding-box, and clipping attachments use one common point
algorithm. Let setup point `i` be:

```text
S_i = (vertices[2*i], vertices[2*i+1])
```

Let `Slot` be the final world matrix of the owning slot's bone after all
constraints.

### 3.1 Unweighted points

An attachment is unweighted when its outer `weights` array is empty. Its
canonical sampled deform is a point-position array:

```text
P_i = S_i                              // no deform contribution
P_i = sampledVertexPositions_i         // deform contribution exists
W_i = Slot * P_i
```

Before the first deform key, the deform timeline contributes nothing and
`P_i=S_i`. Key grouping, duplicate times, curves, and layer alpha follow the
core animation specification.

### 3.2 Weight coordinate forms and bind inverses

For weighted point `i`, influence `j` contains `boneId`, weight `w_ij`, and
one of two coordinate forms:

1. explicit bone-local coordinates `(x_ij,y_ij)`; or
2. no coordinates, in which case `bindInverses[boneId]` is required.

A bind inverse is the full affine matrix:

```text
B_j = [ a c tx ]
      [ b d ty ]
      [ 0 0  1 ]
```

It maps an attachment setup-space point into the influencing bone's setup
local space. Its translation applies to points. Its 2×2 linear part alone
applies to deform deltas.

### 3.3 The two deform spaces

`deformSpace:"vertexPositions"` contains one absolute attachment-space
position per setup point. For a weighted attachment, convert it to canonical
per-influence bone-local offsets:

```text
D_i = sampledVertexPosition_i - S_i

explicit coordinate influence:
    O_ij = D_i

bind-inverse influence:
    O_ij.x = B_j.a*D_i.x + B_j.c*D_i.y
    O_ij.y = B_j.b*D_i.x + B_j.d*D_i.y
```

`deformSpace:"weightedInfluenceOffsets"` already contains `O_ij` pairs in
point-major, influence-declaration order. Its exact component count is:

```text
2 * sum(weights[i].length for every point i)
```

Zero-weight influences still consume their declared offset pair so indexing
does not depend on animated or numeric values.

For weighted attachments the canonical setup deform is an all-zero offset
array. For unweighted attachments it is the setup position array.

Continuous deform keys interpolate every component using the outgoing key's
curve. Duplicate times and the pre-first-key rule are identical to other
continuous channels. All keys in one deform timeline have the exact required
component count; a loader rejects a mismatch rather than holding a shorter
array.

Layer composition is component-wise:

```text
unweighted replace:
    current + (sampled - current) * alpha

unweighted additive:
    current + (sampled - setupPosition) * alpha

weighted-offset replace:
    current + (sampled - current) * alpha

weighted-offset additive:
    current + sampled * alpha
```

The last formula uses zero as weighted-offset setup.

### 3.4 Weighted world point

For every positive-weight influence:

```text
explicit coordinates:
    Q_ij = (x_ij,y_ij) + O_ij

bind-inverse coordinates:
    Q_ij = B_j * S_i + O_ij

R_ij = BoneWorld_j * Q_ij
```

Then:

```text
positiveTotal = sum(w_ij where w_ij > 0)
W_i = sum(R_ij * w_ij where w_ij > 0) / positiveTotal
```

Normalizing by `positiveTotal` is required even though validation constrains
the declared sum to `1±0.001`. An influence whose weight is exactly zero is
ignored after its offset position has been consumed. `positiveTotal <=
BINARY32_EPSILON` is invalid.

Weighted geometry is already a world-space result. An implementation may keep
it in world space directly. If an internal representation projects it back
through an owning-slot inverse, that is only an implementation detail and
MUST NOT substitute setup geometry or suppress the draw when the authoritative
result above is finite. A round trip through that internal representation must
remain within the published conformance tolerance.

## 4. Linked mesh resolution and deform ownership

A linked mesh separates render identity from geometry identity.

Starting at displayed mesh `M`:

1. Follow every `link.parentMeshId` until the first non-linked mesh. That
   ultimate mesh supplies setup vertices, UVs, indices, weights, bind
   inverses, edges, and hull.
2. The displayed mesh supplies `attachmentId`, name, owning slot, `imageId`,
   tint, alpha, and sequence.
3. Determine deform ownership independently. Start at `M`; while the current
   link exists and `inheritDeform` is `true`, move to its parent. Stop at the
   first `inheritDeform:false` link or at the non-linked root. The stopping
   mesh's ID is the deform timeline target used for the displayed mesh.

Therefore:

- `inheritDeform:true` makes a child use the resolved ancestor deform;
- `inheritDeform:false` makes the child use deform keyed on that child, but
  the value count and weight layout still come from the ultimate geometry
  source;
- a linked mesh that inherits deform MUST NOT declare its own deform keys;
- link cycles are load errors; cross-slot links retain the displayed mesh's
  owning slot and are valid.

## 5. Region geometry

A region attachment first creates this local affine:

```text
r = degToRad(rotation)

Local.a  =  cos(r) * scaleX
Local.b  =  sin(r) * scaleX
Local.c  = -sin(r) * scaleY
Local.d  =  cos(r) * scaleY
Local.tx = x
Local.ty = y

SourceAffine = Slot * Local
```

Region scale components are finite and non-zero. `SourceAffine` retains
shear, non-uniform scale, negative scale, and reflection inherited from the
bone hierarchy.

### 5.1 Direct image quad

A direct image requires positive decoded or declared width `W` and height
`H` before a RenderPacket can be built:

```text
local vertices, in logical source-corner order:
0 = (-W/2,  H/2)    // top-left
1 = ( W/2,  H/2)    // top-right
2 = ( W/2, -H/2)    // bottom-right
3 = (-W/2, -H/2)    // bottom-left

source UV:
0=(0,0), 1=(1,0), 2=(1,1), 3=(0,1)

source indices:
0,1,2, 0,2,3
```

Transform each local vertex by `SourceAffine`, then normalize triangle
winding as specified in section 10.

### 5.2 Atlas-trimmed region quad

For Atlas region `R`, packed width/height are page-axis values. Its logical
trimmed source extent is:

```text
if rotation == none:
    logicalWidth  = R.width
    logicalHeight = R.height
else if rotation == clockwise90:
    logicalWidth  = R.height
    logicalHeight = R.width

left   = R.sourceX - R.sourceWidth/2
right  = left + logicalWidth
top    = R.sourceHeight/2 - R.sourceY
bottom = top - logicalHeight
```

The local vertices are `(left,top)`, `(right,top)`, `(right,bottom)`,
`(left,bottom)`. UVs are the four declared Atlas region UV pairs in that
same logical corner order. A host does not recalculate page rotation.

Atlas `sourceWidth/sourceHeight` are also the authoritative full source-image
dimensions for source-space clipping when the Runtime image omits optional
dimensions.

## 6. Path, point, bounding-box, and clipping geometry

### 6.1 Path control points

A path stores three point pairs per knot:

```text
knot k:
    points[3*k+0] = incoming control
    points[3*k+1] = anchor
    points[3*k+2] = outgoing control
```

Every stored pair is evaluated by the common vertex algorithm in section 3;
weights correspond to stored control points, not only anchors.

The cubic segment from knot `k` to knot `n` uses:

```text
P0 = points[3*k+1]
P1 = points[3*k+2]
P2 = points[3*n+0]
P3 = points[3*n+1]
```

For an open path, `n=k+1` and there are `knotCount-1` segments. For a closed
path the final segment wraps to knot zero. Constraint traversal and
constant-speed arc-length sampling are defined by the constraint algorithm
specification; this section fixes the world control points it consumes.

### 6.2 Point attachment

For local point `(x,y)`:

```text
worldPosition = Slot * (x,y)
r = degToRad(rotation)
worldDirection.x = Slot.a*cos(r) + Slot.c*sin(r)
worldDirection.y = Slot.b*cos(r) + Slot.d*sin(r)
worldRotation = atan2(worldDirection.y,worldDirection.x) * 180/pi
```

If the direction is non-finite or
`abs(worldDirection.x)+abs(worldDirection.y) <= BINARY32_EPSILON`, the
point has no defined world rotation and the point-pose query fails without
mutation.

### 6.3 Bounding box

Bounding-box points use section 3 in declaration order. Point containment
uses an even-odd ray crossing. A point on an edge is inside when:

```text
abs(cross(edge, point-start)) <= 0.0001
dot(point-start, edge) in [-0.0001, dot(edge,edge)+0.0001]
```

### 6.4 Clipping polygon world points

Clipping points also use section 3 in declaration order. Deform is evaluated
before polygon convexity, triangulation, and clipping, so a deform may change
the number of convex pieces without changing the point count.

## 7. Clipping

Clipping is evaluated in final world space. Texture coordinates are carried
on every source vertex and linearly interpolated at every new intersection.

### 7.1 Lifetime in draw order

Traverse the final sampled slot draw order:

1. An active clipping attachment emits no draw attachment and becomes the
   current clip.
2. It affects every subsequently encountered Region or Mesh.
3. `endSlotId`, when present, is inclusive: that slot is clipped, then the
   clip is cleared.
4. If the end slot was already traversed before clip activation, or is not
   encountered later, clipping remains active through the end.
5. A later active clipping attachment replaces the earlier clip; clips do not
   nest.
6. An inactive clipping attachment has no effect.

### 7.2 Polygon normalization

For sampled world polygon `P`, compute signed area:

```text
area = 0.5 * sum(
    P[i].x*P[(i+1)%N].y - P[(i+1)%N].x*P[i].y
)
```

Fewer than three points, a non-finite area, or `abs(area) <= CLIP_EPSILON`
produces no valid current clip. A negative-area valid polygon is reversed so
all subsequent half-plane algorithms receive counter-clockwise input.

Convexity is true exactly when every consecutive triple has:

```text
signedEdgeDistance >= -CLIP_EPSILON
```

where:

```text
signedEdgeDistance(A,B,P) =
    (B.x-A.x)*(P.y-A.y) - (B.y-A.y)*(P.x-A.x)
```

Mode selection is:

- if `convex:true`, use the polygon when already convex; otherwise use its
  deterministic convex hull;
- if `convex:false` and the polygon is convex, use it directly;
- if `convex:false` and the polygon is concave, deterministically ear-clip it
  into convex triangles;
- `inverse` changes intersection to subtraction; it does not implicitly turn
  a concave polygon into its convex hull.

The convex hull uses the monotone-chain algorithm. Sort points by numeric
`(x,y)`, remove exactly equal duplicates, and pop while the newest turn is
`<= CLIP_EPSILON`. Concatenate lower and upper chains after removing their
duplicate endpoints.

Ear clipping starts with indices in current CCW order. On each pass, scan
remaining positions from index zero and choose the first vertex whose turn is
`> CLIP_EPSILON` and whose closed triangle contains no other remaining
vertex. Triangle containment uses all three signed edge distances
`>= -CLIP_EPSILON`. Emit `(previous,current,next)` and remove `current`.
Failure to find an ear, or more than `N*N` removals, makes the sampled clip
invalid.

### 7.3 Source textured triangles

A Region presented to clipping uses the full untrimmed source quad from
section 5.1, even when its texture comes from an Atlas. This preserves the
source-image coordinate system while clipping. Atlas trim is applied later as
specified in section 8.3.

A Mesh presented to clipping first evaluates deform and weights. Each mesh
point is transformed to world space and paired with its source-image UV.

### 7.4 Convex intersection

Intersect a source triangle against every edge of one CCW convex clip polygon
using Sutherland-Hodgman clipping. For edge `(A,B)`:

```text
distance(P) = signedEdgeDistance(A,B,P)
inside      = distance >= -CLIP_EPSILON
```

When consecutive vertices differ in inside status:

```text
denominator = previousDistance - currentDistance

if abs(denominator) > BINARY32_EPSILON:
    t = clamp(previousDistance / denominator, 0, 1)
    intersection.position = lerp(previous.position,current.position,t)
    intersection.uv       = lerp(previous.uv,current.uv,t)
```

After every edge, remove adjacent points whose X and Y differences are each
`<= CLIP_EPSILON`; also remove the final point when it duplicates the first.
Drop polygons with fewer than three points or absolute area
`<= CLIP_EPSILON`. Emit every remaining polygon as a fan
`(0,1,2),(0,2,3),...`.

For a concave non-inverse clip, intersect the source triangle independently
with each ear triangle. Ear interiors do not overlap, so their emitted
fragments form the clipped union.

### 7.5 Inverse subtraction

For one convex clip polygon, subtract it from a source polygon by visiting
clip edges in order:

1. clip the current remaining polygon to the outside half-plane
   `distance <= CLIP_EPSILON` and retain that valid fragment;
2. replace the remaining polygon with its inside-half-plane intersection;
3. stop when the remaining polygon is empty.

For an inverse concave polygon, begin with the source triangle as one
fragment. For each ear triangle in declaration/ear order, subtract that
triangle from every current fragment. The fragments left after the final ear
are the exact source area outside the original concave polygon. This order is
deterministic and MUST NOT substitute the polygon's convex hull.

Clipped geometry is already world space. Its RenderPacket `sourceAffine` is
diagnostic only and MUST NOT be applied to `worldVerticesXY`. A clipped draw
attachment has final `geometryKind:"meshTriangles"` regardless of its authored
attachment kind or final vertex count.

## 8. Atlas lookup and UVs

### 8.1 Identity lookup

Resolve a Runtime image by `imageId`.

- A direct image has `path` and no `atlasId`.
- An Atlas image has `atlasId` and no direct path.
- Resolve the Atlas by `atlasId`, then the unique region by `imageId`, then
  the page by `pageId`.

File names, stems, attachment names, and declaration positions are never
lookup keys. The RenderPacket repeats `imageId`, `atlasId`, `regionId`,
`pageId`, and page path so a host performs no guessing. Multiple pages do not
change any UV formula.

Direct textures report `colorSpace:"srgb"` and `alphaMode:"straight"`.
Atlas textures report the Atlas root values.

### 8.2 Atlas region corner UVs

Atlas page coordinates use half-open texel edges:

```text
left   = x / pageWidth
right  = (x + width) / pageWidth
top    = y / pageHeight
bottom = (y + height) / pageHeight
```

Expected logical-corner UV order is:

```text
rotation none:
    TL=(left,top)
    TR=(right,top)
    BR=(right,bottom)
    BL=(left,bottom)

rotation clockwise90:
    TL=(right,top)
    TR=(right,bottom)
    BR=(left,bottom)
    BL=(left,top)
```

Atlas JSON stores these four values and validation compares them to the
formula with `ATLAS_UV_TOLERANCE`. Runtime packet generation copies them; it
does not infer rotation from dimensions.

### 8.3 Mesh source UV to Atlas page UV

Mesh UV `(uSource,vSource)` addresses the full logical untrimmed source image.
First compute normalized coordinates inside the trimmed rectangle:

```text
x = (uSource*sourceWidth  - sourceX) / logicalWidth
y = (vSource*sourceHeight - sourceY) / logicalHeight

top    = lerp(TL,TR,x)
bottom = lerp(BL,BR,x)
pageUv = lerp(top,bottom,y)
```

The interpolation uses binary64 intermediates, followed by conversion to the
published runtime scalar.

Before this mapping, geometry is clipped in source-UV space to:

```text
u in [sourceX/sourceWidth,
      (sourceX+logicalWidth)/sourceWidth]

v in [sourceY/sourceHeight,
      (sourceY+logicalHeight)/sourceHeight]
```

Use Sutherland-Hodgman clipping against min-U, max-U, min-V, and max-V in that
order. Inside is `planeDistance >= -ATLAS_SOURCE_TRIM_EPSILON`.
Intersections linearly interpolate both geometry position and source UV.
Adjacent vertices are duplicates only when X, Y, U, and V differences are
each `<= ATLAS_SOURCE_TRIM_EPSILON`. If every source UV is already inside,
preserve the source topology exactly. If no triangle remains, omit that draw
attachment and renumber later packet `drawIndex` values contiguously.

This step is required for both Mesh geometry and a Region converted to Mesh by
clipping. It prevents transparent pixels removed by Atlas trimming from
sampling an adjacent packed region.

`edgeExtension` is allocation/filtering metadata. It does not change content
rectangle UVs.

## 9. Draw order and sequence image selection

Setup draw order sorts slots by ascending signed `zIndex`; equal values retain
slot declaration order. A sampled full draw-order key replaces setup order.
Validated v1 keys contain every slot exactly once. Folder draw-order keys
modify only their declared member slots as specified by the core animation
layer rules.

Traverse the resolved slot order once. Non-renderable attachments and
clipping attachments do not create packet entries. Renderable entries receive
contiguous `drawIndex` values `0..N-1` in emitted order. `drawIndex`, not
`sourceZIndex`, is authoritative for rendering.

Without a sampled full draw-order key, `sourceZIndex` is the slot setup
`zIndex`. With one, it is the sampled slot ordinal. It is diagnostic and does
not authorize a host to resort the packet.

For Region or Mesh sequence selection, use the sampled sequence index when
present, otherwise `setupIndex`. The selected `imageId` replaces the
attachment's fallback image before direct/Atlas lookup. Validated timeline
indices are in range; no modulo or filename-based fallback is performed.

## 10. Reflection and front-face normalization

World vertices are computed before winding normalization. For every triangle
`(i0,i1,i2)`:

```text
A = vertex[i0]
B = vertex[i1]
C = vertex[i2]

signedDoubleArea =
    (B.x-A.x)*(C.y-A.y) -
    (B.y-A.y)*(C.x-A.x)

if signedDoubleArea < 0:
    authoredTriangleFacing[triangleOrdinal] = towardViewer
else if signedDoubleArea > 0:
    authoredTriangleFacing[triangleOrdinal] = awayFromViewer
else:
    authoredTriangleFacing[triangleOrdinal] = edgeOn

if signedDoubleArea < 0:
    swap(i1,i2)
```

The facing comparisons and winding comparison are exact binary32 comparisons;
no epsilon is used. `authoredTriangleFacing` is captured from authoritative
final world geometry and the current final triangle order after clipping,
deformation, skinning, and Atlas trim, but before index normalization. It has
exactly one value per final triangle and is not reordered or changed when
`i1,i2` are swapped. A zero-area triangle retains its order and reports
`edgeOn`. UVs remain attached to vertices, so swapping indices preserves
texture mapping.

The direct Region source quad is clockwise in X-right/Y-up coordinates.
Therefore, for an unclipped Region, a positive source-affine determinant
produces `towardViewer` and a negative determinant produces
`awayFromViewer`. Mesh, clipped, and deformed output is classified per final
triangle instead of using that determinant shortcut, so a local fold or mixed
facing remains observable.

Every Runtime API v1 packet declares `frontFace:"counterClockwise"`.
Normalization applies per triangle, not merely once from the affine
determinant. It therefore also corrects authored mixed winding and weighted
deformation. When final world geometry can be represented by its original
finite invertible source affine, `sourceAffine` retains that matrix and its
determinant sign; it is never decomposed to hide reflection. Geometry that
cannot be projected back through its source affine with finite results
(including a singular affine) publishes world vertices with an identity
diagnostic affine instead of suppressing the draw.

`frontFace` is the GPU winding declaration; `authoredTriangleFacing` is
independent source-facing metadata. A renderer MAY disable authored backface
culling. If it enables authored backface culling, it retains only
`towardViewer` triangles, then submits their normalized indices with the
declared CCW GPU front face. An adapter MUST NOT infer authored facing from
normalized indices, `sourceAffine`, or an engine's screen-space Y direction.
A host MUST NOT flip geometry again because an engine uses a different
screen-space Y direction; the coordinate adapter performs that single engine
conversion consistently for vertices and front-face state.

## 11. Final tint and renderer color math

### 11.1 Runtime composition

Runtime color strings decode to RGB bytes. Let sampled slot light bytes be
`S`, attachment setup light bytes be `A`, sampled slot alpha be `sa`, and
attachment alpha be `aa`.

For each light channel:

```text
finalLightByte = floor((S*A + 127) / 255)
```

All terms in this equation are unsigned integers. Final alpha is:

```text
finalAlpha = clamp(sa,0,1) * clamp(aa,0,1)
```

Validated Runtime v1 inputs are already finite and in range. The multiplication
is evaluated as binary32.

Final dark RGB is the sampled slot dark color unchanged by attachment light
color. `darkRgb:null` means one-color tint. A present `[0,0,0]` means
two-color tint with black dark color and MUST remain distinct from null.

The packet invariant is:

```text
twoColor == (darkRgb is present)
```

The packet tint is straight, unpremultiplied sRGB:

```text
tintColorSpace = srgb
tintAlphaMode  = straight
```

No host recomputes slot, attachment, skin, or animated tint.

### 11.2 sRGB transfer

Convert a normalized sRGB channel `s` to linear before lighting/tint math:

```text
if s <= 0.04045:
    linear = s / 12.92
else:
    linear = ((s + 0.055) / 1.055) ^ 2.4
```

Convert linear `l` to sRGB for an sRGB output target:

```text
if l <= 0.0031308:
    s = 12.92*l
else:
    s = 1.055*l^(1/2.4) - 0.055
```

Texture `colorSpace:"srgb"` is decoded with the first transfer. Texture
`colorSpace:"linear"` is already linear. Tint bytes are always converted from
sRGB with the first transfer.

### 11.3 Straight and premultiplied texture samples

Let decoded texture sample be `(rgb,a)` in linear color space.

- For `alphaMode:"straight"`, `T.rgb=rgb`.
- For `alphaMode:"premultiplied"`:

```text
if a > PMA_UNPREMULTIPLY_EPSILON:
    T.rgb = rgb / a
else:
    T.rgb = (0,0,0)
```

`T.a=a`. Atlas packers that emit premultiplied pages MUST encode RGB so that
color-space decoding produces linear RGB premultiplied by alpha. This rule
removes ambiguity about whether premultiplication occurs in encoded or linear
space.

### 11.4 One-color and two-color tint

Let `L` be final light RGB converted to linear and `D` be final dark RGB
converted to linear.

```text
one-color:
    straightRgb = T.rgb * L

two-color:
    straightRgb = D + (L-D) * T.rgb

outputAlpha = T.a * finalAlpha
premultipliedRgb = straightRgb * outputAlpha
```

The renderer writes `(premultipliedRgb,outputAlpha)` to the blend pipeline.
It unpremultiplies a premultiplied texture at most once and premultiplies the
final output exactly once.

### 11.5 Blend equations

Let `Cs,As` be the premultiplied source output above and `Cd,Ad` the current
premultiplied destination. Runtime blend modes use these component-wise
equations before target-format clamping:

```text
normal:
    C = Cs + Cd*(1-As)
    A = As + Ad*(1-As)

add:
    C = Cs + Cd
    A = As + Ad

multiply:
    C = Cs*Cd + Cd*(1-As)
    A = As + Ad*(1-As)

screen:
    C = Cs + Cd*(1-Cs)
    A = As + Ad*(1-As)
```

An engine adapter maps these equations to native blend factors without
changing Runtime packet colors.

## 12. RenderPacket construction and invariants

One immutable Runtime API v1 RenderPacket contains:

```text
coordinateSystem = xRightYUp
uvOrigin = topLeft
tintColorSpace = srgb
tintAlphaMode = straight
attachments = final emitted draw list
```

Every attachment has:

- `drawIndex` equal to its zero-based array position;
- `slotId`, displayed `attachmentId`, and selected `imageId`;
- final `geometryKind:"regionQuad" | "meshTriangles"`;
- a closed Direct or Atlas texture identity;
- normalized blend mode;
- final tint and matching `twoColor`;
- diagnostic complete `sourceAffine`;
- final finite `worldVerticesXY`;
- final page UVs with one pair per vertex;
- unsigned 32-bit complete triangle indices in range;
- `authoredTriangleFacing` with exactly one source-facing value per triangle;
- `frontFace:"counterClockwise"`.

`worldVerticesXY`, UVs, indices, final tint, texture identity, and array order
are authoritative renderer inputs. `authoredTriangleFacing` is authoritative
per-triangle metadata and MUST NOT be recomputed from the normalized geometry.
`sourceAffine` is diagnostic; geometry is already world space and a host MUST
NOT apply it again. Diagnostic bone rotation/scale and the historical
attachment projection are likewise not render inputs.

`geometryKind` describes the final packet representation, never the authored
source declaration. `regionQuad` is assigned only by direct Region packet
construction and denotes its four-corner quad. `meshTriangles` is assigned by
the general mesh packet path, including authored Mesh attachments and Regions
converted to triangle geometry by clipping. A host MUST NOT derive the value
from source metadata, vertex count, or index shape.

Packet construction order is:

1. resolve final skin, attachment, sequence image, and slot order;
2. evaluate setup/deform/linked geometry;
3. apply weights and final world matrices;
4. apply clipping and interpolate source UVs;
5. crop to Atlas source trim and map page UVs;
6. classify authored/source facing from each final world triangle;
7. normalize every triangle to CCW without changing its facing entry;
8. assign the final geometry kind from the packet construction path;
9. compose final tint;
10. publish a deep-owned immutable packet.

Repeating `apply()` without state change produces equal packet values.

## 13. Degenerate and failure rules

Load-time malformed data is rejected; a conforming implementation does not
silently reinterpret weighted geometry as unweighted geometry.

Dynamic evaluation may still become degenerate through a legal root transform,
constraint, or deform:

- a finite singular affine remains authoritative; unweighted world vertices
  are still evaluated and may collapse;
- a zero-area render triangle remains in the packet and keeps its index order;
- a sampled clipping polygon with non-finite data or area
  `<= CLIP_EPSILON` is invalid for that evaluation and establishes no active
  clip;
- a polygon fragment with fewer than three points or area
  `<= CLIP_EPSILON` is omitted;
- a legal clip or Atlas trim that leaves no triangles omits only that draw
  attachment and succeeds; this empty result is distinct from a resource-limit
  failure;
- a texture-trim intersection that emits no triangle omits that draw
  attachment;
- a required inverse with a non-finite or exactly-zero determinant fails the
  requesting query or operation; finite non-zero determinants remain
  invertible regardless of magnitude, although a non-finite produced
  coefficient still fails with `nonFinite`; an implementation MUST NOT invent
  an identity inverse;
- any produced NaN or infinity fails with `nonFinite`;
- missing image, Atlas, region, page, or decoded direct-image dimensions uses
  `missingResource`;
- malformed buffer counts or out-of-range indices use `validationFailed`;
- an evaluated, runtime-clipped, or Atlas-trimmed attachment exceeding
  `MAX_RENDER_ATTACHMENT_VERTICES_V1`, and any checked allocation/index
  overflow, uses `resourceLimit`.

Public operation failures are atomic as defined by Runtime API v1. A renderer
adapter validates the complete packet and all texture bindings before mutating
engine assets or ECS state.

## 14. Required conformance coverage

The language-neutral conformance matrix MUST contain independent cases for:

1. direct Region full-source quad;
2. unrotated trimmed Atlas Region position and UVs;
3. clockwise-90 trimmed Atlas Region;
4. multi-page Atlas identity lookup;
5. direct unweighted Mesh;
6. explicit-coordinate weighted Mesh;
7. bind-inverse weighted Mesh;
8. both deform spaces and additive/replace composition;
9. linked mesh with `inheritDeform:true` and `false`;
10. weighted path, bounding-box, and clipping world points;
11. convex clipping, concave clipping, convex-hull mode, inverse convex
    clipping, and inverse concave clipping;
12. inclusive `endSlotId` under sampled draw order;
13. clipping plus Atlas source trim with interpolated UVs;
14. shear, nested non-uniform scale, negative scale, and reflection;
15. per-triangle CCW normalization, including zero-area behavior;
16. final one-color tint, present-black two-color tint, alpha, sRGB/linear
    textures, and straight/premultiplied texture modes;
17. malformed geometry, missing Atlas identity, source-extent mismatch,
    invalid indices, the exact-below-limit success boundary, over-limit
    structured rejection, and resource-limit atomic failure.

Until these cases are present in the hash-pinned required manifest and pass,
an implementation MUST NOT claim complete Cane Runtime v1 geometry/render
conformance. Existing fixtures prove only the behaviors named by their
manifest cases.
