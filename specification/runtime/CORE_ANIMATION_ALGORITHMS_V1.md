# Cane Runtime v1 Core Animation Algorithms

Status: normative for Runtime API 1.0.

This document defines the renderer-independent algorithms for bone affine
transforms, key sampling, animation clocks, tracks, queues, mixing, and event
boundaries. Together with the
[Runtime Model](../formats/RUNTIME_MODEL_V1.md),
[Runtime API](RUNTIME_API_V1.md), and
[Conformance Protocol](CONFORMANCE_V1.md), it is sufficient to implement this
part of a Cane runtime without consulting an implementation's source code.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
Constraint solvers, weighted geometry, clipping, and atlas projection are
specified separately; they consume the local poses and full world matrices
produced here. IK and Transform use
[IK and Transform Constraint Algorithms v1](IK_TRANSFORM_ALGORITHMS_V1.md);
geometry/render projection uses
[Geometry and Render Algorithms v1](GEOMETRY_RENDER_ALGORITHMS_V1.md).

## 1. Numeric and coordinate contract

Runtime v1 uses:

- seconds for all clocks and key times;
- degrees for rotation and shear;
- `px` for positions and lengths;
- an X-right, Y-up Cartesian plane;
- counter-clockwise positive angles;
- IEEE 754 binary32 as the reference scalar precision.

All persisted and operation-input numbers MUST be finite. A candidate MAY use
binary64 intermediates, but its published values must satisfy the active
conformance tolerances. The v1 suite compares transform and geometry numbers
with absolute and relative tolerance `1e-5`, and time, UV, and alpha numbers
with absolute and relative tolerance `1e-6`. Strings, IDs, enum values, array
order, event order, indices, and error fields are exact.

Branch constants in this document are binary32 values. Arithmetic expressions
are evaluated in the written order. A binding MUST NOT enable a process-wide
floating-point mode that flushes finite v1 inputs to a different branch.
Transcendental functions need not be bit-identical across platforms, but
repeating the same operation stream in one implementation MUST be bit-exact.

The following helpers are used below:

```text
degToRad(x)       = x * (pi / 180)
clamp(x, lo, hi)  = min(max(x, lo), hi)
hypot(x, y)       = sqrt(x*x + y*y)
det(M)            = M.a*M.d - M.c*M.b
wrapDegrees(x)    = euclideanRemainder(x + 180, 360) - 180
```

`euclideanRemainder(x,m)` is in `[0,m)` for positive `m`.
Consequently, `wrapDegrees` is in `[-180,180)` and maps positive and negative
exact half-turns to `-180`.

## 2. Affine representation

The only authoritative world transform is:

```text
xWorld = a*xLocal + c*yLocal + tx
yWorld = b*xLocal + d*yLocal + ty

M = [ a c tx ]
    [ b d ty ]
    [ 0 0  1 ]
```

For `C = A * B`, multiplication is:

```text
C.a  = A.a*B.a + A.c*B.b
C.b  = A.b*B.a + A.d*B.b
C.c  = A.a*B.c + A.c*B.d
C.d  = A.b*B.c + A.d*B.d
C.tx = A.a*B.tx + A.c*B.ty + A.tx
C.ty = A.b*B.tx + A.d*B.ty + A.ty
```

An implementation MUST retain all six components. Rotation/scale
decomposition is not an evaluation step and cannot represent all shear,
non-uniform-scale, and reflection combinations.

The determinant sign classifies orientation:

```text
det(M) > 0: orientation preserving
det(M) < 0: reflected
det(M) = 0: singular
```

Negative scale is not converted to a positive scale plus a rotation. The
matrix, including its determinant sign, continues unchanged into constraints,
weighted geometry, and render-packet winding normalization.

## 3. Local and root matrices

For a local bone pose `(x,y,rotation,shearX,shearY,scaleX,scaleY)`:

```text
rx = degToRad(rotation + shearX)
ry = degToRad(rotation + 90 + shearY)

L.a  = cos(rx) * scaleX
L.b  = sin(rx) * scaleX
L.c  = cos(ry) * scaleY
L.d  = sin(ry) * scaleY
L.tx = x
L.ty = y
```

The equivalent expressions `L.c = -sin(rotation + shearY) * scaleY`
and `L.d = cos(rotation + shearY) * scaleY` use degree arguments. At zero
shear, the two axes are perpendicular.

The mutable root transform has no shear:

```text
r = degToRad(root.rotation)

R.a  =  cos(r) * root.scaleX
R.b  =  sin(r) * root.scaleX
R.c  = -sin(r) * root.scaleY
R.d  =  cos(r) * root.scaleY
R.tx = root.x
R.ty = root.y
```

Every root bone uses `world = R * L`; a root bone's `transformMode` is not
consulted. Setup bone scales are non-zero. Runtime root-transform scales may
be any finite values, including zero and negative values.

## 4. Hierarchy and transform inheritance

Bones are evaluated once in validated parent-before-child declaration order.
For every child and every transform mode, its world origin is:

```text
worldX = P.a*local.x + P.c*local.y + P.tx
worldY = P.b*local.x + P.d*local.y + P.ty
```

Thus a mode may omit parent rotation or scale from the child's axes while the
child origin still follows the parent's complete affine transform.

### 4.1 `normal`

```text
world = P * L
```

This inherits parent rotation, shear, non-uniform scale, and reflection
without decomposition.

### 4.2 `onlyTranslation`

The child axes are exactly its local axes:

```text
world.a = L.a
world.b = L.b
world.c = L.c
world.d = L.d
world.tx = worldX
world.ty = worldY
```

### 4.3 `noRotationOrReflection`

First construct a parent basis with rotation and reflection removed while
retaining the parent's scale/shear effect:

```text
pa = P.a
pb = P.c
pc = P.b
pd = P.d
squared = pa*pa + pc*pc

if squared > 0.0001:
    s  = abs(pa*pd - pb*pc) / squared
    pb = pc * s
    pd = pa * s
    parentRotation = atan2(pc, pa) * 180/pi
else:
    pa = 0
    pc = 0
    parentRotation = 90 - atan2(pd, pb) * 180/pi
```

Then:

```text
rx = degToRad(local.rotation + local.shearX - parentRotation)
ry = degToRad(local.rotation + local.shearY - parentRotation + 90)
la = cos(rx) * local.scaleX
lc = sin(rx) * local.scaleX
lb = cos(ry) * local.scaleY
ld = sin(ry) * local.scaleY

world.a = pa*la - pb*lc
world.b = pc*la + pd*lc
world.c = pa*lb - pb*ld
world.d = pc*lb + pd*ld
world.tx = worldX
world.ty = worldY
```

The absolute determinant in `s` is what removes reflection.

### 4.4 `noScale` and `noScaleOrReflection`

Both modes remove the magnitude of parent scale from the child axes.
`noScale` preserves parent reflection; `noScaleOrReflection` removes it.

```text
r  = degToRad(local.rotation)
co = cos(r)
si = sin(r)

za = P.a*co + P.c*si
zc = P.b*co + P.d*si
axisLength = hypot(za, zc)

if axisLength > 0.00001:
    za = za / axisLength
    zc = zc / axisLength

reflection = hypot(za, zc)
if mode == noScale and det(P) < 0:
    reflection = -reflection

perpendicular = pi/2 + atan2(zc, za)
zb = cos(perpendicular) * reflection
zd = sin(perpendicular) * reflection

sx = degToRad(local.shearX)
sy = degToRad(90 + local.shearY)
la = cos(sx) * local.scaleX
lc = sin(sx) * local.scaleX
lb = cos(sy) * local.scaleY
ld = sin(sy) * local.scaleY

world.a = za*la + zb*lc
world.b = zc*la + zd*lc
world.c = za*lb + zb*ld
world.d = zc*lb + zd*ld
world.tx = worldX
world.ty = worldY
```

If `axisLength <= 0.00001`, the unnormalized finite `za,zc` values are used.
This makes the degenerate case deterministic instead of dividing by an
unstable value.

### 4.5 Animated inheritance

An inherit timeline is a discrete channel. The selected mode replaces the
setup mode before world transforms are calculated. Tracks and mixes resolve
the selected local mode using the discrete-layer rule in section 10.4. A mode
change never decomposes or compensates the current world matrix.

## 5. Animation and track clocks

Each active track entry owns:

```text
animationId
trackTime
timeScale
looping
alpha
blend                 // replace or additive
mixDuration
mixTime
eventThreshold
attachmentThreshold
drawOrderThreshold
holdPrevious
eventCursorInitialized
mixingFrom            // optional outgoing entry
```

New entries start with `trackTime=0`, `timeScale=1`, `alpha=1`,
`blend=replace`, all thresholds `0`, `holdPrevious=false`, and
`mixTime=0`. The `looping` flag comes from `setAnimation` or
`queueAnimation`.

`update(deltaSeconds)` and `advance(deltaSeconds)` require a finite
`deltaSeconds >= 0`. Runtime API v1 does not permit negative delta. Reverse
playback uses a negative finite `timeScale`.

For an entry:

```text
scaledDelta = deltaSeconds * timeScale

if looping:
    trackTime = trackTime + scaledDelta
else:
    trackTime = max(0, trackTime + scaledDelta)

mixTime = max(0, mixTime + deltaSeconds)
```

The raw looping `trackTime` is signed and unbounded. The raw non-looping time
may exceed the animation duration so queues can cross a delay after the pose
has reached its final key; it cannot become negative. `timeScale=0` freezes
the animation clock but not an active mix.

Let `D=max(animationEnd-animationStart,0)`. The pose time is:

```text
if D == 0:
    poseTime = animationStart
else if looping:
    poseTime = animationStart + euclideanRemainder(trackTime, D)
else:
    poseTime = animationStart + clamp(trackTime, 0, D)
```

Runtime Format v1 entries use the full range
`animationStart=0, animationEnd=animation.duration`. Language bindings may
offer subranges only if they preserve the same formulas and event boundaries.

## 6. Key ordering and selection

Key arrays are already sorted by `(time,declarationOrder)`. A runtime MUST
not sort equal-time keys by value, ID, object address, or hash iteration.

Sampling treats keys whose loaded IEEE 754 binary32 values compare equal as
one group. Positive and negative zero therefore belong to the same group;
NaN was already rejected. The last declared key in a group is the group's
value and outgoing curve. No epsilon is used to merge different finite times.

For one continuous property:

```text
sampleContinuous(groups, t):
    if groups is empty or t < groups[0].time:
        return NO_CONTRIBUTION

    k0 = last group whose time <= t
    if t == k0.time or k0 is the final group:
        return k0.value

    k1 = group immediately after k0
    p = (t - k0.time) / (k1.time - k0.time)
    selected = selectPropertyCurve(k0.curve, propertyName)
    return sampleCurveValue(selected, p, k0.value, k1.value)
```

Consequences:

- before the first key, setup or a lower track remains unchanged;
- at an exact key time, the last declaration at that time wins;
- after the last key, its value is held;
- a zero-length segment is removed by grouping and never divides by zero;
- the curve belongs to the outgoing key.

For a sparse constraint property, first discard keys that omit that property,
then apply the same algorithm. Omission means “this key does not key this
property”, not a zero or setup value.

Paired bone channels (`translate`, `scale`, `shear`) and their scalar-axis
channels form one stream per axis. Within each source array, duplicate-time
keys first collapse to the last declaration. Merge the resulting arrays in
time order. If a pair key and an axis key have equal loaded times, the axis
key replaces the pair value and curve for that axis. Otherwise both remain
distinct keys. A paired key selects its `x` or `y` property curve before this
merge; the selected curve travels with that axis value.

Discrete channels select the last declared key with `key.time <= t`. Before
the first key they contribute nothing. Curves on discrete keys are ignored.
Discrete channels include slot attachment, active skin, bone inherit mode,
draw order, sequence mode/index, and boolean constraint fields.

Event keys are triggers rather than a sampled state value. They are never
collapsed: every key in an owned crossing interval is emitted, and equal-time
event keys retain the direction-specific declaration order from section 12.
Their curve field is ignored.

## 7. Curve evaluation

`p` is clamped to `[0,1]`.

### 7.1 Linear and stepped

```text
linear(from, to, p) = from + (to - from) * p

stepped(from, to, p):
    if p < 1: return from
    return to
```

Exact arrival at the next key is normally handled by key selection, so a
stepped segment holds the outgoing value on the open interval.

### 7.2 Cubic Bezier

For `{type:"bezier",cx1,cy1,cx2,cy2}`:

```text
B(u, c1, c2) =
    3*(1-u)^2*u*c1
  + 3*(1-u)*u^2*c2
  + u^3

x(u) = B(u, cx1, cx2)
y(u) = B(u, cy1, cy2)
```

All controls are finite; X controls are not restricted to `[0,1]`. First
classify X monotonicity. The reference converts the loaded binary32 `cx1` and
`cx2` to binary64 and evaluates the derivative quadratic:

```text
a = 1 + 3*cx1 - 3*cx2
b = 2*(cx2 - 2*cx1)
c = cx1

monotonicX(cx1, cx2):
    if c < 0 or 1-cx2 < 0: return false
    if a > 0:
        vertex = -b / (2*a)
        if 0 < vertex < 1 and a*vertex^2 + b*vertex + c < 0:
            return false
    return true
```

This is the exact minimum test for `x'(u)/3` on `[0,1]`; it does not sample a
few points and cannot miss a narrow decreasing interval.

For monotonic X, solve `x(u)=p` and evaluate Y. The v1 reference solve is:

```text
solveMonotonicX(p, cx1, cx2):
    low = 0
    high = 1
    u = p
    repeat 24 times:
        u = (low + high) * 0.5
        if B(u, cx1, cx2) < p:
            low = u
        else:
            high = u
    return u
```

A mathematically equivalent solver is conforming when its published result is
within the suite tolerance.

For non-monotonic X, Runtime API v1 deliberately uses this bounded,
first-segment fallback rather than choosing an unspecified cubic root:

```text
sampleSegmentedX(p, cx1, y1, cx2, y2, from, to):
    previousX = 0
    previousY = from
    for step = 1 through 9:
        u = step / 10
        currentX = B(u, cx1, cx2)
        currentY = cubic(from, y1, y2, to, u)
        if currentX >= p:
            if currentX == previousX: return currentY
            return previousY
                 + (p-previousX)/(currentX-previousX)
                 * (currentY-previousY)
        previousX = currentX
        previousY = currentY
    if 1 == previousX: return to
    return previousY + (p-previousX)/(1-previousX)*(to-previousY)
```

Only exact X equality makes a segment degenerate; there is no epsilon.
All curve forms return `from` exactly for `p <= 0` and `to` exactly for
`p >= 1`.

For percent Bezier, monotonic sampling returns
`from + (to-from)*B(u,cy1,cy2)`. The non-monotonic fallback uses
`y1=cy1`, `y2=cy2`, `from=0`, `to=1` to obtain that percentage before the
same interpolation. `cy1` and `cy2` may overshoot `[0,1]`; a channel retains
overshoot unless it has its own declared clamp.

#### 7.2.1 Value Bezier

For `{type:"bezier-value",cx1,dy1,cx2,dy2}`, Y is expressed in the value's
own units:

```text
y0 = from
y1 = from + dy1
y2 = to + dy2
y3 = to
```

Monotonic X uses `u=solveMonotonicX(...)` and returns
`cubic(y0,y1,y2,y3,u)`. Non-monotonic X uses `sampleSegmentedX` with these
same Y controls. This form can overshoot when `from == to` and therefore
cannot be replaced by a normalized percent easing curve.

#### 7.2.2 Property bundles

`{type:"properties",default?,properties}` is resolved before curve sampling:

```text
selectPropertyCurve(bundle, propertyName):
    if curve is not a property bundle: return curve
    if properties contains propertyName:
        return properties[propertyName]  // null means linear
    if default is present: return default
    return null                          // linear
```

Runtime names are exact canonical snake-case names from Runtime Model v1.
Bundles have at least one property and cannot nest. Unqueried but otherwise
valid vocabulary members are inert. Paired bone keys query `x`/`y`; slot
color, region, and constraint keys query the property listed by their runtime
field. Authoring tangent modes are not Runtime data.

### 7.3 Angular properties

Bone rotation, bone shear, and region rotation interpolate the shortest
signed key-to-key delta:

```text
angularInterpolate(from, to, q) =
    from + wrapDegrees(to - from) * q
```

An exact half-turn takes the `-180` direction. Cane Runtime JSON v1 has no
accumulated-turn channel, so a writer that needs more than one turn emits
intermediate keys.

### 7.4 Fixed-frame sampling

`sampling:{mode:"authored"}` uses the pose time directly.

For `sampling:{mode:"fixedFrame",frameStepSeconds:S}`, `S` is finite and
positive and each animation layer samples at:

```text
sampleTime = roundToNearestTiesPositive(poseTime / S) * S
```

Pose keys use `sampleTime`. Event crossings continue to use the unquantized
track interval; frame quantization must not create or discard events.

## 8. Track creation, replacement, and queues

Track indices are non-negative and are evaluated in ascending numeric order.
Runtime API 1.0 accepts indices `0..4095`.

### 8.1 Mix lookup

The initial default mix is zero. `setDefaultMix(M)` requires finite `M>=0`.
`setMix(fromId,toId,M)` installs an exact ordered-pair override. Reversing the
IDs is a different pair.

`setAnimation` uses its explicit `mixSeconds` when present. Otherwise it uses
the outgoing/incoming pair duration, falling back to the default. No outgoing
entry means a zero-duration mix.

### 8.2 Replacing an entry

Replacing an active entry is ordered as follows:

1. emit `interrupt` for the outgoing entry;
2. if `M==0`, emit `end` then `dispose` for it and every older
   `mixingFrom` entry; otherwise attach it as the new entry's `mixingFrom`;
3. emit `dispose`, but not `end`, for every never-started queued entry;
4. install the new entry at `trackTime=0`;
5. emit `start` for the new entry.

The comparison is exact `M==0`; a positive finite mix is not rounded to zero.
Replacing an entry clears that track's queue.

### 8.3 Queue delay

`queueAnimation(id,delaySeconds)` requires a finite delay. If the track is
empty, the animation starts immediately. Otherwise the queued entry's
activation threshold in the immediately preceding entry's raw track-time
domain is:

```text
if delaySeconds > 0:
    delay = delaySeconds
else:
    delay = max(
        0,
        previous.animationDuration - resolvedPairMix + delaySeconds
    )
```

Thus a positive delay is an absolute time from the preceding entry's start;
zero means “start the mix so it finishes at the preceding animation end”;
and a negative value moves that automatic transition earlier.

During a positive-time update, a queue promotion occurs when an entry with
positive `timeScale` reaches `delay`. If it was already at or beyond the
delay, `update(0)` promotes it immediately. A zero or negative time scale
does not newly cross a future queue delay, and reverse playback never
un-promotes an entry.

On promotion:

1. advance the outgoing entry exactly to the boundary and emit its crossed
   events;
2. emit outgoing `interrupt`;
3. attach it as `mixingFrom`, or emit `end`,`dispose` immediately when the
   resolved mix is zero;
4. emit incoming `start`;
5. carry the remaining wall-clock delta to the new current entry.

Multiple promotions in one large update repeat this procedure. If promotion
and a host-exposed track-end boundary are equal, promotion wins.

### 8.4 Track controls and publication

`setTrackTime(index,T)` requires finite `T>=0`, assigns the active entry's raw
track time, initializes its event cursor, and publishes the newly sampled
pose without emitting events for the skipped interval.

`setTrackOptions` changes only supplied fields on the active current entry.
`alpha`, `eventThreshold`, `attachmentThreshold`, and
`drawOrderThreshold` are in `[0,1]`; `timeScale` is any finite value;
`looping`, `blend`, and `holdPrevious` are closed enum/boolean values. It
publishes the resulting pose without advancing time.

`clearTrack` emits `end`,`dispose` for every started entry in the active
mixing chain and `dispose` only for queued, never-started entries, then
publishes the lower-track/setup result. `clearTracks` performs that operation
in ascending track order and publishes once after all tracks are clear.

The player operations `setAnimation`, `queueAnimation`, `clearTrack`,
`clearTracks`, `setTrackTime`, and `setTrackOptions` publish an evaluated
frame immediately after successful atomic configuration. `setDefaultMix` and
`setMix` only change future transition configuration and do not publish.
Lifecycle events produced by configuration enter the incremental drain queue.

`reset` is not a lifecycle transition: it atomically replaces the instance
with a fresh setup instance, clears all tracks, queues, mix configuration,
overrides, clocks, pending events, and solver history, and publishes setup
state without `end` or `dispose` events.

## 9. Cross-fade layer construction

For each track, recursively append the oldest `mixingFrom` entry first and
the current incoming entry last. Tracks themselves are appended from lowest
to highest index. This gives one total, deterministic layer order.

Layer construction carries an `ancestorChainFade`, initially `1`. This value
contains only whole-chain fades introduced by an empty incoming entry; it
never contains another entry's `alpha`.

For every real animation entry `E`:

```text
ownMixProgress =
    if E.mixingFrom exists:
        clamp(E.mixTime / E.mixDuration, 0, 1)
    else:
        1

E.layerAlpha = ancestorChainFade * E.alpha * ownMixProgress
```

Every entry owns its own alpha. An incoming entry's alpha MUST NOT replace,
multiply, or otherwise leak into a `mixingFrom` entry's alpha. Mix progress
advances by unscaled `deltaSeconds`, even when animation time scale is zero or
negative.

For a non-empty incoming animation, the outgoing layer is not globally
multiplied by `1-mixProgress`. Property conflict resolution below fades only
the properties that need to reveal setup or a lower track. Mixing to an
internal empty entry, if a language binding exposes one, instead passes

```text
childAncestorChainFade =
    ancestorChainFade * (1 - emptyEntry.ownMixProgress)
```

to the complete outgoing chain when `holdPrevious=false`. With
`holdPrevious=true`, it passes `ancestorChainFade` unchanged.

For example, in an interrupted non-empty chain `A -> B -> C`, the ordinary
layer alphas are `A.alpha`, `B.alpha * B.ownMixProgress`, and
`C.alpha * C.ownMixProgress`, before their respective per-property fades.
`A` receives B's property-mix decision and B receives C's; no ancestor entry
alpha is propagated. If C is empty and does not hold previous, the common
factor `(1-C.ownMixProgress)` additionally multiplies the complete A/B chain.

When progress reaches `1`, remove the outgoing chain and emit `end`,`dispose`
for each removed started entry exactly once, newest removed entry first.
If one update extends past the completion instant, advance and collect events
from the outgoing chain only through that wall-clock instant. Emit its
`end`,`dispose` there; the outgoing chain MUST NOT produce events during the
remaining delta after it has been removed.

### 9.1 Structural property ownership

Property identity is component-specific: bone X and Y, scale X and Y,
rotation, shear X and Y, inherit mode, each slot property, each attachment
property, and each typed constraint property are distinct. A channel owns a
property when it contains at least one key, even when the current sample time
is before that first key.

For an outgoing layer in a mix from `A` to `B`, let:

- `incomingOwns` mean B structurally owns the property;
- `lowerOwns` mean any complete layer chain on a lower-numbered track owns it;
- `baseAlpha` be that outgoing entry's
  `ancestorChainFade * entry.alpha * ownMixProgress`.

Unless `holdPrevious` is true:

```text
if incomingOwns and not lowerOwns:
    outgoingPropertyAlpha = baseAlpha
else:
    outgoingPropertyAlpha = baseAlpha * (1 - mixProgress)
```

Keeping the outgoing property at full alpha when the incoming animation keys
it is intentional: the later incoming replace layer interpolates from that
outgoing result. If the incoming animation does not key it, fading reveals
setup or a lower track. `holdPrevious=true` disables this per-property fade
until the outgoing entry is removed at mix completion.

## 10. Layer value composition

Every `apply()` begins from setup local pose and setup property values, then
applies the ordered layers.

All layer alphas and thresholds are in `[0,1]`. Let `current` be the value
left by setup and earlier layers, `setup` the immutable setup value,
`sampled` the current animation sample, and `A` the effective property alpha.
Only exact binary32 `A==0` means no contribution. A finite positive binary32
alpha, however small, MUST be evaluated by the formulas below; implementations
must not replace it with zero by an epsilon test. Mix durations and progress
use the same exact-zero rule wherever this document tests for zero.

### 10.1 Ordinary scalar values, including scale

```text
replace:  result = current + (sampled - current) * A
additive: result = current + (sampled - setup) * A
```

Scale is deliberately linear and setup-relative in additive mode. It is not
a multiplicative ratio.

### 10.2 Rotation and shear

```text
replace:
    result = current + wrapDegrees(sampled - current) * A

additive:
    result = current + wrapDegrees(sampled - setup) * A
```

This layer-composition wrapping is in addition to shortest-path key
interpolation.

### 10.3 Color and alpha

RGB channels are sampled in normalized `[0,1]` channel space. After each
color-layer composition, clamp to `[0,1]`, multiply by 255, round an exact
positive half upward, and store an integer byte. Alpha uses the ordinary
scalar rule and is clamped to `[0,1]`.

Absent dark color is distinct from black. During a color mix, an absent dark
endpoint participates as black only when at least one of setup, current, or
sampled dark color is present; if all are absent, the result remains absent.

### 10.4 Discrete values

A sampled discrete property applies when its effective property alpha is
`>=0.5`; below `0.5` the prior value remains. If multiple accepted layers
select a value, the later layer wins.

Skin, slot attachment, draw order, and sequence selection additionally obey
the outgoing-entry threshold flags:

```text
outgoing events apply       when crossingMixProgress < eventThreshold
outgoing attachments apply  while mixProgress < attachmentThreshold
outgoing draw order applies  while mixProgress < drawOrderThreshold
```

For each event, `crossingMixProgress` is the progress at that event's
wall-clock crossing, not the progress at the end of a large update. The
attachment and draw-order comparisons use the progress at `apply()`. The
threshold belongs to the outgoing entry. Default zero suppresses the
corresponding outgoing behavior as soon as a mix starts. Incoming
attachments/draw order become eligible at incoming effective alpha `>=0.5`.
Completion lifecycle events are not suppressed by `eventThreshold`.

More precisely, if an outgoing entry is controlled by an incoming mix whose
mix time at the start of an update is `m0`, whose duration is `M`, and whose
crossing occurs at `wallOffset` inside a positive update delta `d`, use
binary64 for this ordering calculation:

```text
crossingFraction    = wallOffset / d
crossingMixTime     = m0 + crossingFraction * d
crossingMixProgress =
    if M == 0: 1
    else: clamp(crossingMixTime / M, 0, 1)
```

The strict comparison is then
`crossingMixProgress < eventThreshold`. No epsilon is used.

## 11. `update`, `apply`, `advance`, and absolute sampling

### 11.1 `update(deltaSeconds)`

`update`:

1. validates the complete request before mutation;
2. advances clocks, mixes, and queues while assigning every generated event
   its wall-clock offset in the operation;
3. globally orders time-crossing events as specified in section 12.3;
4. appends returned incremental events to the drain queue;
5. does not evaluate a pose, solve constraints, publish a frame, or increment
   frame sequence.

A zero delta may still process an already-reached queue or end boundary.
The operation may produce at most 1,000,000 new lifecycle plus authored
events. Exceeding that bound fails atomically with `resourceLimit`.

### 11.2 `apply()`

`apply` does not advance any clock and emits no time-crossing event. It:

1. restores setup pose/properties;
2. constructs and applies all animation layers;
3. resolves animated skins and attachments;
4. applies host overrides;
5. computes unconstrained world matrices;
6. runs constraints in declaration order;
7. resolves geometry and draw order;
8. publishes one new immutable frame and increments frame sequence once.

Calling `apply()` repeatedly publishes equal values with newer frame
sequences and does not duplicate events.

### 11.3 `advance(deltaSeconds)`

`advance(d)` is observably:

```text
step = update(d)
apply()
return step with the newly published frame time and sequence
```

It returns the same events and leaves the same drain queue as the separate
calls.

### 11.4 Configuration baseline

Absolute sampling owns a configuration baseline separate from incremental
playback clocks. Track/mix configuration operations are applied atomically
to both the live state and the baseline, but the baseline is never advanced
by `update` or `advance`. Therefore a later configuration change does not
capture an already-advanced live clock. `setTrackTime` explicitly changes
the corresponding baseline time and initializes its event cursor.

### 11.5 `sampleAt` and `seek`

`seek` is an alias of `sampleAt` in Runtime API 1.0.

`sampleAt(T,F,sampling)` requires finite `T>=0`, finite `F>0`, at most
1,000,000 replay steps, and at most 1,000,000 emitted lifecycle plus authored
events across the complete replay:

```text
N = ceil(T / F)
if N > 1_000_000: fail atomically with resourceLimit

state = clone(configurationBaseline)
clear state replay notifications
reset all stateful constraint history
evaluate the baseline once

for i in 1..N:
    previous = (i-1) * F
    current  = min(i * F, T)
    update state by current - previous
    evaluate state using the requested authored/fixed-frame sampling

publish the final frame
return all replay events
```

The event limit is independent from the step limit. Exceeding either bound
leaves the live state, published frame, frame sequence, configuration
baseline, and incremental pending-event queue unchanged.

The products for `i*F` and subtraction are evaluated with sufficient
precision that the final step ends at `T`; each delta is then converted to
the runtime scalar precision.

Replay events are returned by the operation but are not inserted into or
removed from the incremental drain queue. Repeating an absolute sample from
the same baseline returns the same frame values and events regardless of
prior `advance` or `sampleAt` calls. The sampled state becomes the live state
for subsequent incremental playback; the configuration baseline remains
unchanged.

## 12. Events, loops, reverse playback, and large deltas

### 12.1 Interval ownership

For a forward raw-clock interval `previous < current`, authored events use:

```text
(previous, current]
```

For reverse playback, `current < previous`, they use:

```text
[current, previous)
```

This half-open ownership prevents an event at a step boundary from firing in
both adjacent updates. Events at the same timeline time use declaration
order forward and reverse declaration order backward.

When a newly started entry performs its first effective non-zero raw
traversal from track time zero, authored events at its current range start
are emitted once before later events. Runtime Format v1 uses range start
zero. These initialization events retain declaration order for both forward
and reverse playback; they are not reversed. They are independent from loop
boundary ownership. `deltaSeconds=0`, `timeScale=0`, and a non-looping reverse
attempt held at the lower clamp are not effective traversals. `setTrackTime`,
including setting zero, initializes the event cursor and does not
retroactively emit skipped or range-start events.

### 12.2 Loop boundaries

For `D>0`, split a looping interval at every integer multiple of `D`; do not
sample only the final remainder.

At a forward boundary, the exact order is:

1. authored events at animation time `D`, in declaration order;
2. one `complete` lifecycle event;
3. authored events at animation time `0` for the new cycle, in declaration
   order.

At a reverse boundary the order is exactly reversed:

1. time-zero authored events in reverse declaration order;
2. one `complete`;
3. time-`D` authored events in reverse declaration order.

Events strictly inside each traversed segment follow timeline order forward
or reverse timeline order backward. These rules also distinguish a key at
`D` from a key at `0`, even though they meet at the same loop boundary.
The direction-specific half-open interval still controls whether a boundary
is owned. In particular, moving from raw track time `0` to `-epsilon` does
not emit a boundary completion or boundary `D`/`0` events because zero is the
excluded previous endpoint; only the one-time new-entry initialization rule
above may emit time-zero keys. Continuing backward to raw time `-D` owns that
boundary and emits `0-key`, `complete`, then `D-key` as specified.

For a non-looping entry, completion is direction-terminal:

- forward traversal emits authored time-`D` events in declaration order and
  then `complete` when `previous<D && current>=D`;
- reverse traversal emits authored time-zero events in reverse declaration
  order and then `complete` when `previous>0 && current<=0`.

Crossing `D` while moving backward only re-enters the effective animation
range: an authored time-`D` key is emitted as an ordinary reverse crossing,
but no completion is emitted there. `setTrackTime(D)` has already initialized
the cursor and does not synthesize a time-`D` event. Holding either clamped
endpoint without a new terminal crossing emits nothing.

For `D==0`, pose time is zero, authored time-zero events are not repeated by
updates, and no completion is generated.

### 12.3 Ordering across tracks and mixes

Every lifecycle or authored event generated by one `update`, `advance`, or
absolute-replay substep receives a wall-clock offset from the beginning of
that operation or substep. Events are globally sorted by:

1. `wallOffset`, ascending;
2. `trackIndex`, ascending;
3. within one active mixing chain, older `mixingFrom` entries before their
   incoming entry;
4. the entry-local order defined by section 12.2 and declaration order.

At a queue boundary, the outgoing entry's crossings at that offset precede
its `interrupt`; an immediate zero mix then emits `end`,`dispose`; incoming
`start` follows, before overflow is applied to the incoming entry. These
lifecycle phases occupy the corresponding outgoing-to-incoming positions in
the tie-break above.

Wall offsets use this numeric rule. Runtime delta, time scale, raw start, and
raw crossing values are first interpreted as their loaded IEEE 754 binary32
values, then extended exactly to IEEE 754 binary64. For a non-zero raw
interval:

```text
rawDelta64   = rawEnd64 - rawStart64
fraction64   = (rawCrossing64 - rawStart64) / rawDelta64
wallOffset64 = segmentBaseOffset64 + fraction64 * segmentDelta64
```

Queue, track-end, and mix boundaries use the same binary64 domain, and
successive segment offsets accumulate in binary64. Final runtime state values
are converted to the runtime scalar representation. Compare finite
`wallOffset64` values exactly: `+0` and `-0` compare equal, and no epsilon is
used. Only exact equality proceeds to the later tie-breaks.

This total order includes lifecycle and authored events and must not depend
on hash iteration, worker completion order, or the order in which an
implementation happened to scan whole tracks.

### 12.4 Large deltas

A successful large update MUST be observably equivalent to splitting it at
every queue, loop, completion, and event boundary: it cannot skip intermediate
cycles, completions, authored events, or queue promotions. Partitioning an
interval into smaller updates produces the same ordered time-crossing events
and final animation state, excluding additional host-requested `apply`
publications.

The Runtime API v1 bound is exactly 1,000,000 new lifecycle plus authored
events for one `update` or `advance`, and exactly 1,000,000 across one
`sampleAt`/`seek` replay. The runtime MUST count the complete result before
mutation. If it exceeds the bound, return `resourceLimit` without changing
clocks, queues, mixes, solver state, published frame, frame sequence, or
pending events. It MUST NOT truncate events, cap loop counts, or partially
advance the player.

## 13. Conformance fixture mapping

The active suite is identified and hash-pinned by
`fixtures/runtime-conformance/v1/manifest.json`. These cases exercise the
algorithms in this document:

| Case | Core behavior exercised |
| --- | --- |
| `runtime-json-setup`, `caneb-setup` | full setup affine hierarchy; nested non-uniform scale; shear; negative scale; reflection; all five transform modes; equal JSON/CANEB setup output |
| `curve-linear` | linear continuous key sampling |
| `curve-stepped` | stepped hold |
| `curve-bezier` | monotonic-X cubic Bezier sampling |
| `inheritance-switch` | discrete animated transform-mode selection |
| `draw-order-tint-skin` | discrete layer threshold, color/alpha interpolation, attachment, skin, and draw-order selection |
| `loop-and-events` | looping pose time, authored events, lifecycle start/complete, absolute replay |
| `multi-track-mix-and-queue` | ordered tracks, pair mix, nested interrupted mix, positive queue delay/overflow, additive overlay, time scale, lifecycle/user event order |
| `update-without-apply` | clock/event advancement without frame publication |
| `update-then-apply`, `advance-equivalence` | publication boundary and combined-operation equivalence |
| `constraint-timelines`, `constraint-overrides` | core timeline sampling and layer values consumed by all constraint families |
| `runtime-json-weighted-deform`, `caneb-weighted-deform` | continuous vector sampling feeding weighted deformation |

The expected files contain the authoritative numeric and ordered-event
results. A case proves only the operation stream declared for that case;
suite capability claims use the complete required manifest, not a selected
subset.
