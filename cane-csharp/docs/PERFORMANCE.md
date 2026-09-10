# C# Core performance and ownership

The current C# player publishes independently owned frames. Retaining a frame or a
constraint query cannot expose later updates, and a failed evaluation leaves the
published frame, animation clocks, pending events and Physics history unchanged. This implementation does not yet provide an ephemeral, reusable-frame mode.

Runtime data is shared across players. Skin attachment mappings, skin membership,
Region setup transforms and bone timeline property identities are compiled during
loading. Each skin mapping is visited once per resolution, in authored order;
default-skin fallback and named/null mappings keep their original precedence.

Atlas source rectangles and binary64 UV corner values are decoded once per image. Mesh weights compile to contiguous influence arrays with resolved bone indices
and bind coordinates, including linked-mesh geometry owners. Zero-weight entries
retain their deform offsets. UV projection keeps the original binary64 expression
order before rounding to binary32; this is not a reduced-precision projection.

Each player keeps two private pose workspaces. Evaluation resets the workspace
that is not currently published, so queries in callbacks continue to observe the
last successful pose even during absolute replay or a failed evaluation. Writable
constraint parameters and IK targets belong to the workspace; immutable bone
lists and mapping rules remain shared. Slider sampling keeps its own snapshot of
the writable state.

Each private pose also caches local axes and reconstructed world transforms. Cache keys compare all local components, inheritance mode and parent coefficients,
including signed zero. Every full hierarchy update still visits bones in order
and assigns the reconstructed matrix, even on a hit: preceding constraints may
have directly changed a world matrix that must be restored. A parent change can
reuse unchanged local axes without another trigonometric calculation. The cache
does not remove solver steps, change propagation rules or expose mutable results.

Rendering reuses player-local geometry scratch. Published vertices, UVs, indices
and facing arrays are immutable: unchanged channels may share an older immutable
view, and changed channels receive newly owned storage. Float equality is bitwise,
including signed zero. Mutable scratch never escapes through a frame or query. Resource/project replacement binds pose workspaces to the replacement RuntimeData
identity, and rendering scratch releases its references to preceding packets. These changes preserve sampling, solvers and the final packet contract; they do
not skip animation updates or interpolate substitute frames.
