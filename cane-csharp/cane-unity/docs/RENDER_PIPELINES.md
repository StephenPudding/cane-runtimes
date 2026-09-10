# Unity render pipelines

All three integrations use `CaneSceneRenderer` for camera filtering and skeleton
sorting and consume the same final Core packet. Cameras do not advance animation. Disabling a skeleton releases its meshes; the first visible draw after re-enable
may restore that GPU projection once while retaining the exact Core publication.

Use **Linear** project color space. The pass orders Cane skeletons by sorting
layer, sorting order and stable Unity object identity, preserving Core Slot and
attachment order. Ordinary engine transparencies precede the default Cane pass;
insert interleaved external renderers through `CaneSlot`. These integrations do
not provide general per-object interleaving with every engine transparent object.

## Built-in pipeline

Add `CaneCameraRenderer` to each participating camera. It owns one command buffer
after `CameraEvent.AfterForwardAlpha`. It rejects use with an active SRP.

## URP 17.3–17.x

Add **Cane Renderer Feature** to the camera's renderer asset. Its default injection
point is **After Rendering Transparents**. Add it once per renderer. The feature
records a native raster Render Graph pass with explicit color/depth attachments;
it does not escape the graph through an unsafe command buffer. The optional
`Cane.Unity.URP` assembly activates only when the URP package is installed.

Unity 6000.3 also has a compatibility-mode `Execute` branch. Newer Unity versions
compile only the Render Graph branch because their URP removes that compatibility
API. `RenderSceneView` defaults to true; preview cameras are excluded by default. `GraphPasses`, `CompatibilityPasses` and `LastSkeletonCount` expose draw diagnostics.

## HDRP 17.3–17.x

Create a global **Custom Pass Volume**, choose **Before Post Process**, and add
**Cane Custom Pass**. Leave both target buffers set to **Camera**, and enable
Custom Passes in HDRP asset/camera frame settings. Add one pass per participating
camera's volume set. The optional `Cane.Unity.HDRP` assembly activates only when
HDRP is installed; it adds no HDRP dependency to the Core or base adapter.

The HDRP color buffer must include alpha when transparent output is required:
select **R16G16B16A16**. Exposure, post-processing and camera target formats are
host settings and can change final presentation. The shader is unlit. `CameraPasses` and `LastSkeletonCount` expose draw diagnostics.

## Host-selected passes

`CaneSceneRenderer.Record(CommandBuffer, Camera)` draws the filtered, ordered
scene. `Record<TCommands>` accepts a struct implementing `ICaneDrawCommands` for
restricted engine command APIs, including URP's `RasterCommandBuffer`, without
boxing that command wrapper. Hosts select the target and camera matrices before
calling it. `CaneSkeleton.Record` still supports explicitly ordered individual
skeletons. These APIs record draws; they do not own a command buffer or schedule
an engine frame.
