# Inspecting loaded data and external textures

`RuntimeData` is an immutable, copyable handle. Keep a copy when retaining an old
catalog across a player's project replacement or runtime-resource transaction:

```cpp
auto retained = player.data();
auto metadata = retained.query_metadata();
for (const auto& entry : retained.catalog(cane::RuntimeCatalogKind::audio)) {
    auto definition = retained.catalog_definition_json(
        cane::RuntimeCatalogKind::audio, entry.id);
    // Read the complete native audio declaration, including path and MIME type.
}
auto textures = retained.query_texture_resources();
```

`query_metadata()` returns owned format/API versions and generator name/version. These are the document's declarations; supported implementation versions remain
in `runtime_capabilities()`. Skeleton identity, reference scale, required features
and ordered load warnings have their existing data queries. A warning exposes its
stable code, operation and section tag, plus the diagnostic `message()`.

`catalog(kind)` lists all eleven catalog families in declaration order. Its
references live as long as the retained data handle. `catalog_definition_json`
returns an owned serialization of a complete catalog entry, including optional
fields, nested animation/constraint data, audio/font paths and exact 64-bit
integers. It does not insert defaults or decoded image sizes into authored
metadata. Invalid kinds or IDs produce structured errors under
`getCatalogDefinition`; an absent valid ID returns `not_found`.

`query_texture_resources()` returns owned descriptors for every direct image in
image-catalog order, followed by every Atlas page in Atlas/page declaration order. Pages and images unused by the current pose are included. Atlas regions do not
become extra decoded resources. Each descriptor identifies its resource kind,
stable IDs, path and actual resolved width/height, color/alpha convention, pixel
format, min/mag filter and U/V wrap modes. Atlas descriptors also retain the Atlas
reference path; the host resolves a page beside the actual supplied Atlas file.

Direct descriptors use the Format v1 defaults: RGBA8, sRGB, straight alpha,
linear filters and clamp wrapping. Missing authored direct dimensions can still
be absent in the full declaration while the completed texture descriptor contains
dimensions obtained through the [load plan](LOADING.md). These queries perform no
texture decoding, frame publication, animation sampling or constraint solving.

Player `data()` queries describe its effective resource catalog. `source_data()`
describes the loaded source without instance overlays. Retained handles and owned
query results survive later replace/clear/failure operations unchanged. Texture
objects and their acquire/release lifecycle remain host responsibilities.
