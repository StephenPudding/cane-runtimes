using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

namespace Cane.Unity.URP
{
    /// <summary>Ordered final packets in URP's native raster render graph.</summary>
    [DisallowMultipleRendererFeature]
    public sealed class CaneRendererFeature : ScriptableRendererFeature
    {
        public RenderPassEvent InjectionPoint = RenderPassEvent.AfterRenderingTransparents;
        public bool RenderSceneView = true;
        public bool RenderPreview;
        private PacketPass pass;
        public ulong GraphPasses => pass?.GraphPasses ?? 0;
        public ulong CompatibilityPasses => pass?.CompatibilityPasses ?? 0;
        public int LastSkeletonCount => pass?.Recorder.LastSkeletonCount ?? 0;

        public override void Create() => pass = new PacketPass();
        public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data)
        {
            var type = data.cameraData.cameraType;
            if ((!RenderSceneView && type == CameraType.SceneView) || (!RenderPreview && type == CameraType.Preview)) return;
            if (pass == null) Create();
            pass.renderPassEvent = InjectionPoint; renderer.EnqueuePass(pass);
        }

        private sealed class PacketPass : ScriptableRenderPass
        {
            internal readonly CaneSceneRenderer Recorder = new CaneSceneRenderer();
            internal ulong GraphPasses, CompatibilityPasses;
            private sealed class PassData { internal PacketPass Pass; internal Camera Camera; }
            public override void RecordRenderGraph(RenderGraph graph, ContextContainer frameData)
            {
                var resources = frameData.Get<UniversalResourceData>();
                using (var builder = graph.AddRasterRenderPass<PassData>("Cane final packets", out var data))
                {
                    data.Pass = this; data.Camera = frameData.Get<UniversalCameraData>().camera;
                    builder.SetRenderAttachment(resources.activeColorTexture, 0, AccessFlags.ReadWrite);
                    if (resources.activeDepthTexture.IsValid()) builder.SetRenderAttachmentDepth(resources.activeDepthTexture, AccessFlags.Read);
                    builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (PassData value, RasterGraphContext context) =>
                    {
                        value.Pass.Recorder.Record(new RasterDrawCommands(context.cmd), value.Camera);
                        ++value.Pass.GraphPasses;
                    });
                }
            }

#if !UNITY_6000_4_OR_NEWER
            [Obsolete("Used only by URP 17.3 compatibility mode.")]
            public override void Execute(ScriptableRenderContext context, ref RenderingData data)
            {
                CommandBuffer commands = CommandBufferPool.Get("Cane final packets");
                try { Recorder.Record(commands, data.cameraData.camera); context.ExecuteCommandBuffer(commands); ++CompatibilityPasses; }
                finally { CommandBufferPool.Release(commands); }
            }
#endif
        }

        private readonly struct RasterDrawCommands : ICaneDrawCommands
        {
            private readonly RasterCommandBuffer commands;
            internal RasterDrawCommands(RasterCommandBuffer commands) { this.commands = commands; }
            public void DrawMesh(Mesh mesh, Matrix4x4 matrix, Material material, int submesh, int pass, MaterialPropertyBlock properties)
                => commands.DrawMesh(mesh, matrix, material, submesh, pass, properties);
            public void DrawRenderer(Renderer renderer, Material material, int submesh, int pass)
                => commands.DrawRenderer(renderer, material, submesh, pass);
        }
    }
}
