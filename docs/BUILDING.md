# Building the Runtime source

Run commands from the repository root and choose a separate build directory.
Development tests, benchmarks, examples and verification tools are not required
by these source builds. Engine versions are pinned because the adapters use their
exact APIs. See each engine's integration guide for host setup.

## TypeScript

Use Node.js 20+ and pnpm. Install the official SDKs needed by the selected adapters:

- LayaAir 3.4.1 source at commit `f368b43098fe6bde7b961546114e71907c5f8a98`
  and its official 3.4.1 release libraries, including `types/LayaAir.d.ts`.
- Cocos engine 3.8.8 at commit `411f98df047c25902f93440d4b22925c2fb65461`.
  The matching Creator declaration package is installed by pnpm.
- PixiJS 8.18.1 is the adapter's peer and build dependency.

```powershell
$env:CANE_LAYAAIR_341_ROOT = 'E:/sdk/LayaAir-v3.4.1'
$env:CANE_LAYAAIR_341_RELEASE_ROOT = 'E:/sdk/LayaAir_3.4.1_release_libs'
$env:CANE_COCOS_388_ENGINE_ROOT = 'E:/sdk/cocos-engine-v3.8.8'
pnpm --dir cane-ts install --frozen-lockfile
pnpm --dir cane-ts build
```

The two SDK preparation helpers check the declared engine identity; the LayaAir
helper also stages the matching declaration file. Outputs are under each package's
`dist/`. To build Core alone after dependency installation, run
`pnpm --dir cane-ts --filter @cane-runtime/core build`. PixiJS can be built without
LayaAir/Cocos SDKs using `pnpm --dir cane-ts --filter @cane-runtime/pixi-v8... build`.

## C# Core

Use the .NET SDK selected by `cane-csharp/global.json`. Core targets `netstandard2.1`.

```powershell
dotnet build cane-csharp/cane-core/Cane.Core.csproj -c Release -p:CaneBuildRoot=E:/cane-build/csharp
dotnet pack cane-csharp/cane-core/Cane.Core.csproj -c Release -p:CaneBuildRoot=E:/cane-build/csharp -o E:/cane-build/packages
```

## Unity

Install Core and then Unity as local UPM packages using their `package.json` files;
see [Unity installation](../cane-csharp/cane-unity/docs/INSTALLATION.md).
Unity compiles their source. To compile the Built-in adapter directly against an
installed Editor's managed assemblies:

```powershell
dotnet build cane-csharp/cane-unity/Cane.Unity.csproj -c Release -p:CaneBuildRoot=E:/cane-build/unity -p:UnityEditorRoot=E:/Unity/6000.3.23f1/Editor
```

For Unity 6000.4 or later, also pass `-p:CaneUnityEntityIds=true` to that standalone
managed build. Unity itself supplies the corresponding version define.
URP and HDRP source assemblies are enabled by their matching Unity packages.

## C++ Core

Use CMake 3.24+ and a C++17 compiler. The bundled JSON parser and MIT notice are
under `cane-cpp/third_party/nlohmann`.

```powershell
cmake -S cane-cpp -B E:/cane-build/cpp -DBUILD_TESTING=OFF
cmake --build E:/cane-build/cpp --config Release
```

Link `Cane::Core` when adding the Core with CMake. No engine or managed runtime is
required. The public checkout also configures with tests disabled by default.

## Godot

The extension targets Godot 4.5's native ABI and the Windows x64 platform.
Use the official `godot-cpp` checkout at
`e83fd0904c13356ed1d4c3d09f8bb9132bdc6b77` and a Python interpreter for binding generation:

```powershell
cmake -S cane-cpp/cane-godot -B E:/cane-build/godot -DCANE_GODOT_CPP=E:/sdk/godot-cpp-4.5 -DPython3_EXECUTABLE=E:/Python/python.exe
cmake --build E:/cane-build/godot --config Release --target cane-godot
```

Follow [Godot installation](../cane-cpp/cane-godot/docs/INSTALLATION.md) to place the
DLL and extension descriptor into a project. The native extension includes Core;
no C# project or Mono installation is needed.
