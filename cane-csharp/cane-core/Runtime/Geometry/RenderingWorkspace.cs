using System;
using System.Collections.Generic;

namespace Cane.Geometry
{
    /// <summary>Player-local scratch. Published arrays are copied or shared as immutable views.</summary>
    internal sealed class RenderingWorkspace
    {
        internal readonly GeometryBuffer Source = new GeometryBuffer();
        internal readonly List<RenderAttachment> Draws = new List<RenderAttachment>();
        internal readonly Dictionary<string, RenderAttachment> Previous = new Dictionary<string, RenderAttachment>(StringComparer.Ordinal);
        internal readonly List<float> Positions = new List<float>(), Uvs = new List<float>();
        internal readonly List<string> Facing = new List<string>();
        private float[] world = Array.Empty<float>();
        internal Span<float> World(int length)
        { if (world.Length < length) world = new float[length]; return world.AsSpan(0, length); }
        internal GeometryBuffer BeginDraw()
        {
            Source.Vertices.Clear(); Source.Indices.Clear(); Positions.Clear(); Uvs.Clear(); Facing.Clear(); return Source;
        }
        internal void Begin(RenderPacket? previous)
        {
            Draws.Clear(); Previous.Clear();
            if (previous != null) foreach (RenderAttachment draw in previous.Attachments) Previous.Add(draw.AttachmentId, draw);
        }
        internal void End()
        {
            // Do not retain a discarded project's textures or complete preceding packets.
            Draws.Clear(); Previous.Clear();
        }
        internal static IReadOnlyList<float> Publish(List<float> values, IReadOnlyList<float>? previous)
        {
            bool same = previous != null && previous.Count == values.Count;
            for (int i = 0; same && i < values.Count; i++)
                same = BitConverter.SingleToInt32Bits(values[i]) == BitConverter.SingleToInt32Bits(previous![i]);
            return same ? previous! : Array.AsReadOnly(values.ToArray());
        }
        internal static IReadOnlyList<int> Publish(List<int> values, IReadOnlyList<int>? previous)
        {
            bool same = previous != null && previous.Count == values.Count;
            for (int i = 0; same && i < values.Count; i++) same = values[i] == previous![i];
            return same ? previous! : Array.AsReadOnly(values.ToArray());
        }
        internal static IReadOnlyList<string> Publish(List<string> values, IReadOnlyList<string>? previous)
        {
            bool same = previous != null && previous.Count == values.Count;
            for (int i = 0; same && i < values.Count; i++) same = values[i] == previous![i];
            return same ? previous! : Array.AsReadOnly(values.ToArray());
        }
    }
}
