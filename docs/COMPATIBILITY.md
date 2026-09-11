# Compatibility and version policy

This repository currently contains source candidates, not published npm
artifacts. Package version, Runtime API version, Runtime Format version, and
conformance suite version are independent compatibility domains.

## Current matrix

| Component | Current compatibility | Status |
| --- | --- | --- |
| `@cane-runtime/core` | ESM, ES2022, TypeScript declarations; Runtime JSON/CANEB/Atlas 1.0; Runtime API 1.0–1.3 | Suite 1.8.0, 95 required cases |
| `@cane-runtime/pixi-v8` | PixiJS 8.18.1 peer; browser ESM plus optional Core-inclusive IIFE | WebGL and WebGPU visually exercised; Canvas2D is an explicit downgrade |
| `@cane-runtime/layaair-3.4.1` | Exact LayaAir 3.4.1 peer; prebuilt ESM/IIFE/declarations and IDE resource package | JSON/CANEB import, serialized scene component and preview; WebGL/WebGPU game builds; native/NoRender rejected explicitly |
| `@cane-runtime/cocos-3.8.8` | Exact Cocos Creator 3.8.8 virtual `cc` module; ESM and declarations; no bundled engine | Creator WebGL/WebGPU plus Windows Native RenderEntity route |
| C# Core | `netstandard2.1`, Runtime JSON/CANEB/Atlas 1.0 and Runtime API 1.3 | Engine-neutral owned data, players and final packets |
| Unity | Unity 6000.3.23f1 and 6000.6.0f1 on Windows; Built-in, URP/HDRP integrations | Linear project color space; see the engine integration guide for tested pipeline versions and pass setup |
| C++ Core | C++17, Runtime JSON/CANEB/Atlas 1.0 and Runtime API 1.3 | Native engine-neutral Core |
| Godot | Ordinary Godot 4.7.2, Windows x64; Compatibility and Forward+; compiled against the 4.5 native ABI | Requires HDR 2D; does not require .NET. The ABI minimum does not certify older renderers |

The Pixi peer is intentionally exact while the adapter is pre-1.0. A wider
Pixi range requires its own WebGL, WebGPU, Canvas, lifecycle, and integration
test run. JavaScript engines that reuse `@cane-runtime/core` share the same
CPU animation/constraint/geometry result; renderer pixels may still vary with
backend sampling, color management, and shader precision.

The Pixi package provides two distribution shapes with identical Runtime
semantics:

- ESM modules for npm-aware bundlers, with `pixi.js` as a peer and Core as a
  package dependency;
- `dist/iife/cane-pixi-v8.min.js` for classic browser scripts, with Core
  embedded and `globalThis.PIXI` external. It exports
  `globalThis.CanePixi`, exposes the Core API as `CanePixi.Core`, and requires
  PixiJS to be loaded first.

The LayaAir package uses the same two shapes: ESM with `layaair` declared as
the exact `3.4.1` peer, and `dist/iife/cane-layaair-3.4.1.min.js` with Core
embedded and `globalThis.Laya` external. The public npm package named
`layaair` does not currently distribute 3.4.1, so development and consumers
must supply the exact official SDK/IDE engine rather than relaxing the peer.

## PixiJS renderer capability matrix

| Capability | WebGL | WebGPU | Canvas2D |
| --- | :---: | :---: | :---: |
| Region/Mesh final geometry and UV | Yes | Yes | Yes |
| Core CPU clipping and Slot-object masks | Yes | Yes | Yes |
| Full affine, shear, reflection, negative scale | Yes | Yes | Yes |
| Alpha and supported blend mapping | Yes | Yes | Yes |
| Exact light RGB tint | Yes | Yes | No |
| Two-color tint | Yes | Yes | No |
| Linear-light shader color path | Yes | Yes | No |
| Custom Cane batching shader | Yes | Yes | No |

Canvas2D uses Pixi's official Canvas renderer extension and draws Core-authored
triangles. It is not advertised as shader-equivalent: it preserves geometry,
UV, alpha, clipping, affine projection, and Canvas-supported blend modes, but
does not silently approximate Cane light/dark or linear-light shader math.

## LayaAir 3.4.1 renderer capability matrix

| Capability | WebGL | WebGPU | native / NoRender |
| --- | :---: | :---: | :---: |
| Region, Mesh, Weighted Mesh, Deform, Linked Mesh, Sequence | Yes | Yes | Rejected |
| Core clipping and clipping-aware Slot objects | Yes | Yes | Rejected |
| Full affine, shear, reflection and negative scale | Yes | Yes | Rejected |
| Light/dark tint, alpha, straight/PMA and sRGB/linear metadata | Yes | Yes | Rejected |
| Normal, additive, multiply and screen | Yes | Yes | Rejected |
| Retained `Mesh2D` uploads and explicit batch-split statistics | Yes | Yes | Rejected |
| Automatic/manual/multi-instance scheduling | Yes | Yes | Not renderer-dependent |

Both exact 3.4.1 web drivers are exercised with official release artifacts. The adapter uses the
same `Shader3D`, `Mesh2D`, material and final-frame projection for both, leaving GLSL translation
and GPU resource creation to LayaAir's driver factories, as its official Spine web renderer does. There is no advertised Canvas2D path in this package. LayaAir 3.4.1 also does not recreate every
engine-owned WebGL resource or a lost WebGPU device in place; Cane suspends projection and reports
`contextRestoreFailed` until the host recreates the engine/runtime realm. This limitation does not
cause another Core sample or solve.

## Cocos Creator 3.8.8 renderer capability matrix

| Capability | WebGL | WebGPU | Windows Native |
| --- | :---: | :---: | :---: |
| Region, Mesh, Weighted Mesh, Deform, Linked Mesh, Sequence | Yes | Yes | Yes |
| Core clipping and draw-order Slot objects | Yes | Yes | Yes |
| Full affine, shear, reflection and negative scale | Yes | Yes | Yes |
| Light/dark tint, alpha, straight/PMA and sRGB/linear metadata | Yes | Yes | Yes |
| Normal, additive, multiply and screen | Yes | Yes | Yes |
| Unified automatic/manual/multi-instance scheduling | Yes | Yes | Yes |
| Retained uploads and explicit split/reallocation statistics | Yes | Yes | Yes |

All three routes consume the same Core `RuntimeRenderPacketV1`. WebGL and WebGPU use the Cocos 2D
assembler/RenderEntity flow; Native uses exact-3.8.8 dynamic middleware/SUB_NODE draw infos and no
Spine middleware. WebGL texture restoration is supported. Creator 3.8.8 does not provide complete
in-place WebGPU device recreation, so device loss suspends the component and reports `contextLost`
until the host recreates the renderer/runtime realm.

## SemVer policy

- Package `0.y.z` is pre-release API: a minor increment may contain breaking
  package/API changes, while a patch increment remains backward-compatible.
- Starting at package `1.0.0`, removals or incompatible type/behavior changes
  require a package major; additive API is a minor; fixes are patches.
- Runtime API 1.x evolves additively by minor plus capability bits. A host must
  discover the advertised range and required bits instead of inferring it from
  the npm package version.
- Runtime Format/CANEB/Atlas versions do not change when API-only facilities
  such as dynamic resources, Bounds, host motion, or geometry modifiers are
  added.
- Conformance status applies only to the exact suite version and manifest
  digest reported by `runtimeCapabilitiesV1()`.

TypeScript packages are marked `private: true` and `UNLICENSED`; the public
repository does not imply publication to an npm, NuGet or engine registry.
Source builds and local engine-package installation are described in
[building from source](BUILDING.md).
