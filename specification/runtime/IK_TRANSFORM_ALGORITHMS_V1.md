# Cane Runtime v1 IK and Transform Constraint Algorithms

Status: normative for Runtime API 1.0.

This document defines the language-neutral evaluation contract for the
`constraint.ik` and `constraint.transform` Runtime Format v1 features. It is
written for independent runtime authors; consulting the Rust reference source
is neither required nor sufficient for conformance.

The data fields and validation ranges are defined by the
[Runtime Model](../formats/RUNTIME_MODEL_V1.md). Bone affine construction,
coordinate units, and hierarchy inheritance are defined by
[Core Animation Algorithms v1](CORE_ANIMATION_ALGORITHMS_V1.md). The words
**MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Numeric contract and branch constants

The reference scalar is IEEE 754 binary32. Persisted values and public
operation inputs are finite before solving begins. Intermediate expressions
are evaluated in the written order. A candidate may use binary64
intermediates, but its published binary32 values must satisfy the conformance
tolerances.

Constraint angles use these helpers. They intentionally differ at an exact
half-turn from the animation-layer `wrapDegrees` helper:

```text
constraintDegrees(x):
    r = euclideanRemainder(x, 360)       // [0,360)
    if r > 180: r = r - 360
    return r                             // (-180,180], half-turn is +180

constraintAngleDelta(from, to) =
    constraintDegrees(to - from)

positiveDegrees(x) =
    euclideanRemainder(x, 360)           // [0,360)
```

The following binary32 constants are part of Runtime API 1.0 behavior:

| Name | Exact decimal source value | Use |
| --- | ---: | --- |
| `MATRIX_EPSILON` | `1.1920928955078125e-7` (`2^-23`) | matrix inverse and Transform world-axis degeneracy |
| `IK_MIN_VECTOR_SQUARED` | `0.000001` | reject IK direction vectors whose squared length is at or below this value |
| `IK_MIN_VECTOR_LENGTH` | `sqrt(0.000001)` | reject analytic segment/target lengths at or below this value |
| `IK_ROTATION_DELTA_EPSILON` | `0.00001` degrees | CCD does not apply a rotation delta at or below this magnitude |
| `IK_UNIFORM_SCALE_EPSILON` | `0.000001` | two-bone parent scale uniformity |
| `IK_SOFTNESS_EPSILON` | `0.000001` | activate the two-bone softness attenuation formula |
| `IK_REACH_EPSILON` | `0.000001` | stretch/compress reach comparisons |
| `IK_MIN_POSITIVE_SCALE` | `0.000001` | accept an analytic stretch/compress multiplier only above this value |
| `IK_DIAGNOSTIC_EPSILON` | `0.0001` | minimum residual used only by the `saturated` diagnostic |
| `IK_SATURATED_MIX` | `0.999` | minimum mix used only by the `saturated` diagnostic |

`MATRIX_EPSILON` is the binary32 machine epsilon, not the smallest positive
binary32 value.

Mix activation never uses an epsilon:

```text
IK mix == 0          means do not solve
IK mix > 0           means solve, however small the finite value
Transform mix == 0   means no contribution for that property
Transform mix != 0   means evaluate that property, including negative values
```

IK mix is finite and in `[0,1]`. Every Transform property mix is any finite
binary32 value: negative values reverse the contribution and values above one
extrapolate. A Transform implementation MUST NOT clamp setup, timeline,
mapping, or host-override mixes to `[0,1]`. Positive mix duration and
animation duration tests, and the zero/nonzero constraint tests above, are
exact-zero tests.

Angle normalization uses `euclideanRemainder`, not a repeated add/subtract
loop. Thus even an extreme finite input completes in constant time. If finite
inputs overflow an intermediate and the final local pose or world matrix is
non-finite, the complete Runtime API operation fails atomically with
`nonFinite`.

For a matrix `M`:

```text
det = M.a*M.d - M.b*M.c
```

`inverse(M)` is unavailable when any component is non-finite or
`abs(det) <= MATRIX_EPSILON`. Otherwise:

```text
inverse.a  =  M.d / det
inverse.b  = -M.b / det
inverse.c  = -M.c / det
inverse.d  =  M.a / det
inverse.tx = (M.c*M.ty - M.d*M.tx) / det
inverse.ty = (M.b*M.tx - M.a*M.ty) / det
```

## 2. Scheduling, declaration order, and activation

An `apply()` first samples animation/host constraint values and builds
unconstrained bone world matrices. It then visits `constraints[]` in exact
document declaration order. Each active constraint sees all world changes
made by earlier constraints. Hash-map order MUST NOT affect this sequence.

A bone or constraint may be listed by zero or more skins:

- a member listed by no skin is always active;
- a member listed by at least one skin is active iff at least one currently
  sampled active skin lists it;
- an IK or Transform constraint runs only when the constraint itself is
  active and its bone target, when present, is active;
- driven/chain bones are not independently removed from an already-active
  constraint merely because another inactive skin lists them.

Inactive constraints produce no pose change and no constraint diagnostic.

An IK `chainBoneIds` array is a declaration-ordered, direct
parent-to-child path. Every ID is unique and resolves. For every adjacent
pair, the later bone's `parentId` is the earlier ID. Readers reject reversed,
disconnected, duplicate, or missing chains; they do not reorder them into
skeleton order.

A Transform `boneIds` array is visited in its declared order. The target
cannot be one of the driven bones or a descendant of one. A document may
drive both an ancestor and descendant; array order remains observable because
each successful write immediately refreshes descendants.

The IK target and Transform target source values are captured from the world
state that exists when that constraint starts. A constraint does not
re-sample its target after each driven bone.

## 3. Shared world values

For a bone world matrix `M`:

```text
xAngle(M) = atan2(M.b, M.a) * 180/pi
yAngle(M) = atan2(M.d, M.c) * 180/pi
xScale(M) = hypot(M.a, M.b)
yScale(M) = hypot(M.c, M.d)
reflection(M) = if det(M) >= 0 then +1 else -1
```

A zero determinant uses reflection sign `+1`. The full matrix remains
authoritative; these derived values exist only where a formula below
explicitly uses them.

The world origin of a bone is `(M.tx,M.ty)`. Its effector/tip is:

```text
tip.x = M.a*bone.length + M.tx
tip.y = M.b*bone.length + M.ty
```

## 4. IK constraint

### 4.1 Target and top-level selection

If `targetBoneId` is non-null, the target is the current world origin of that
bone and the stored `target` point is ignored. Otherwise `target` is already
an absolute Cane world-space `(x,y)` point; the mutable root transform is not
applied to it.

The setup or sampled `mix` and `threshold` are finite and in range after
validation. Defensive normalization is:

```text
mix       = clamp(mix, 0, 1)
threshold = max(threshold, 0)
```

Solver selection is:

```text
if mix == 0:
    do not solve
else if chain.length == 1 and oneBoneSolve succeeds:
    iterationsUsed = 1
else if chain.length == 2 and twoBoneSolve succeeds:
    iterationsUsed = 1
else:
    iterationsUsed = ccdSolve(iterations, threshold)
```

The analytic solvers are attempted before CCD. `bendPositive`,
`compress`, `stretch`, `uniform`, and `softness` affect the analytic paths.
CCD is rotation-only and does not separately apply those analytic options.

### 4.2 One-bone analytic solve

Let `B` be the driven bone and `P` be its parent world matrix. For a root
bone, `P` is the mutable root-transform matrix. The solve requires
`inverse(P)`.

```text
t = inverse(P) * targetWorld
o = (B.local.x, B.local.y)
v = t - o
d = hypot(v.x, v.y)
```

If `d <= IK_MIN_VECTOR_LENGTH`, this analytic path fails and top-level
selection proceeds to CCD.

The local X axis includes `shearX`, and a negative X scale reverses its
direction:

```text
desired = atan2(v.y, v.x) * 180/pi - B.local.shearX
if B.local.scaleX < 0:
    desired = constraintDegrees(desired + 180)

next.rotation = constraintDegrees(
    B.local.rotation
  + constraintAngleDelta(B.local.rotation, desired) * mix
)
```

The unmodified signed setup/current scale is retained unless compression or
stretching applies:

```text
scaledLength = abs(B.length * B.local.scaleX)

compresses = compress && d < scaledLength
stretches  = stretch  && d > scaledLength

if scaledLength > IK_MIN_VECTOR_LENGTH && (compresses || stretches):
    m = (d / scaledLength - 1) * mix + 1
    next.scaleX = B.local.scaleX * m
    next.scaleY = ikScaleY(B.local.scaleY, m, uniform)
```

`ikScaleY` is:

```text
uniform == false:
    return oldScaleY

uniform == true:
    return oldScaleY * m

uniform == "volume":
    divisor =
        if m < 0.7: 0.25 + 0.642857*m
        else:       m
    return oldScaleY / divisor
```

The `"volume"` compression branch deliberately uses the stated floor curve;
it is not replaced by `1/m` below `0.7`.

After the local pose is written, the complete skeleton world hierarchy is
rebuilt before the next constraint.

### 4.3 Two-bone analytic preprocessing

The first chain bone is `parent`; the second is its direct `child`. Work from
their current local poses:

```text
uniformParent =
    abs(abs(parent.scaleX) - abs(parent.scaleY))
        <= IK_UNIFORM_SCALE_EPSILON

parent.shearX = 0
parent.shearY = 0

if !uniformParent || stretch:
    child.y = 0
```

These applied-pose adjustments occur for every positive mix; they are not
multiplied by mix. Rebuild world matrices, then calculate:

```text
p0 = parent world origin
p1 = child world origin
p2 = child world tip
v1 = p1 - p0
v2 = p2 - p1
l1 = length(v1)
l2 = length(v2)
```

If either length is at or below `IK_MIN_VECTOR_LENGTH`, the two-bone analytic
path delegates to the one-bone solve for `parent` using this preprocessed
state.

Preserve the current geometric axis offsets:

```text
parentAxisOffset =
    constraintDegrees(angle(v1) - parentWorld.rotation)
childTipOffset =
    constraintDegrees(angle(v2) - childWorld.rotation)
bend = if bendPositive then +1 else -1
```

Here `world.rotation` is `xAngle(worldMatrix)`.

### 4.4 Softness and reach scaling

Let:

```text
q = targetWorld - p0
distance = length(q)
```

If `distance <= IK_MIN_VECTOR_LENGTH`, the analytic path fails. The
preprocessing mutations from section 4.3 remain the starting pose when
top-level selection then falls back to CCD. Softness attenuation is applied
only when `softness > IK_SOFTNESS_EPSILON`:

```text
softScale =
    max((abs(parentWorld.scaleX) + abs(childWorld.scaleX)) * 0.5,
        IK_SOFTNESS_EPSILON)
s = softness * softScale
softDelta = distance - l1 - l2 + s

if softDelta > 0:
    p = min(softDelta / (s * 2), 1) - 1
    p = (softDelta - s * (1 - p*p)) / distance
    q.x = q.x - p*q.x
    q.y = q.y - p*q.y
    distance = length(q)
```

Two-bone stretch is permitted only when the parent local scale is uniform
and `softness <= 0` by exact comparison. Thus a positive softness at or below
`IK_SOFTNESS_EPSILON` does not run attenuation but still disables stretch.

Let `childInheritsScale` be true for child transform modes `normal` and
`noRotationOrReflection`.

```text
maxReach = l1 + l2

if stretch
   && stretchPermitted
   && distance > maxReach + IK_REACH_EPSILON:
    requestedScale =
        if childInheritsScale:
            distance / maxReach
        else:
            (distance - l2) / l1
else:
    minReach = abs(l1 - l2)
    if compress && distance < minReach - IK_REACH_EPSILON:
        requestedScale =
            if childInheritsScale:
                distance / minReach
            else if l1 >= l2:
                (distance + l2) / l1
            else:
                (l2 - distance) / l1
    else:
        no scale request
```

A requested scale is accepted only when finite and strictly greater than
`IK_MIN_POSITIVE_SCALE`. For an accepted scale:

```text
m = (requestedScale - 1) * mix + 1
parent.scaleX = parent.scaleX * m
parent.scaleY = ikScaleY(parent.scaleY, m, uniform)
l1 = l1 * m
if childInheritsScale:
    l2 = l2 * m
```

Compression does not require `stretchPermitted`; only the stretch branch
does.

### 4.5 Two-bone angles

After softness/scaling:

```text
distance = max(distance, IK_MIN_VECTOR_LENGTH)
cosChild = clamp(
    (distance*distance - l1*l1 - l2*l2) / (2*l1*l2),
    -1,
    1
)
childAngle = acos(cosChild) * bend
parentAngle =
    atan2(q.y, q.x)
  - atan2(l2*sin(childAngle), l1 + l2*cos(childAngle))
```

The desired parent world rotation and local rotation are:

```text
desiredParentWorld =
    constraintDegrees(degrees(parentAngle) - parentAxisOffset)

inheritedRotation(bone) =
    if bone is root:
        rootTransform.rotation
    else if bone.transformMode inherits rotation:
        parentWorld.rotation
    else:
        0

desiredParentLocal =
    constraintDegrees(desiredParentWorld - inheritedRotation(parent))

parent.rotation = constraintDegrees(
    parent.rotation
  + constraintAngleDelta(parent.rotation, desiredParentLocal) * mix
)
```

Rebuild world matrices before solving the child. Then:

```text
desiredChildWorld = constraintDegrees(
    degrees(parentAngle + childAngle) - childTipOffset
)
desiredChildLocal = constraintDegrees(
    desiredChildWorld - inheritedRotation(child)
)
child.rotation = constraintDegrees(
    child.rotation
  + constraintAngleDelta(child.rotation, desiredChildLocal) * mix
)
```

Rebuild the world hierarchy again.

### 4.6 CCD fallback

CCD runs at most `iterations` outer iterations. Format v1 requires
`iterations > 0`.

At the start of each iteration, calculate the current final-chain tip. If its
distance to the target is `<= threshold`, return the number of already
completed iterations.

Visit chain bones from last to first:

```text
pivot = current bone world origin
effector = current final-chain tip
from = effector - pivot
to = target - pivot

if lengthSquared(from) <= IK_MIN_VECTOR_SQUARED
   || lengthSquared(to) <= IK_MIN_VECTOR_SQUARED:
    skip this bone

delta = atan2(cross(from,to), dot(from,to)) * 180/pi
if abs(delta) <= IK_ROTATION_DELTA_EPSILON:
    skip this bone

bone.local.rotation = bone.local.rotation + delta
rebuild all world matrices
```

After each changed bone, return immediately when residual `<= threshold`.
If no bone changed in an outer iteration, stop. Otherwise continue until the
iteration limit. CCD local rotations are not normalized during its full
solve.

For `mix < 1`, save every chain rotation before CCD, perform the full CCD
solve, then replace each solved rotation with:

```text
before + constraintAngleDelta(before, solved) * mix
```

and rebuild once. The comparison `mix < 1` is exact. Any positive mix,
including a sub-epsilon mix, executes this path.

### 4.7 IK diagnostic

The final residual is the distance from final-chain tip to target.

```text
saturated =
    mix >= IK_SATURATED_MIX
    && residual > max(threshold, IK_DIAGNOSTIC_EPSILON)
```

An analytic success reports `iterationsUsed = 1`; zero mix reports `0`; CCD
uses the count described above. Diagnostic thresholds do not change the
pose.

## 5. Transform constraint

### 5.1 Source capture and driven order

At constraint entry, capture:

```text
targetWorld = current target bone world state
targetLocal = current target bone applied/local pose
```

These values remain fixed while iterating `boneIds`. A missing required
source makes the constraint inapplicable.

For each driven ID in declaration order:

1. read its current local pose and world matrix;
2. evaluate either mapping, local, or world formulas below;
3. write the new world state;
4. when a reconstructed/applied local pose is available, replace its local
   pose;
5. recompute every descendant in parent-before-child skeleton order from its
   current local pose and transform mode.

The target ID itself is skipped defensively, though valid Format v1 rejects
that relation.

### 5.2 Transform without `mapping`: local target

`local:true` uses target and driven local poses. Each Transform property mix
is used exactly as stored or sampled. It is not clamped; the formulas below
are linear weights that intentionally permit reverse contribution and
extrapolation.

For `relative:false`:

```text
next.x = current.x + (target.x + xOffset - current.x) * mixX
next.y = current.y + (target.y + yOffset - current.y) * mixY

next.rotation = constraintDegrees(
    current.rotation
  + constraintAngleDelta(current.rotation,
                         target.rotation + rotationOffset) * mixRotate
)

next.shearY = constraintDegrees(
    current.shearY
  + constraintAngleDelta(current.shearY,
                         target.shearY + shearYOffset) * mixShearY
)

if mixScaleX != 0 && current.scaleX != 0:
    next.scaleX =
        current.scaleX
      + (target.scaleX - current.scaleX + scaleXOffset) * mixScaleX
else:
    next.scaleX = current.scaleX

// scaleY is identical with Y fields.
```

For `relative:true`:

```text
next.x = current.x + (target.x + xOffset) * mixX
next.y = current.y + (target.y + yOffset) * mixY

next.rotation = constraintDegrees(
    current.rotation + (target.rotation + rotationOffset) * mixRotate
)
next.shearY = constraintDegrees(
    current.shearY + (target.shearY + shearYOffset) * mixShearY
)

next.scaleX = current.scaleX * (
    (target.scaleX - 1 + scaleXOffset) * mixScaleX + 1
)
next.scaleY = current.scaleY * (
    (target.scaleY - 1 + scaleYOffset) * mixScaleY + 1
)
```

`shearX` is unchanged. Recompose the driven world matrix with its current
transform mode and current parent world matrix. Root bones use the mutable
root transform.

### 5.3 Transform without `mapping`: world target

`local:false` works directly on the driven matrix `C` and captured target
matrix `T`.

Rotation uses the target reflection sign:

```text
r = reflection(T)

if relative:
    delta = constraintDegrees(xAngle(T) + rotationOffset*r)
else:
    delta = constraintDegrees(
        xAngle(T) - xAngle(C) + rotationOffset*r
    )

rotate both C axes in world space by delta * mixRotate
```

World-axis rotation, in the written order, is:

```text
co = cos(degToRad(angle))
si = sin(degToRad(angle))

next.a = co*C.a - si*C.b
next.b = si*C.a + co*C.b
next.c = co*C.c - si*C.d
next.d = si*C.c + co*C.d
```

Translation offsets are expressed in target local axes:

```text
offsetWorld = T * (xOffset, yOffset)

if relative:
    C.tx = C.tx + offsetWorld.x * mixX
    C.ty = C.ty + offsetWorld.y * mixY
else:
    C.tx = C.tx + (offsetWorld.x - C.tx) * mixX
    C.ty = C.ty + (offsetWorld.y - C.ty) * mixY
```

For each scale axis independently:

```text
currentLength = length(C.axis)

if mix != 0 && currentLength > MATRIX_EPSILON:
    if relative:
        factor = (length(T.axis) - 1 + scaleOffset) * mix + 1
    else:
        factor = (
            currentLength
          + (length(T.axis) - currentLength + scaleOffset) * mix
        ) / currentLength
    C.axis = C.axis * factor
```

An axis at or below `MATRIX_EPSILON` remains unchanged; it is not assigned an
arbitrary direction.

For shear Y:

```text
targetAxisDelta =
    constraintDegrees(yAngle(T) - xAngle(T))
currentYAngle = yAngle(C)

if relative:
    delta = targetAxisDelta - 90 + shearYOffset*r
else:
    delta =
        targetAxisDelta
      - constraintDegrees(currentYAngle - xAngle(C))
      + shearYOffset*r

nextYAngle = currentYAngle
           + constraintDegrees(delta) * mixShearY
yLength = length(C.yAxis)
C.c = cos(degToRad(nextYAngle)) * yLength
C.d = sin(degToRad(nextYAngle)) * yLength
```

The result is accepted only if all six matrix components are finite.

### 5.4 Property mapping source values

When `mapping` is present, its `localSource` and `localTarget` flags replace
the legacy `local` flag for source/target space selection.

The six source properties are ordered only for notation:
`[rotate,x,y,scaleX,scaleY,shearY]`.

For `localSource:true`:

```text
source = [
    targetLocal.rotation + rotationOffset,
    targetLocal.x        + xOffset,
    targetLocal.y        + yOffset,
    targetLocal.scaleX   + scaleXOffset,
    targetLocal.scaleY   + scaleYOffset,
    targetLocal.shearY   + shearYOffset
]
```

For `localSource:false`:

```text
r = reflection(targetWorld)
p = targetWorld * (xOffset, yOffset)

source = [
    positiveDegrees(xAngle(targetWorld) + rotationOffset*r),
    p.x,
    p.y,
    xScale(targetWorld) + scaleXOffset,
    yScale(targetWorld) + scaleYOffset,
    constraintDegrees(
        yAngle(targetWorld) - xAngle(targetWorld) - 90 + shearYOffset
    )
]
```

Iterate `mapping.properties` in declaration order. Source properties are
unique. For each source:

```text
s = source[source.property] - source.offset
```

Then iterate its `targets` in declaration order:

```text
v = target.offset + s*target.scale
if mapping.clamp:
    v = clamp(v, min(target.offset,target.max),
                 max(target.offset,target.max))
amount = mixFor(target.property)
if amount == 0:
    skip this target
```

Targets are unique within one source. The same target property may be driven
by multiple different sources; those writes are intentionally sequential in
mapping declaration order.

### 5.5 Mapped local target

For `localTarget:true`, apply each mapped value `v` to the current local pose.
For `relative:false`:

```text
rotate: current.rotation += (v - current.rotation) * amount
x:      current.x        += (v - current.x)        * amount
y:      current.y        += (v - current.y)        * amount
shearY: current.shearY   += (v - current.shearY)   * amount

scaleX:
    if current.scaleX != 0:
        current.scaleX += (v - current.scaleX) * amount
scaleY:
    if current.scaleY != 0:
        current.scaleY += (v - current.scaleY) * amount
```

Mapped absolute local rotation and shear are deliberately linear values; they
do not take the shortest angular path and are not normalized after each
write.

For `relative:true`:

```text
rotate: current.rotation += v * amount
x:      current.x        += v * amount
y:      current.y        += v * amount
shearY: current.shearY   += v * amount

scaleX: current.scaleX *= 1 + (v - 1) * amount
scaleY: current.scaleY *= 1 + (v - 1) * amount
```

After all mappings, recompose the world state through normal bone hierarchy
rules.

### 5.6 Mapped world target

For `localTarget:false`, writes operate sequentially on the current world
matrix.

```text
rotate:
    delta = if relative then v else v - xAngle(current)
    rotate both axes by constraintDegrees(delta) * amount

x:
    delta = if relative then v else v - current.tx
    current.tx += delta * amount

y:
    delta = if relative then v else v - current.ty
    current.ty += delta * amount
```

For mapped scale X/Y:

```text
axisLength = length(current.axis)
if axisLength > MATRIX_EPSILON:
    factor =
        if relative:
            1 + (v - 1) * amount
        else:
            1 + (v - axisLength) * amount / axisLength
    current.axis = current.axis * factor
```

For mapped shear Y:

```text
x = xAngle(current)
y = yAngle(current)
delta =
    if relative:
        v
    else:
        v + 90 - constraintDegrees(y - x)
nextY = y + constraintDegrees(delta) * amount
lengthY = length(current.yAxis)
current.c = cos(degToRad(nextY)) * lengthY
current.d = sin(degToRad(nextY)) * lengthY
```

The final matrix must be finite.

### 5.7 Applied local pose and degenerate branches

A world-target Transform writes the authoritative world matrix first. It
then attempts to reconstruct an equivalent local pose for later local-space
constraints. Reconstruction uses the current parent/root matrix and the
bone's current transform mode as specified by Core Animation Algorithms v1.

- a required matrix inverse fails at
  `abs(det) <= MATRIX_EPSILON`;
- decomposed X or Y scale fails at
  `abs(scale) <= MATRIX_EPSILON`;
- `noRotationOrReflection` applied-pose reconstruction uses its regular
  parent basis when `parent.a*parent.a + parent.b*parent.b > 0.0001`;
  otherwise it uses the deterministic zero-X-axis branch from Core Animation
  Algorithms v1;
- `noScale` applied-pose reconstruction uses at most 12 Newton-style
  iterations, stops at angular error `<=0.0001` degrees, estimates a
  derivative with a `0.01` degree step, rejects derivative magnitude
  `<=0.00001`, and clamps a correction to `[-45,45]` degrees;
- the no-scale reconstruction basis rejects an axis length `<=0.00001`.

If reconstruction fails, the world matrix remains the constraint result and
the prior local pose remains. Descendants are still recomputed from their own
local poses under that world matrix. A later local-space source therefore
sees the last available local pose; a later world-space source sees the
authoritative matrix.

After any successful driven-bone write, descendant propagation starts with
that bone, scans the validated parent-before-child skeleton order once, and
recomposes every bone whose parent was affected. The sampled transform mode
is used. This propagation occurs before the next `boneIds` entry and before
the next constraint.

### 5.8 Transform diagnostic

For diagnostics only, make a copy of the constraint where every finite,
nonzero property mix becomes `1`, and every zero mix remains `0`. Do not use
`MATRIX_EPSILON` or another epsilon for this decision.

Evaluate that ideal state from the same pre-write current state. Report the
maximum actual-to-ideal residual across driven bones for each property whose
original mix is nonzero:

- translation: `hypot(actual.x-ideal.x, actual.y-ideal.y)`, with a zero
  component for an axis whose mix is zero;
- rotation: absolute `constraintAngleDelta`;
- scale: maximum absolute selected-axis difference;
- shear Y: absolute `constraintAngleDelta` of derived world shear.

These transient diagnostics do not alter the pose or serialized data.

## 6. Match-offset operation

`matchTransformConstraintOffsets` is defined only for:

- no `mapping`, where source and target locality both equal `local`; or
- an **exact canonical mapping**: `clamp:false`, exactly one identity source
  for each of the six properties, exactly one same-property target per
  source, source/target offsets exactly zero, and target scale exactly one.

There is no epsilon in canonical recognition. A tiny non-zero offset or scale
delta is a custom mapping and the operation returns unsupported/no result.

The operation uses the first `boneIds` entry as the constrained bone. Let:

```text
desired =
    if relative:
        [0,0,0,1,1,0]
    else if localTarget:
        constrained bone local [rotation,x,y,scaleX,scaleY,shearY]
    else:
        constrained bone world
        [positiveDegrees(xAngle),tx,ty,xScale,yScale,worldShearY]

source =
    if localSource:
        target bone local [rotation,x,y,scaleX,scaleY,shearY]
    else:
        target bone world
        [positiveDegrees(xAngle),tx,ty,xScale,yScale,worldShearY]
```

World shear is:

```text
worldShearY =
    constraintDegrees(atan2(-M.c,M.d)*180/pi - xAngle(M))
```

For a local source:

```text
xOffset        = desired.x - source.x
yOffset        = desired.y - source.y
rotationOffset = constraintDegrees(desired.rotation - source.rotation)
```

For a world source, require `inverse(sourceWorld)`:

```text
localOffset = inverse(sourceWorld) * (desired.x, desired.y)
xOffset = localOffset.x
yOffset = localOffset.y
rotationOffset =
    constraintDegrees(desired.rotation - source.rotation)
  * reflection(sourceWorld)
```

The remaining offsets are:

```text
scaleXOffset = desired.scaleX - source.scaleX
scaleYOffset = desired.scaleY - source.scaleY
shearYOffset = constraintDegrees(desired.shearY - source.shearY)
```

Return no result if any offset is non-finite.

## 7. Required and proposed conformance coverage

The existing Runtime v1 matrix proves declaration-order scheduling,
constraint timeline sampling, and basic one-bone IK/Transform output. A
runtime MUST NOT infer that those cases cover all branches in this document.

The next fixture revision should add these independent, language-neutral
cases and pin their expected matrices/diagnostics:

| Proposed case | Required branches |
| --- | --- |
| `ik-one-shear-reflection-tiny-mix` | non-zero `shearX`, positive/negative `scaleX`, exact zero versus positive sub-epsilon mix, singular parent inverse |
| `ik-two-analytic-matrix` | both bend signs, unequal lengths, compress/stretch, all three `uniform` modes, positive softness below/above its activation epsilon, non-inherited child scale |
| `ik-ccd-declaration-order` | three-bone direct chain, iteration/threshold early exits, degenerate vectors, partial mix, rejection of reversed/disconnected chains |
| `constraint-skin-and-list-order` | active/inactive skin membership, inactive target, mixed IK/Transform declaration order |
| `transform-local-world-modes` | local/world × relative/absolute, all six mixes, shear, non-uniform scale, reflected target, ancestor/descendant propagation |
| `transform-unbounded-mixes` | negative and greater-than-one setup/timeline/override mixes across legacy and mapped local/world paths, plus non-finite-result atomic rejection |
| `transform-mapping-order` | all source/target properties, repeated target across sources, clamp with reversed offset/max, local/world source and target combinations |
| `transform-degenerate-and-match` | zero world axis, near-singular inverse, exact canonical versus tiny custom mapping, first-bone match offsets |

Focused Rust reference tests may exercise additional implementation detail,
but only public manifest fixtures and the language-neutral conformance result
protocol establish a cross-language capability claim.
