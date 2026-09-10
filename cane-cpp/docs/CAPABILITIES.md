# Core capabilities and default loading

```cpp
#include <cane/runtime_capabilities.hpp>
#include <cane/runtime_data.hpp>

auto info = cane::runtime_capabilities();
bool accepts_api = info.runtime_api.contains(1, 3);
bool accepts_deform = cane::supports_runtime_feature("mesh.deform");

cane::RuntimeLoadOptions options;
options.atlas_json.emplace("atlas-hero", atlas_json_utf8);
auto data = cane::RuntimeData::from_json(runtime_json_utf8, options);
```

The capability value owns the implementation name/version, inclusive version
ranges, numeric precision, sorted unique Runtime feature names, API feature bits
and the last passed Core conformance suite version/digest/count. Mutating a copy
does not change later queries or validation. No file or engine access is needed.

Runtime JSON, CANEB and Atlas support version 1.0. Runtime API supports 1.0
through 1.3. The 22 Runtime document feature names are the same list used by the
loader. API feature bits 0 through 41 describe the separate Runtime API contract;
bits above 41 are zero. Numeric geometry and sampled channels use binary32;
exact event integers and clock arithmetic retain their separately specified types.

Known features load by default. The former `allow_unverified_features` flag is
retained for source compatibility and has no effect: both values reject unknown
required features, invalid feature declarations, unsupported versions and invalid
resources. Instance resource overlays use the same validation and update only
their effective feature catalog. Atlas documents and complete decoded texture
observations are still required where the resource contract calls for them.

The reported Suite 1.8.0 manifest identifies all 95 complete locked Core outcomes
passed twice from fresh state in each of two candidate processes.
