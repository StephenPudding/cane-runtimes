using System;
using System.Collections.Generic;

namespace Cane
{
    /// <summary>A bounded view valid only during one custom effect callback. Topology and resource identity cannot be changed.</summary>
    public sealed class GeometryEditor
    {
        private Geometry.MutableGeometry? geometry;
        private readonly GeometryModifierStats stats;
        internal GeometryEditor(Geometry.MutableGeometry geometry, GeometryModifierStats stats) { this.geometry = geometry; this.stats = stats; }
        internal void Deactivate() => geometry = null;
        private Geometry.MutableGeometry Active => geometry ?? throw new RuntimeException(RuntimeErrorCode.InvalidState, "geometryModifier", "Geometry editor is valid only inside its callback.");
        public string AttachmentId => Active.Source.AttachmentId;
        public string SlotId => Active.Source.SlotId;
        public int DrawIndex => Active.Source.DrawIndex;
        public int VertexCount => Active.Vertices.Length / 2;
        public FinalTint Tint => Active.Tint;
        public bool TryGetPosition(int vertexIndex, out Point point) => Read(vertexIndex, false, out point);
        public bool TryGetUv(int vertexIndex, out Point point) => Read(vertexIndex, true, out point);
        private bool Read(int index, bool uv, out Point point)
        {
            Geometry.MutableGeometry g = Active;
            if (index < 0 || index >= g.Vertices.Length / 2) { point = default; return false; }
            float[] values = uv ? g.Uvs : g.Vertices; point = new Point(values[index * 2], values[index * 2 + 1]); return true;
        }
        public void SetPosition(int vertexIndex, float x, float y) => Write(vertexIndex, x, y, false);
        public void SetUv(int vertexIndex, float u, float v) => Write(vertexIndex, u, v, true);
        private void Write(int index, float x, float y, bool uv)
        {
            Geometry.MutableGeometry g = Active;
            if (index < 0 || index >= g.Vertices.Length / 2) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "geometryModifier", "Vertex index is outside the attachment.", "vertexIndex", g.Source.AttachmentId);
            Numeric.RequireFinite(x, "geometryModifier", uv ? "u" : "x"); Numeric.RequireFinite(y, "geometryModifier", uv ? "v" : "y");
            float[] values = uv ? g.Uvs : g.Vertices; values[index * 2] = x; values[index * 2 + 1] = y;
            if (uv) stats.UvWrites++; else stats.VertexWrites++;
        }
        public void SetLightTint(Rgb color, float alpha)
        {
            Geometry.MutableGeometry g = Active; Numeric.RequireFinite(alpha, "geometryModifier", "alpha");
            if (alpha < 0 || alpha > 1) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "geometryModifier", "Alpha must be in [0,1].", "alpha");
            g.Tint = new FinalTint(color, alpha, g.Tint.Dark); stats.TintWrites++;
        }
        public void SetDarkTint(Rgb color) { Geometry.MutableGeometry g = Active; g.Tint = new FinalTint(g.Tint.Light, g.Tint.Alpha, color); stats.TintWrites++; }
        public void ClearDarkTint() { Geometry.MutableGeometry g = Active; g.Tint = new FinalTint(g.Tint.Light, g.Tint.Alpha); stats.TintWrites++; }
    }
}
namespace Cane.Geometry
{
    internal sealed class MutableGeometry
    {
        internal readonly RenderAttachment Source;
        internal readonly float[] Vertices, Uvs;
        internal FinalTint Tint;
        internal MutableGeometry(RenderAttachment source)
        { Source = source; Vertices = Copy(source.WorldVerticesXy); Uvs = Copy(source.Uvs); Tint = source.Tint; }
        internal static T[] Copy<T>(IReadOnlyList<T> values)
        { var result = new T[values.Count]; for (int i = 0; i < result.Length; i++) result[i] = values[i]; return result; }
        internal RenderAttachment Finish()
        {
            string? failure = null;
            for (int i = 0; i < Vertices.Length; i++) if (!Numeric.Finite(Vertices[i]) || !Numeric.Finite(Uvs[i])) { failure = "Non-finite geometry modifier output."; break; }
            for (int i = 0; failure == null && i < Source.Indices.Count; i += 3)
            {
                double before = Area(Source.WorldVerticesXy, Source.Indices, i), after = Area(Vertices, Source.Indices, i);
                if (double.IsNaN(after) || double.IsInfinity(after) || before > 0 && after <= 0 || before < 0 && after >= 0) failure = "Geometry modifier inverted or collapsed a non-degenerate triangle.";
            }
            if (failure != null) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "geometryModifier", failure, entityId: Source.AttachmentId);
            return new RenderAttachment(Source.DrawIndex, Source.SourceZIndex, Source.SlotId, Source.AttachmentId, Source.GeometryKind, Source.BlendMode,
                Source.Texture, Tint, Source.SourceAffine, Vertices, Uvs, Copy(Source.Indices), Copy(Source.AuthoredTriangleFacing));
        }
        private static double Area(IReadOnlyList<float> v, IReadOnlyList<int> indices, int index)
        {
            int a = indices[index] * 2, b = indices[index + 1] * 2, c = indices[index + 2] * 2;
            return ((double)v[b] - v[a]) * ((double)v[c + 1] - v[a + 1]) - ((double)v[b + 1] - v[a + 1]) * ((double)v[c] - v[a]);
        }
    }
    internal static class GeometryEffects
    {
        internal static RenderPacket Apply(RenderPacket packet, GeometryModifiers persistent, GeometryModifiers? transient, ulong sequence, float time, out GeometryModifierStats stats)
        {
            stats = new GeometryModifierStats { PersistentOperations = persistent.Count, TransientOperations = transient?.Count ?? 0 };
            GeometryModifierStats counts = stats;
            if (stats.PersistentOperations + stats.TransientOperations == 0) return packet;
            var buffers = new MutableGeometry?[packet.Attachments.Count];
            Run(persistent, true); if (transient != null) Run(transient, false);
            var result = new RenderAttachment[buffers.Length];
            for (int i = 0; i < result.Length; i++) result[i] = buffers[i]?.Finish() ?? packet.Attachments[i];
            return new RenderPacket(result);

            void Run(GeometryModifiers list, bool isPersistent)
            {
                for (int operationIndex = 0; operationIndex < list.Count; operationIndex++)
                {
                    GeometryOperation operation = list.Operations[operationIndex];
                    for (int i = 0; i < buffers.Length; i++)
                    {
                        RenderAttachment source = packet.Attachments[i]; if (!operation.Matches(source)) continue;
                        MutableGeometry buffer = buffers[i] ?? (buffers[i] = new MutableGeometry(source));
                        counts.AttachmentVisits++;
                        if (operation.Kind == "deterministicJitter") Jitter(buffer, operation, time, counts);
                        else if (operation.Kind == "radialWave") Radial(buffer, operation, time, counts);
                        else
                        {
                            var editor = new GeometryEditor(buffer, counts);
                            try { operation.Callback!(editor, new GeometryModifierContext(sequence, time, isPersistent, operationIndex)); }
                            finally { editor.Deactivate(); }
                        }
                    }
                }
            }
        }
        private static void Jitter(MutableGeometry geometry, GeometryOperation operation, float time, GeometryModifierStats stats)
        {
            double ticks = Math.Floor(time * operation.Frequency);
            uint tick = double.IsNaN(ticks) || double.IsInfinity(ticks) ? 0 : unchecked((uint)(ticks % 4294967296.0));
            for (int i = 0; i < geometry.Vertices.Length / 2; i++)
            {
                geometry.Vertices[2 * i] = (float)(geometry.Vertices[2 * i] + Hash(operation.Seed, geometry.Source.DrawIndex, i, tick, 0x68bc21eb) * operation.AmplitudeX);
                geometry.Vertices[2 * i + 1] = (float)(geometry.Vertices[2 * i + 1] + Hash(operation.Seed, geometry.Source.DrawIndex, i, tick, 0x02e5be93) * operation.AmplitudeY);
                stats.VertexWrites++;
            }
        }
        private static double Hash(uint seed, int draw, int vertex, uint tick, uint salt)
        {
            unchecked
            {
                uint hash = seed ^ ((uint)draw + 1) * 0x9e3779b9 ^ ((uint)vertex + 1) * 0x85ebca6b ^ tick * 0xc2b2ae35 ^ salt;
                hash ^= hash >> 16; hash *= 0x7feb352d; hash ^= hash >> 15; hash *= 0x846ca68b; hash ^= hash >> 16;
                return hash / 4294967295.0 * 2 - 1;
            }
        }
        private static void Radial(MutableGeometry geometry, GeometryOperation operation, float time, GeometryModifierStats stats)
        {
            const double radians = Math.PI / 180, tau = Math.PI * 2;
            double phase = operation.Phase * radians + time * operation.Frequency * tau;
            for (int i = 0; i < geometry.Vertices.Length; i += 2)
            {
                double x = geometry.Vertices[i] - operation.X, y = geometry.Vertices[i + 1] - operation.Y, distance = Math.Sqrt(x * x + y * y);
                double falloff = operation.Radius == 0 ? 1 : Math.Max(0, 1 - distance / operation.Radius); if (falloff <= 0) continue;
                double wave = Math.Sin(phase + distance / operation.Wavelength * tau), nextDistance = distance + operation.AmplitudeX * wave * falloff;
                double angle = Math.Atan2(y, x) + operation.AmplitudeY * radians * wave * falloff;
                geometry.Vertices[i] = (float)(operation.X + Math.Cos(angle) * nextDistance); geometry.Vertices[i + 1] = (float)(operation.Y + Math.Sin(angle) * nextDistance);
                stats.VertexWrites++;
            }
        }
    }
}
