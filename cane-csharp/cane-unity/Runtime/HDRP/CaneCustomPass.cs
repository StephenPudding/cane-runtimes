using System;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Cane.Unity.HDRP
{
    /// <summary>Draws final packets in an HDRP Custom Pass Volume at the host's injection point.</summary>
    [Serializable]
    public sealed class CaneCustomPass : CustomPass
    {
        public bool RenderSceneView = true;
        public bool RenderPreview;
        [NonSerialized] private CaneSceneRenderer recorder;
        public ulong CameraPasses { get; private set; }
        public int LastSkeletonCount => recorder?.LastSkeletonCount ?? 0;
        protected override bool executeInSceneView => RenderSceneView;
        public CaneCustomPass()
        {
            name = "Cane final packets";
            targetColorBuffer = TargetBuffer.Camera;
            targetDepthBuffer = TargetBuffer.Camera;
        }
        protected override void Execute(CustomPassContext context)
        {
            Camera camera = context.hdCamera.camera;
            if (!RenderPreview && camera.cameraType == CameraType.Preview) return;
            if (recorder == null) recorder = new CaneSceneRenderer();
            recorder.Record(context.cmd, camera); ++CameraPasses;
        }
    }
}
