# Cane Runtime v1 Path, Physics, and Slider Constraint Algorithms

Status: normative for Runtime API 1.0.

This document defines the language-neutral Path, Physics, and Slider
constraint algorithms. Together with the
[Runtime Model](../formats/RUNTIME_MODEL_V1.md),
[Runtime API](RUNTIME_API_V1.md),
[Core Animation Algorithms](CORE_ANIMATION_ALGORITHMS_V1.md), and
[Geometry and Render Algorithms](GEOMETRY_RENDER_ALGORITHMS_V1.md), it is
sufficient to implement these three constraint families without consulting
the Rust reference implementation.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Shared numeric, activation, and ordering rules

The numeric and affine conventions in Core Animation Algorithms v1 apply:

- time is seconds, angles are degrees, positions are `px`;
- the reference scalar is IEEE 754 binary32;
- all persisted and operation-input numbers are finite;
- expressions are evaluated in the written order;
- the complete six-component affine matrix is authoritative;
- `euclideanRemainder(x,m)` is in `[0,m)` for positive `m`;
- `wrapDegrees(x) = euclideanRemainder(x + 180, 360) - 180`.

All zero, sign, range, and degeneracy decisions in this document are exact
binary32 comparisons. An implementation MUST NOT substitute an epsilon for
any stated comparison. In particular:

- the smallest positive binary32 duration is positive;
- the smallest positive binary32 Path or Physics mix is active;
- the smallest positive or negative binary32 Slider mix is active;
- a determinant is singular only when it is exactly zero or non-finite;
- `+0` and `-0` compare equal and both take the zero branch.

Conformance tolerances apply only when comparing published numbers. They do
not alter an algorithm branch.

At the beginning of `apply`, setup constraints are copied into mutable sampled
constraints. Animation layers and host overrides modify that sampled copy.
Constraints are then visited exactly once in document declaration order.
After a constraint modifies a bone, the implementation rebuilds the affected
local pose and propagates world transforms to its descendants. A multi-bone
Path constraint is one atomic constraint operation: every driven bone reads
the same world-state snapshot captured before that Path constraint, then the
staged commit rule in section 2.8 publishes all desired worlds without one
driven bone contaminating another. Consequently, every later constraint
observes the complete final result of every earlier constraint.

A constraint listed by one or more skins is active only when at least one
sampled active skin lists it. A member listed by no skin is always active.
Additional family-specific activation rules are stated below. An inactive or
unresolvable constraint is a deterministic no-op and produces no diagnostic.
Validated Runtime Format v1 data prevents unresolved setup references; the
no-op rules cover runtime attachment/skin selection and defensive API
implementations.

## 2. Path attachments and Path constraints

### 2.1 Cubic control-point layout

A Path attachment contains `N >= 2` knots. Each knot has exactly three
two-dimensional control points in this order:

```text
knot[i] = [incomingHandle[i], anchor[i], outgoingHandle[i]]
```

The flattened `vertices` array therefore has six numbers per knot:

```text
[
  incomingX, incomingY,
  anchorX,   anchorY,
  outgoingX, outgoingY,
  ...
]
```

For curve `i`, with `next = (i + 1) mod N`:

```text
p0 = anchor[i]
p1 = outgoingHandle[i]
p2 = incomingHandle[next]
p3 = anchor[next]
```

An open Path has `N - 1` curves. A closed Path has `N` curves and the final
curve connects the last knot to the first.

The cubic point at `t in [0,1]` is:

```text
u = 1 - t
B(t) =
    u*u*u*p0
  + 3*u*u*t*p1
  + 3*u*t*t*p2
  + t*t*t*p3
```

Its tangent is:

```text
dx =
    3*u*u*(p1.x - p0.x)
  + 6*u*t*(p2.x - p1.x)
  + 3*t*t*(p3.x - p2.x)

dy =
    3*u*u*(p1.y - p0.y)
  + 6*u*t*(p2.y - p1.y)
  + 3*t*t*(p3.y - p2.y)
```

When `dx != 0 || dy != 0`, the tangent angle is
`atan2(dy,dx)` converted to degrees. When the derivative is exactly zero, the
setup-length sampler falls back to the angle from `p0` to `p3`.

### 2.2 World control points, weights, and deform

The Path constraint resolves the target slot's currently selected attachment
after animation, skin, attachment override, and deform sampling. If that
attachment is not a Path, the constraint is a no-op.

World control points use the vertex-attachment algorithm in
Geometry and Render Algorithms v1:

- an unweighted point is transformed by the target slot bone's full world
  matrix;
- a weighted point is the normalized positive-influence sum using the current
  full world matrices and either explicit influence-local coordinates or the
  declared bind inverse;
- `vertexPositions` deform replaces each setup point before projection;
- `weightedInfluenceOffsets` deform offsets each influence-local coordinate
  before weighted projection;
- malformed rows, missing bind data, a zero positive-weight sum, or non-finite
  output make Path resolution fail rather than inventing a fallback transform.

The Path solver operates on these final world control points. It MUST NOT run
a second skinning or deform formula of its own.

### 2.3 Constant-speed sampler

When `constantSpeed == true`, each current world cubic first receives a coarse
length by subdividing it into exactly four equal parameter intervals:

```text
t[j] = j / 4, j = 0..4
```

The four Euclidean segment lengths are accumulated in binary32. Curve coarse
lengths are then accumulated in declaration order; their final cumulative
value is `totalLength` and selects which cubic owns an input distance.

Independently, every curve is subdivided into exactly ten equal parameter
intervals. The ten Euclidean segment lengths form a curve-local binary32
cumulative lookup. For an in-range distance, select the first coarse curve end
greater than or equal to the distance. Convert the distance to coarse curve
progress and then to a target in the ten-segment lookup:

```text
curveProgress = (distance - curveStart) / coarseCurveLength
target = curveProgress * detailedCurveLength
segment = first detailed cumulative length >= target
segmentProgress = (target - segmentStart) / segmentLength
t = (segmentIndex + segmentProgress) / 10
point = B(t)
tangent = angle(B'(t))
```

All divisions use ratio zero when their denominator is exactly zero, and
ratios are clamped to `[0,1]`. The final point is evaluated on the cubic; it is
not a linear interpolation between lookup samples. A zero derivative uses the
`p0` to `p3` fallback from section 2.1.

The sampler exists only when `totalLength > 0`. Zero-length segments remain
in either cumulative table; they are not expanded by an epsilon.

### 2.4 Setup-length sampler

When `constantSpeed == false`, each current world curve is sampled directly,
but distance-to-curve parameterization comes from cumulative Path lengths.

An authoritative `lengths` array is used when:

1. its count is exactly the Path knot count;
2. every value is finite;
3. values are non-negative and non-decreasing.

Only the first `curveCount` cumulative values parameterize curves. For an open
Path, the final knot entry is format padding and is not a separate curve
length. If the authoritative array is absent, the implementation computes a
deterministic fallback from the current world control points by the same
24-subdivision cumulative-length algorithm used by format tooling.

The sampler exists only when the last used cumulative length is greater than
zero. Equal adjacent cumulative values are legal and create a zero-length
parameter interval.

For an in-range distance, select the first cumulative curve end greater than
or equal to the distance. Let `previousLength` be zero for the first curve and
the prior cumulative entry otherwise:

```text
curveLength = curveEnd - previousLength
t = 0                                      if curveLength == 0
t = clamp((distance-previousLength)
          / curveLength, 0, 1)             otherwise
point = B(t)
```

This mode does not reparameterize the current cubic by current geometric arc
length. Setup lengths select a curve and linearly select that curve's `t`.

### 2.5 Closed wrapping and open extrapolation

For a closed Path:

```text
distance = euclideanRemainder(distance, totalLength)
```

This applies to negative and positive distances. Therefore sampling exactly
`totalLength` returns the start point.

For an open Path, an in-range endpoint is owned by the Path. Extrapolation in
both modes uses the cubic's first anchor/outgoing-handle segment or final
incoming-handle/anchor segment.

Let `startFrom` be the first outgoing handle. A distance below zero
extrapolates from the first anchor toward the opposite direction:

```text
direction = normalize(firstAnchor - startFrom)
point = firstAnchor + direction * (-distance)
```

Let `endFrom` be the final incoming handle. A distance above `totalLength`
extrapolates from the final anchor in the continuing direction:

```text
direction = normalize(finalAnchor - endFrom)
point = finalAnchor + direction * (distance - totalLength)
```

If the applicable endpoint segment is exactly zero length, extrapolation
fails. No epsilon tangent is synthesized.

### 2.6 Projection to a Path distance

Projection subdivides each cubic into 24 equal `t` intervals in both modes.
Setup-length mode assigns each segment a linearly proportional portion of the
curve's declared cumulative-length interval. Constant-speed mode computes the
24-segment local cumulative Euclidean length and scales it into that curve's
four-segment coarse-length interval. The projection table is only an inverse
query aid; forward constant-speed sampling still uses the ten-segment lookup
from section 2.3.

For each non-zero segment:

```text
r = clamp(dot(target-from, to-from) / lengthSquared, 0, 1)
projected = from + (to-from)*r
distance = lerp(segmentDistanceFrom, segmentDistanceTo, r)
```

Candidates are visited in curve and subdivision declaration order. A candidate
replaces the current best only when its squared spatial distance is strictly
smaller. Equal-distance ties therefore select the earliest Path segment.

An open Path additionally considers the two infinite endpoint tangent rays.
The direction uses the first anchor/outgoing-handle or final incoming-handle/
anchor segment. Only a negative projection on the start tangent or a positive
projection on the end tangent is eligible. A closed Path has no tangent-ray
projection. Non-finite candidates and exactly zero-length projected segments
are ignored.

For `positionMode == "percent"`, a projected fixed distance is divided by
`totalLength`; the sampler already guarantees `totalLength > 0`.

### 2.7 Position and spacing

The starting Path distance is:

```text
distance = position                       for positionMode fixed
distance = position * totalLength         for positionMode percent
```

For a driven bone:

```text
setupLength = max(bone.length, 0)
worldLength = setupLength * hypot(world.a, world.b)
```

Let `spacingWorldLengths` contain that value for each driven bone. Let:

```text
spacingBoneCount =
    max(boneCount - 1, 0)                 for rotateMode tangent
    boneCount                             for rotateMode chain or chainScale

proportionalWorldLength =
    sum(first spacingBoneCount spacingWorldLengths)

spacesCount =
    boneCount                             for rotateMode tangent
    boneCount + 1                         for rotateMode chain or chainScale
```

The spacing added after a bone is:

| `spacingMode` | distance increment |
| --- | --- |
| `length`, `setupLength > 0` | `max(setupLength + spacing, 0) * worldLength / setupLength` |
| `length`, `setupLength == 0` | `spacing` |
| `fixed`, `setupLength > 0` | `spacing * worldLength / setupLength` |
| `fixed`, `setupLength == 0` | `spacing` |
| `percent` | `spacing * totalLength` |
| `proportional`, total `> 0` | `raw / proportionalWorldLength * spacing * totalLength`, where `raw = worldLength` when setup length is positive and `raw = spacing` otherwise |
| `proportional`, total `== 0` | `spacing * totalLength / max(spacesCount,1)` |

The first driven bone uses the starting distance. Before every later driven
bone, add spacing for the preceding bone. A second sample for the current bone
uses `distance + currentBoneSpacing`.

### 2.8 Rotation, translation, scale, and reflection

For each driven bone in constraint `boneIds` order:

```text
sample = samplePath(distance)
next = samplePath(distance + currentBoneSpacing)
chainAngle = angle(next.point - sample.point)

desiredRotation =
    sample.tangent                         for rotateMode tangent
    chainAngle                             for rotateMode chain or chainScale

desiredRotation += signedRotationOffset
```

Reflection changes the configured rotation offset, not the sampled Path:

```text
slotDeterminant = det(targetSlotBoneWorld)
signedRotationOffset =
    -rotation                              if rotation != 0
                                             && slotDeterminant < 0
    rotation                               otherwise
```

The exact determinant-zero case is not reflected.

Mixing is:

```text
mixedX = currentX + (sampleX-currentX) * clamp(mixX,0,1)
mixedY = currentY + (sampleY-currentY) * clamp(mixY,0,1)

rotationDelta = wrapDegrees(desiredRotation-currentRotation)
mixedRotation =
    currentRotation + rotationDelta * clamp(mixRotate,0,1)
```

For `chainScale` and `bone.length != 0`:

```text
targetLength = distance(next.point, sample.point)
desiredScaleX = targetLength / abs(bone.length)
mixedScaleX =
    currentScaleX + (desiredScaleX-currentScaleX)
                  * clamp(mixRotate,0,1)
```

Otherwise world scale X is unchanged. The solved world matrix uses
`mixedX`, `mixedY`, `mixedRotation`, zero world shear X, the current world
shear Y, `mixedScaleX`, and the current world scale Y.

Sampling and mixing MUST preserve the authored `boneIds` order, but every
`current*` value above comes from the immutable world-state snapshot that
existed immediately before this Path constraint began. Updating an earlier
driven parent MUST NOT first recompute a later driven child's current matrix.
During the ordered pass, Core stores each driven bone's desired world matrix.
Once the pass finishes, Core commits stored desired worlds in skeleton parent-
before-child order. Each driven local pose is reconstructed against its
already committed final parent; non-driven bones are recomputed once from
their current local pose only when they descend from a Path-driven bone.
Unrelated branches MUST retain the result produced by earlier constraints.
This hierarchy commit MUST leave every stored driven world matrix intact for
both parent-first and child-first authored lists. It is part of the one Path
constraint solve, not a second animation sample or constraint pass.

For `rotateMode == "chain"` with configured `rotation == 0` and
`mixRotate != 0`, the next bone's starting sample is adjusted toward the
fully rotated current bone tip:

```text
fullDelta = wrapDegrees(chainAngle-currentRotation)
rotatedFirstColumn = rotate(currentMatrix.firstColumn, fullDelta)
fullTip = sample.point + bone.length * rotatedFirstColumn
nextChainPoint = lerp(next.point, fullTip, clamp(mixRotate,0,1))
```

This adjustment is used only as the following driven bone's `sample`; it does
not alter the Path sampler.

Path activation additionally requires the target slot bone to be active. Once
active, the declared driven-bone list is solved as a unit; member-skin
activation does not prune individual Path-driven bones.

## 3. Physics constraints

### 3.1 Validated setup domain

Runtime Format v1 requires:

- `fps > 0`;
- `limit >= 0`, `strength >= 0`, and `mass > 0`;
- `x`, `y`, `rotate`, `scaleX`, `shearX`, `inertia`, `damping`, and `mix`
  in `[0,1]`;
- finite `wind` and `gravity`;
- `scaleYMode` equal to `none`, `uniform`, or `volume`.

Runtime timeline and host-patch blending preserves every positive mass,
including the smallest positive binary32 value. If timeline arithmetic yields
`mass <= 0`, it becomes exactly the smallest positive binary32 value; it is
not raised to an epsilon. The solver clamps inertia and damping to `[0,1]`,
uses `max(strength,0)`, and treats `max(limit,0)` as the configured limit.

### 3.2 Environment and persistent state

The default Physics environment is:

```text
windDirection    = (1,0)
gravityDirection = (0,1)
```

The host may set four finite direction components. These vectors are not
normalized.

Each Physics constraint ID owns independent mutable state:

| state | initial value | purpose |
| --- | ---: | --- |
| `reset` | `true` | first-evaluation alignment flag |
| `ux`,`uy` | `0` | prior unconstrained origin for translation inertia |
| `cx`,`cy` | `0` | prior unconstrained origin for tip inertia |
| `tipX`,`tipY` | `0` | prior constrained bone-tip vector |
| `xOffset`,`yOffset` | `0` | simulated translation offsets |
| `xLag`,`yLag` | `0` | most recent fixed-step translation change |
| `xVelocity`,`yVelocity` | `0` | translation velocities |
| `rotateOffset` | `0` | simulated angular offset in radians |
| `rotateLag` | `0` | most recent fixed-step angular change |
| `rotateVelocity` | `0` | angular velocity |
| `scaleOffset` | `0` | simulated scale delta |
| `scaleLag` | `0` | most recent fixed-step scale change |
| `scaleVelocity` | `0` | scale velocity |
| `remaining` | `0` | unconsumed simulation time |

`resetPhysics`, a per-constraint reset, animation identity change, or backward
primary-track movement restores the applicable state to this table. Physics
does not integrate negative time.

### 3.3 Physics timeline values and reset edges

A Physics timeline addressed to a specific constraint samples its declared
`inertia`, `strength`, `damping`, `mass`, `wind`, `gravity`, and `mix`
channels normally.

A timeline with `constraintId == "*"` applies each sampled scalar only to
Physics constraints whose corresponding setup `...Global` flag is true.
Declaration order remains the document constraint order.

`reset:true` is an edge, not a sampled sticky value. A reset key fires only:

1. from the primary animation;
2. when that layer's alpha is at least `0.5`;
3. when forward raw track movement crosses the key using `(from,to]`.

For a looping duration `D > 0`, a key at `k` is crossed when any
`k + n*D` is in `(from,to]`; one update may cross any number of loops. Exact
arrival fires the reset, exact departure does not. Reverse/no movement does
not fire a reset edge because backward motion resets Physics history as a
whole. A wildcard reset resets every active Physics constraint, independently
of its scalar `...Global` flags.

### 3.4 Entry conditions and fixed-step planning

The solver is a no-op when:

- `mix == 0`;
- `fps == 0`;
- `referenceScale` is non-finite or not positive;
- any environment component is non-finite;
- the constraint or its bone is inactive.

The exact-zero `mix` branch freezes that constraint state; skipped wall time is
not accumulated.

For an active solve:

```text
delta = max(deltaSeconds,0)                when deltaSeconds is finite
delta = 0                                  otherwise
step = 1 / fps
nextRemaining = state.remaining + delta

xEnabled      = x > 0
yEnabled      = y > 0
rotateEnabled = rotate > 0 || shearX > 0
scaleEnabled  = scaleX > 0
```

If `state.reset` is true, no fixed step is executed. Set:

```text
state.reset = false
state.ux = currentOriginX
state.uy = currentOriginY
state.remaining = nextRemaining
```

The usual player performs an initial zero-delta setup evaluation, so normal
playback begins with aligned state.

Otherwise, when at least one channel is enabled, fixed-step count is planned
before state mutation:

```text
remaining = nextRemaining
count = 0
while remaining >= step:
    require aggregate budget has one remaining substep
    next = remaining - step
    require next != remaining
    remaining = next
    count += 1
plannedRemaining = remaining
```

Every comparison and subtraction is binary32. A non-finite/non-positive step,
non-finite remaining time, no-progress subtraction, or an exhausted aggregate
budget fails with `resourceLimit`.

One planned iteration is one conceptual Physics fixed substep for budget
accounting, even though the reference equations run the translation phase and
the rotation/scale phase in separate loops of the same count.

### 3.5 Shared coefficients and movement limit

For a non-reset evaluation:

```text
inertia = clamp(constraint.inertia,0,1)
xLimit = max(limit,0) * delta * abs(rootScaleX)
yLimit = max(limit,0) * delta * abs(rootScaleY)
dampingPerStep = clamp(damping,0,1) ^ (60*step)
accelerationScale = step / mass
strength = max(constraint.strength,0)
mix = constraint.mix
```

The limit bounds inertial movement introduced by the unconstrained bone
movement during this public sample. It does not clamp simulated spring
offsets or force integration.

For diagnostics, `requiredLimit` begins at zero. Each non-zero raw inertial
movement contributes:

```text
candidate = abs(movement) / (delta * abs(applicableRootScale))
```

If that denominator is exactly zero or the candidate is non-finite,
`requiredLimit` becomes unavailable. `limitSaturated` is true only when a raw
movement is strictly greater than its configured axis limit.

### 3.6 Translation phase

Let `origin = (matrix.tx,matrix.ty)`. Before integration:

```text
movementX = (state.ux-origin.x) * inertia
state.xOffset += clamp(movementX,-xLimit,xLimit)
state.ux = origin.x

movementY = (state.uy-origin.y) * inertia
state.yOffset += clamp(movementY,-yLimit,yLimit)
state.uy = origin.y
```

Execute only the enabled axis statements.

When at least one fixed step is planned:

```text
wind = referenceScale * constraint.wind
gravity = referenceScale * constraint.gravity

forceX = (wind*environment.windX
        + gravity*environment.gravityX) * rootScaleX
forceY = (wind*environment.windY
        + gravity*environment.gravityY) * rootScaleY

previousX = state.xOffset
previousY = state.yOffset

repeat plannedSteps:
    if xEnabled:
        state.xVelocity +=
            (forceX-state.xOffset*strength) * accelerationScale
        state.xOffset += state.xVelocity * step
        state.xVelocity *= dampingPerStep

    if yEnabled:
        state.yVelocity -=
            (forceY+state.yOffset*strength) * accelerationScale
        state.yOffset += state.yVelocity * step
        state.yVelocity *= dampingPerStep

state.xLag = state.xOffset-previousX
state.yLag = state.yOffset-previousY
remaining = plannedRemaining
```

The interpolation factor is:

```text
interpolation = max(1-remaining/step,0)
```

Apply translation:

```text
matrix.tx += (state.xOffset-state.xLag*interpolation) * mix * x
matrix.ty += (state.yOffset-state.yLag*interpolation) * mix * y
```

Only enabled axes are applied.

### 3.7 Rotation and scale inertia

When rotation/shear or scale is enabled:

```text
axisAngle = atan2(matrix.b,matrix.a)
rawTipDeltaX = state.cx-matrix.tx
rawTipDeltaY = state.cy-matrix.ty
tipDeltaX = clamp(rawTipDeltaX,-xLimit,xLimit)
tipDeltaY = clamp(rawTipDeltaY,-yLimit,yLimit)
rotateMix = (rotate+shearX) * mix
```

The raw tip deltas also contribute to `requiredLimit` and saturation.

When rotation is enabled:

```text
previousLag =
    state.rotateLag * max(1-previousRemaining/step,0)

incoming =
      atan2(tipDeltaY+state.tipY, tipDeltaX+state.tipX)
    - axisAngle
    - (state.rotateOffset-previousLag)*rotateMix

state.rotateOffset += wrapRadians(incoming) * inertia
forceAngle =
    (state.rotateOffset-previousLag)*rotateMix + axisAngle
forceCos = cos(forceAngle)
forceSin = sin(forceAngle)

if scaleEnabled:
    worldLength = boneLength * hypot(matrix.a,matrix.b)
    if worldLength > 0:
        state.scaleOffset +=
            (tipDeltaX*forceCos + tipDeltaY*forceSin)
            * inertia / worldLength
```

`wrapRadians(x)` is
`euclideanRemainder(x + pi, 2*pi) - pi`.

When rotation is disabled but scale is enabled:

```text
forceCos = cos(axisAngle)
forceSin = sin(axisAngle)
worldLength =
    boneLength*hypot(matrix.a,matrix.b)
    - state.scaleLag*max(1-previousRemaining/step,0)

if worldLength > 0:
    state.scaleOffset +=
        (tipDeltaX*forceCos + tipDeltaY*forceSin)
        * inertia / worldLength
```

For fixed-step force integration:

```text
forceX = constraint.wind*environment.windX
       + constraint.gravity*environment.gravityX
forceY = constraint.wind*environment.windY
       + constraint.gravity*environment.gravityY
lengthScale = boneLength/referenceScale

previousRotate = state.rotateOffset
previousScale = state.scaleOffset

for stepIndex = 0 .. plannedSteps-1:
    if scaleEnabled:
        state.scaleVelocity +=
            ( forceX*forceCos
            - forceY*forceSin
            - state.scaleOffset*strength) * accelerationScale
        state.scaleOffset += state.scaleVelocity*step
        state.scaleVelocity *= dampingPerStep

    if rotateEnabled:
        state.rotateVelocity -=
            ((forceX*forceSin + forceY*forceCos)*lengthScale
             + state.rotateOffset*strength) * accelerationScale
        state.rotateOffset += state.rotateVelocity*step
        state.rotateVelocity *= dampingPerStep

    if rotateEnabled && stepIndex+1 < plannedSteps:
        forceAngle = state.rotateOffset*rotateMix + axisAngle
        forceCos = cos(forceAngle)
        forceSin = sin(forceAngle)

state.rotateLag = state.rotateOffset-previousRotate
state.scaleLag = state.scaleOffset-previousScale
remaining = plannedRemaining
interpolation = max(1-remaining/step,0)
```

After both phases, `state.remaining = remaining`.

### 3.8 Applying angular and scale results

```text
rotationOffset =
    (state.rotateOffset-state.rotateLag*interpolation) * mix
```

When `rotate > 0`, left-rotate both matrix columns by
`rotationOffset*rotate`. When `shearX > 0`, rotate only the first matrix column
by `rotationOffset*shearX`.

When `scaleX > 0`:

```text
scale =
    1 + (state.scaleOffset-state.scaleLag*interpolation)
        * mix * scaleX

matrix.a *= scale
matrix.b *= scale
```

Then apply `scaleYMode`:

| mode | second-column multiplier |
| --- | --- |
| `none` | `1` |
| `uniform` | `scale` |
| `volume`, `abs(scale) >= 0.7` | `1 / abs(scale)` |
| `volume`, `abs(scale) < 0.7` | `4 - 3.67347*abs(scale)` |

The exact `0.7` branch is the reciprocal branch. A zero scale in volume mode
uses multiplier `4`; it does not divide by zero.

The resulting full matrix is converted back to the applied local pose and
descendants are propagated. Store for the next evaluation:

```text
state.cx = unconstrainedOriginX
state.cy = unconstrainedOriginY
state.tipX = boneLength*matrix.a
state.tipY = boneLength*matrix.b
```

### 3.9 Finite-state errors, resource limits, and atomicity

After solving, every state scalar and all six matrix components MUST be
finite. A non-finite solver result fails with structured Runtime API code
`nonFinite` and the Physics constraint ID as `entityId`. It MUST NOT be
silently skipped, clamped, or published.

Runtime API v1 permits exactly 1,000,000 aggregate Physics fixed substeps per
public `apply`, `advance`, `seek`, or `sampleAt` operation:

- the budget is shared by all active Physics constraints;
- an absolute sample shares one budget across baseline evaluation and every
  replay sample;
- exactly 1,000,000 is allowed; the next required substep fails;
- reset/no-channel/no-op evaluations consume zero;
- a conceptual substep is counted once even when both solver phases run.

An over-limit operation fails with structured code `resourceLimit`. Public
operations evaluate against a working copy. On either `resourceLimit` or
`nonFinite`, the player configuration, clocks, queued events, Physics state,
last frame, and frame sequence remain unchanged. No partial constraint result
is observable.

The separate Runtime API absolute-replay step limit and emitted-event limit
remain in force. Passing one limit does not increase another.

## 4. Slider constraints

### 4.1 Validated setup domain

A Slider references one target animation and optionally one source bone.
`sourceOffset`, `timeOffset`, `timeScale`, manual `time`, and `mix` are any
finite binary32 values. In particular:

- `timeScale == 0` is valid and maps every source value to `timeOffset`;
- negative `timeScale` is valid;
- `mix` may be negative or greater than one;
- only exact `mix == 0` disables the Slider.

`rangeMax` is finite and non-negative authoring/inspection metadata. Runtime
API v1 does not use it to clamp source values, mapped time, or target animation
time.

A Slider timeline has two channels:

- `sliderTime` always uses replace blending, even on an additive outer track;
- `mix` uses the outer track's replace/additive blending.

Every finite non-zero resulting Slider mix remains active.

### 4.2 Source-space mapping

With `sourceBoneId == null`, the Slider is manual and begins with:

```text
sourceValue = absent
mappedTime = slider.time
```

With a source bone, that bone and the Slider constraint must both be active.
The source is sampled after all preceding declared constraints.

For `local == true`, read the current applied local pose directly:

| property | value |
| --- | --- |
| `rotate` | `pose.rotation` |
| `x` | `pose.x` |
| `y` | `pose.y` |
| `scaleX` | `pose.scaleX` |
| `scaleY` | `pose.scaleY` |
| `shearY` | `pose.shearY` |

For `local == false`, first remove the Runtime API root transform:

```text
M = inverse(rootMatrix) * sourceBoneWorldMatrix
```

The inverse exists only for a finite, exactly non-zero determinant. Failure is
a deterministic Slider no-op. Then:

| property | value |
| --- | --- |
| `rotate` | `degrees(atan2(M.b,M.a))`, adding `360` once when negative |
| `x` | `M.tx` |
| `y` | `M.ty` |
| `scaleX` | `hypot(M.a,M.b)` |
| `scaleY` | `hypot(M.c,M.d)` |
| `shearY` | `degrees(atan2(M.d,M.c))-degrees(atan2(M.b,M.a))-90` |

World `scaleX` and `scaleY` are magnitudes. World `shearY` is deliberately not
wrapped. The root transform is removed exactly once, so a root-space host
transform cannot leak into Slider source mapping.

Source mapping is:

```text
sourceValue = sampled property
mappedTime =
    timeOffset + (sourceValue-sourceOffset)*timeScale
```

A non-finite result from arithmetic overflow makes the Slider a no-op.

### 4.3 Loop, clamp, and manual-time rules

Let `D` be the target animation duration.

For a bone-sourced Slider:

```text
if looping && D > 0:
    resolvedTime = euclideanRemainder(mappedTime,D)
else:
    resolvedTime = clamp(mappedTime,0,max(D,0))
```

Thus a non-looping bone source is clamped and a negative looping source wraps
with Euclidean, not signed, remainder.

For a manual Slider:

```text
if looping && D > 0:
    resolvedTime = euclideanRemainder(mappedTime,D)
else:
    resolvedTime = mappedTime
```

A non-looping manual Slider is not numerically clamped. Normal channel sampling
leaves values unchanged before their first key and holds the last applicable
key after it. This distinction is observable in Slider diagnostics.

The `D > 0` test is exact. The smallest positive binary32 duration loops.
When `D == 0`, a bone-sourced Slider clamps to zero while a manual Slider keeps
its finite manual time.

`wrapped` is true only when the resolved looping value is not exactly equal to
`mappedTime`. `clamped` is true only for a bone source when the bounded value
is not exactly equal to `mappedTime`. No epsilon is used.

Fixed-frame sampling, when requested by the Runtime API sampling options, is
applied by the target animation's channel sampler after `resolvedTime` is
computed. A diagnostic's resolved time is the pre-quantization value.

### 4.4 Applying the target animation

If `mix` is finite and not exactly zero, sample the target animation at
`resolvedTime` as one animation layer:

```text
replace:  current + (sampled-current)*mix
additive: current + (sampled-setup)*mix
```

Rotation/shear use the common shortest-angle blend. A negative or greater-than
one mix extrapolates these formulas; it is not clamped.

The target layer may affect:

- bone transforms and inheritance;
- active skin and slot attachment selection;
- slot color/alpha;
- region pose, deform, and sequence values;
- IK, Transform, Path, Physics, and Slider sampled constraint values;
- draw order.

Discrete properties use the common exact `mix >= 0.5` selection rule where
applicable. The layer does not advance a target-animation clock and does not
emit target-animation user or lifecycle events.

After the layer, skin attachments are rebuilt. If the target animation has any
bone timelines, unconstrained world transforms are rebuilt before the next
declared constraint.

### 4.5 Declaration order and recursion barrier

The sampled constraint array is visited once from first to last. Before
applying a Slider, its current sampled definition is copied. The target
animation may mutate sampled constraints, but:

- a mutation of an earlier constraint does not rerun it;
- a mutation of the currently executing Slider does not restart it;
- a mutation of a later constraint is observed when that later declaration is
  reached;
- target-animation sampling never recursively enters the constraint solver.

These rules are the Slider recursion barrier. Self-targeting and cyclic Slider
animation graphs terminate deterministically because each declared constraint
is solved at most once per outer `apply`.

## 5. Exact branch summary

| family | condition | exact behavior |
| --- | --- | --- |
| Path | `totalLength == 0` | sampler unavailable |
| Path | cumulative span `== 0` | parameter ratio `0` |
| Path | endpoint tangent length `== 0` | open extrapolation unavailable |
| Path | target-slot determinant `< 0` | negate non-zero rotation offset |
| Path | any mix is the smallest positive binary32 | contributes normally |
| Physics | `mix == 0` | no solve and no time accumulation |
| Physics | channel coefficient `> 0` | channel enabled |
| Physics | mass is any positive binary32 | use that exact mass |
| Physics | world length `> 0` | permit scale-inertia division |
| Physics | movement `> limit` | saturation diagnostic; equality is not saturated |
| Physics | fixed-step subtraction makes no progress | `resourceLimit` |
| Slider | duration `> 0` | looping uses Euclidean remainder |
| Slider | `timeScale == 0` | source maps to `timeOffset` |
| Slider | `mix == 0` | no target layer |
| Slider | any finite non-zero mix | apply, including negative and greater than one |
| Slider | root determinant `== 0` | world source unavailable |

## 6. Required conformance coverage

The v1 conformance suite SHOULD use at least these independently loadable
cases. Case IDs are stable recommendations for the shared manifest:

| case ID | required observations |
| --- | --- |
| `path-constant-speed-open-extrapolation-v1` | four-step coarse distance, ten-step local parameter lookup, exact cubic sample/tangent, raw-handle extrapolation, projection tie order, and parent-first driven-bone snapshot isolation |
| `path-setup-lengths-weighted-deform-v1` | authoritative non-uniform cumulative lengths, deterministic missing-length fallback, weighted world points, both deform spaces |
| `path-modes-reflection-order-v1` | fixed/percent position; all spacing and rotate modes; chain tip adjustment; chainScale; reflected target-slot rotation offset; following-constraint observation |
| `physics-fixed-step-environment-reset-v1` | default/custom environment, partial remainder interpolation, forward reset edge, exact boundary, multi-loop crossing, backward history reset |
| `physics-volume-degenerate-v1` | `none`/`uniform`/both volume branches, exact `0.7`, zero scale, zero world length, smallest positive mass/mix, non-finite structured failure |
| `physics-resource-limit-atomic-v1` | aggregate exactly-at-limit success, one-over-limit `resourceLimit`, multiple constraints, apply/advance/absolute-sample rollback |
| `slider-manual-source-mapping-v1` | manual time, all local/world properties, root removal, singular root, zero/negative timeScale, metadata-only rangeMax |
| `slider-loop-clamp-additive-order-v1` | negative Euclidean loop, bone-source clamp, manual non-clamp, replace/additive unbounded mix, discrete threshold, earlier/later constraint observation |
| `slider-recursion-barrier-v1` | self and cyclic target animations, current/earlier constraint not rerun, later constraint mutation applied once |

Every case containing geometry MUST compare complete matrices, final vertices,
indices, and final light/dark tint where applicable. Physics cases MUST compare
repeated runs and operation partitioning only where this specification defines
the streams as equivalent; stateful Physics is evaluated at each published
sample and is not generally invariant to replacing many sampled poses with one
large pose change.
