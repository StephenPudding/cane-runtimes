using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    /// <summary>Owned GPU upload cache over final Core packets. It never evaluates a player.</summary>
    public sealed class CaneMeshProjection : IDisposable
    {
        private sealed class Draw : IDisposable
        {
            internal readonly Mesh Mesh = UnityObjects.Own(new Mesh { name = "Cane final geometry", hideFlags = HideFlags.HideAndDontSave });
            internal readonly MaterialPropertyBlock Properties = new MaterialPropertyBlock();
            internal readonly List<Vector3> Vertices = new List<Vector3>();
            internal readonly List<Vector2> Uvs = new List<Vector2>();
            internal readonly List<int> Indices = new List<int>();
            internal readonly List<ushort> ShortIndices = new List<ushort>();
            internal readonly List<int> IndexStarts = new List<int>();
            internal readonly List<SubMeshDescriptor> Submeshes = new List<SubMeshDescriptor>();
            internal CaneAsset.TextureEntry Resource;
            internal FinalTint Tint;
            internal int Mode, FirstAttachment, AttachmentCount, IndexCount;
            internal Draw() { Mesh.MarkDynamic(); }
            internal void Clear()
            {
                Vertices.Clear(); Uvs.Clear(); Indices.Clear(); ShortIndices.Clear(); IndexStarts.Clear(); Submeshes.Clear();
                Properties.Clear(); Resource = null; AttachmentCount = IndexCount = 0;
            }
            internal void Upload()
            {
                IndexCount = Indices.Count;
                // A full-batch range and individual attachment ranges use disjoint index
                // storage. Unity requires submesh index ranges not to overlap. Vertices
                // and UVs are shared, and their values and triangle order stay unchanged.
                Submeshes.Add(new SubMeshDescriptor(0, IndexCount));
                if (AttachmentCount > 1)
                {
                    for (int i = 0; i < IndexCount; i++) Indices.Add(Indices[i]);
                    for (int i = 0; i < AttachmentCount; i++)
                        Submeshes.Add(new SubMeshDescriptor(IndexCount + IndexStarts[i], IndexStarts[i + 1] - IndexStarts[i]));
                }
                Mesh.Clear(false);
                Mesh.SetVertices(Vertices); Mesh.SetUVs(0, Uvs);
                bool wide = Vertices.Count > 65535;
                Mesh.SetIndexBufferParams(Indices.Count, wide ? IndexFormat.UInt32 : IndexFormat.UInt16);
                if (wide) Mesh.SetIndexBufferData(Indices, 0, 0, Indices.Count);
                else
                {
                    foreach (int index in Indices) ShortIndices.Add(checked((ushort)index));
                    Mesh.SetIndexBufferData(ShortIndices, 0, 0, ShortIndices.Count);
                }
                Mesh.SetSubMeshes(Submeshes); Mesh.RecalculateBounds();
            }
            public void Dispose() { Clear(); UnityObjects.Release(Mesh); }
        }

        private readonly List<Draw> draws = new List<Draw>();
        private readonly List<int> attachmentDraws = new List<int>();
        private readonly Material[] materials = new Material[4];
        private RuntimeFrame uploaded;
        private CaneAsset uploadedAsset;
        private int count;
        private bool disposed;
        public ulong PacketUploads { get; private set; }
        /// <summary>Nonempty GPU batches when the complete packet is recorded without Slot insertions.</summary>
        public int DrawCount { get; private set; }
        /// <summary>Number of final Core attachments; RecordRange uses these indices.</summary>
        public int AttachmentCount => attachmentDraws.Count;
        public int VertexCount { get; private set; }
        public int TriangleCount { get; private set; }
        private static readonly int TextureId = Shader.PropertyToID("_CaneTexture"), SizeId = Shader.PropertyToID("_CaneSize"),
            LightId = Shader.PropertyToID("_CaneLight"), DarkId = Shader.PropertyToID("_CaneDark"),
            SamplingId = Shader.PropertyToID("_CaneSampling"), TextureFlagsId = Shader.PropertyToID("_CaneTextureFlags");

        public CaneMeshProjection(Shader shader = null) : this(shader, null) { }
        public CaneMeshProjection(Shader shader, IReadOnlyList<Material> templates)
        {
            if (templates != null && templates.Count != 4) throw new ArgumentException("Cane requires four blend materials.", nameof(templates));
            if (templates != null && templates[0]) shader = templates[0].shader;
            if (!shader) shader = Resources.Load<Shader>("CaneFinalPacket");
            if (!shader || !shader.isSupported) throw UnityObjects.Error("createProjection", "The Cane final-packet shader is missing or unsupported.");
            try
            {
                for (int i = 0; i < materials.Length; i++)
                {
                    if (templates != null && (!templates[i] || !templates[i].shader || !templates[i].shader.isSupported))
                        throw UnityObjects.Error("createProjection", "An imported Cane blend material is missing or unsupported.");
                    var material = UnityObjects.Own(templates == null ? new Material(shader) : new Material(templates[i]));
                    material.name = "Cane blend " + i; material.hideFlags = HideFlags.HideAndDontSave;
                    materials[i] = material;
                    material.SetInt("_CaneSrcRgb", (int)(i == 2 ? BlendMode.DstColor : BlendMode.One));
                    material.SetInt("_CaneDstRgb", (int)(i == 1 ? BlendMode.One : i == 3 ? BlendMode.OneMinusSrcColor : BlendMode.OneMinusSrcAlpha));
                    material.SetInt("_CaneDstAlpha", (int)(i == 1 ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
                }
            }
            catch { Dispose(); throw; }
        }

        internal void InheritUploadCount(CaneMeshProjection previous)
        { if (previous != null) PacketUploads += previous.PacketUploads; }

        private static int Mode(string value) => value == "normal" ? 0 : value == "add" ? 1 : value == "multiply" ? 2 : value == "screen" ? 3
            : throw UnityObjects.Error("projectPacket", "Unknown blend mode.", "blendMode", value);
        private static int Wrap(string value) => value == "clamp" ? 0 : value == "repeat" ? 1 : value == "mirror" ? 2
            : throw UnityObjects.Error("projectPacket", "Unknown texture wrap mode.", "wrap", value);
        private static bool Same(Rgb a, Rgb b) => a.R == b.R && a.G == b.G && a.B == b.B;
        private static bool Same(FinalTint a, FinalTint b) => Same(a.Light, b.Light) &&
            BitConverter.SingleToInt32Bits(a.Alpha) == BitConverter.SingleToInt32Bits(b.Alpha) && a.TwoColor == b.TwoColor &&
            (!a.TwoColor || Same(a.Dark.Value, b.Dark.Value));

        public bool Upload(RuntimeFrame frame, CaneAsset asset)
        {
            if (disposed) throw new ObjectDisposedException(nameof(CaneMeshProjection));
            if (frame == null || asset == null) throw new ArgumentNullException(frame == null ? nameof(frame) : nameof(asset));
            if (ReferenceEquals(uploaded, frame) && ReferenceEquals(uploadedAsset, asset)) return false;
            // Resolve the entire packet before touching any cached GPU geometry.
            foreach (RenderAttachment attachment in frame.RenderPacket.Attachments) { asset.Resolve(attachment.Texture); Mode(attachment.BlendMode); }
            int nextCount = 0, vertices = 0, triangles = 0, submissions = 0;
            attachmentDraws.Clear(); Draw draw = null;
            for (int i = 0; i < frame.RenderPacket.Attachments.Count; i++)
            {
                RenderAttachment attachment = frame.RenderPacket.Attachments[i];
                CaneAsset.TextureEntry resource = asset.Resolve(attachment.Texture); int mode = Mode(attachment.BlendMode);
                // Only contiguous draws with exactly the same shader inputs can merge.
                // Resource identity includes sampler, color space and alpha mode.
                if (draw == null || !ReferenceEquals(draw.Resource, resource) || draw.Mode != mode || !Same(draw.Tint, attachment.Tint))
                {
                    if (draws.Count == nextCount) draws.Add(new Draw());
                    draw = draws[nextCount++]; draw.Clear(); draw.Resource = resource; draw.Mode = mode;
                    draw.Tint = attachment.Tint; draw.FirstAttachment = i;
                    SetProperties(draw, resource, attachment.Tint);
                }
                attachmentDraws.Add(nextCount - 1); draw.AttachmentCount++;
                draw.IndexStarts.Add(draw.Indices.Count); int firstVertex = draw.Vertices.Count;
                for (int j = 0; j < attachment.WorldVerticesXy.Count; j += 2)
                    draw.Vertices.Add(new Vector3(attachment.WorldVerticesXy[j], attachment.WorldVerticesXy[j + 1], 0));
                for (int j = 0; j < attachment.Uvs.Count; j += 2) draw.Uvs.Add(new Vector2(attachment.Uvs[j], attachment.Uvs[j + 1]));
                for (int j = 0; j < attachment.Indices.Count; j++) draw.Indices.Add(checked(firstVertex + attachment.Indices[j]));
                vertices += attachment.WorldVerticesXy.Count / 2; triangles += attachment.Indices.Count / 3;
            }
            for (int i = 0; i < nextCount; i++)
            {
                draw = draws[i]; draw.IndexStarts.Add(draw.Indices.Count); draw.Upload();
                if (draw.IndexCount != 0) submissions++;
            }
            for (int i = nextCount; i < count; i++) draws[i].Clear();
            count = nextCount; DrawCount = submissions; uploaded = frame; uploadedAsset = asset;
            VertexCount = vertices; TriangleCount = triangles; PacketUploads++; return true;
        }

        private static void SetProperties(Draw draw, CaneAsset.TextureEntry resource, FinalTint tint)
        {
            draw.Properties.SetTexture(TextureId, resource.Texture);
            draw.Properties.SetVector(SizeId, new Vector4(resource.Texture.width, resource.Texture.height, 1f / resource.Texture.width, 1f / resource.Texture.height));
            draw.Properties.SetVector(LightId, new Vector4(UnityObjects.Linear(tint.Light.R), UnityObjects.Linear(tint.Light.G), UnityObjects.Linear(tint.Light.B), tint.Alpha));
            Rgb dark = tint.Dark ?? new Rgb(0, 0, 0);
            draw.Properties.SetVector(DarkId, new Vector4(UnityObjects.Linear(dark.R), UnityObjects.Linear(dark.G), UnityObjects.Linear(dark.B), tint.TwoColor ? 1 : 0));
            draw.Properties.SetVector(TextureFlagsId, new Vector4(resource.Descriptor.ColorSpace == "srgb" ? 1 : 0,
                resource.Descriptor.AlphaMode == "premultiplied" ? 1 : 0, 0, 0));
            draw.Properties.SetVector(SamplingId, new Vector4(resource.Descriptor.MinFilter == "nearest" ? 0 : 1,
                resource.Descriptor.MagFilter == "nearest" ? 0 : 1, Wrap(resource.Descriptor.WrapU), Wrap(resource.Descriptor.WrapV)));
        }

        /// <summary>Record in caller-selected render pass/target with linear blending. The caller owns matrices and ordering between skeletons.</summary>
        public void Record(CommandBuffer commands, Matrix4x4 localToWorld)
            => RecordRange(commands, localToWorld, 0, AttachmentCount);

        /// <summary>Record a contiguous range of complete final attachment draws.</summary>
        public void RecordRange(CommandBuffer commands, Matrix4x4 localToWorld, int first, int length)
            => RecordRange(new CaneDrawCommands(commands), localToWorld, first, length);

        public void Record<TCommands>(TCommands commands, Matrix4x4 localToWorld) where TCommands : struct, ICaneDrawCommands
            => RecordRange(commands, localToWorld, 0, AttachmentCount);

        public void RecordRange<TCommands>(TCommands commands, Matrix4x4 localToWorld, int first, int length) where TCommands : struct, ICaneDrawCommands
        {
            if (disposed) throw new ObjectDisposedException(nameof(CaneMeshProjection));
            if (first < 0 || length < 0 || first > AttachmentCount - length) throw new ArgumentOutOfRangeException(nameof(first));
            int end = first + length;
            while (first < end)
            {
                Draw draw = draws[attachmentDraws[first]];
                int next = Math.Min(end, draw.FirstAttachment + draw.AttachmentCount);
                if (draw.IndexCount != 0)
                {
                    if (first == draw.FirstAttachment && next == draw.FirstAttachment + draw.AttachmentCount)
                        commands.DrawMesh(draw.Mesh, localToWorld, materials[draw.Mode], 0, 0, draw.Properties);
                    else
                        for (int i = first - draw.FirstAttachment; i < next - draw.FirstAttachment; i++)
                            if (draw.IndexStarts[i + 1] != draw.IndexStarts[i])
                                commands.DrawMesh(draw.Mesh, localToWorld, materials[draw.Mode], i + 1, 0, draw.Properties);
                }
                first = next;
            }
        }

        public void Dispose()
        {
            if (disposed) return; disposed = true;
            foreach (Draw draw in draws) draw.Dispose(); draws.Clear(); attachmentDraws.Clear(); count = DrawCount = 0;
            foreach (Material material in materials) UnityObjects.Release(material);
            uploaded = null; uploadedAsset = null;
        }
    }
}
