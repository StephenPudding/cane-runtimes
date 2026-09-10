# Preparing and completing external resource loading

`RuntimeData::from_json` / `from_caneb` remain available when image dimensions are
declared or the host already has a complete decoded-size catalog. For asynchronous
or engine-owned decoding, use a load plan:

```cpp
#include <cane/runtime_load_plan.hpp>

auto plan = cane::RuntimeLoadPlan::from_json(runtime_json, options);
std::vector<cane::DecodedTextureDimensions> observed;
for (const auto& request : plan.texture_requests()) {
    // Decode request.path in the host. Direct paths are relative to the Runtime
    // file; Atlas page paths are relative to the supplied Atlas file.
    // Retain the engine texture outside Core and append its real width/height.
}
auto data = plan.create_data(observed);
```

Preparation owns its input and validates transport, versions, features and
resources without creating a player or performing I/O. Requests contain direct
images in image catalog order, then every Atlas page in Atlas/page declaration
order, including resources unused by the current pose. Direct request dimensions
remain optional when omitted from the file; Core never substitutes guessed sizes. Atlas page dimensions and all color, alpha, filter and wrap declarations are known.

`create_data` accepts a complete catalog of actual decoded dimensions. It completes
the full Runtime Model, Atlas, source-image and resource validation before returning
`RuntimeData`. Missing, duplicate, undeclared, zero or contradictory observations
fail. Declared dimensions must match, and any observations supplied in the original
load options must also agree. Completion reports errors under `completeLoad` and
does not rewrite the source's optional width/height fields.

A plan is an owned immutable preparation object, not playable data. It can be
completed more than once or retried after failure. Each completion has independent
Runtime data; mutable clocks, Physics and frames still belong to subsequently
created players. Existing data and players are unaffected by later observations. CANEB optional-section warnings remain ordered metadata in both the plan and the
completed data.

Hosts stage decoded resources until completion succeeds, then publish the new
asset. On failure they release only the staged engine resources and keep the
previous asset. The Godot adapter follows this path for JSON and CANEB, including
direct images with either or both dimensions omitted. The load-plan helpers add no
rendering, constraint or geometry evaluation to the adapter.
