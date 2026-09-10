using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    /// <summary>Built-in pipeline camera pass. SRP hosts use CaneSkeleton.Record in their own selected render pass.</summary>
    [ExecuteAlways, DisallowMultipleComponent, RequireComponent(typeof(Camera))]
    public sealed class CaneCameraRenderer : MonoBehaviour
    {
        private Camera target;
        private CommandBuffer commands;
        private readonly CaneSceneRenderer recorder = new CaneSceneRenderer();
        private const CameraEvent Pass = CameraEvent.AfterForwardAlpha;

        private void OnEnable()
        {
            if (GraphicsSettings.currentRenderPipeline != null)
                throw UnityObjects.Error("cameraRenderer", "This camera component requires Unity's Built-in pipeline. An SRP must explicitly record Cane packets in its render pass.");
            if (QualitySettings.activeColorSpace != ColorSpace.Linear)
                throw UnityObjects.Error("cameraRenderer", "Set Player Settings / Color Space to Linear for the Cane color contract.");
            target = GetComponent<Camera>();
            commands = new CommandBuffer { name = "Cane ordered final packets" };
            target.AddCommandBuffer(Pass, commands);
        }

        private void OnPreCull()
        {
            if (commands == null) return;
            commands.Clear(); recorder.Record(commands, target);
        }
        private void OnDisable()
        {
            if (target && commands != null) target.RemoveCommandBuffer(Pass, commands);
            commands?.Dispose(); commands = null;
        }
    }
}
