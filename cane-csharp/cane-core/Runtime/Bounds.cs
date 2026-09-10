using System;
using System.Collections;
using System.Collections.Generic;
using Cane.Geometry;

namespace Cane
{
    public sealed class BoundsOptions
    {
        public bool IncludeRenderGeometry { get; set; } = true;
        public bool IncludeBoundingBoxes { get; set; } = true;
        public bool IncludeTransparent { get; set; }
    }
    public readonly struct BoundsAabb
    {
        public readonly bool Empty;
        public readonly float MinX, MinY, MaxX, MaxY;
        public float Width => MaxX - MinX;
        public float Height => MaxY - MinY;
        internal BoundsAabb(bool empty, float minX, float minY, float maxX, float maxY)
        { Empty = empty; MinX = minX; MinY = minY; MaxX = maxX; MaxY = maxY; }
    }
    internal sealed class BoundsVertices : IReadOnlyList<float>
    {
        internal float[] Buffer = Array.Empty<float>();
        public int Count { get; private set; }
        public float this[int index] => index >= 0 && index < Count ? Buffer[index] : throw new ArgumentOutOfRangeException(nameof(index));
        internal Span<float> Resize(int count)
        { if (Buffer.Length < count) Array.Resize(ref Buffer, Math.Max(count, Buffer.Length * 2)); Count = count; return Buffer.AsSpan(0, count); }
        public IEnumerator<float> GetEnumerator() { for (int i = 0; i < Count; i++) yield return Buffer[i]; }
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
    public sealed class BoundsPolygon
    {
        internal readonly BoundsVertices Vertices = new BoundsVertices();
        public string SlotId { get; internal set; } = "";
        public string AttachmentId { get; internal set; } = "";
        public int DrawIndex { get; internal set; }
        public IReadOnlyList<float> WorldVerticesXy => Vertices;
        internal BoundsPolygon Copy()
        {
            var p = new BoundsPolygon { SlotId = SlotId, AttachmentId = AttachmentId, DrawIndex = DrawIndex };
            Vertices.Buffer.AsSpan(0, Vertices.Count).CopyTo(p.Vertices.Resize(Vertices.Count)); return p;
        }
    }
    public readonly struct BoundsHit
    {
        public readonly string SlotId, AttachmentId;
        public readonly int DrawIndex;
        internal BoundsHit(BoundsPolygon p) { SlotId = p.SlotId; AttachmentId = p.AttachmentId; DrawIndex = p.DrawIndex; }
    }
    public sealed class BoundsSnapshot
    {
        public ulong FrameSequence { get; }
        public BoundsAabb Aabb { get; }
        public IReadOnlyList<BoundsPolygon> Polygons { get; }
        internal BoundsSnapshot(RuntimeBounds bounds)
        {
            FrameSequence = bounds.FrameSequence; Aabb = bounds.Aabb; var p = new BoundsPolygon[bounds.Polygons.Count];
            for (int i = 0; i < p.Length; i++) p[i] = bounds.Polygons[i].Copy(); Polygons = Array.AsReadOnly(p);
        }
    }
    /// <summary>Retained bounds storage. Polygon views expire on the next WriteBounds; Snapshot returns independently owned data.</summary>
    public sealed class RuntimeBounds
    {
        private readonly List<BoundsPolygon> pool = new List<BoundsPolygon>(), polygons = new List<BoundsPolygon>();
        public ulong FrameSequence { get; private set; }
        public BoundsAabb Aabb { get; private set; } = new BoundsAabb(true, 0, 0, 0, 0);
        public IReadOnlyList<BoundsPolygon> Polygons { get; }
        public RuntimeBounds() { Polygons = polygons.AsReadOnly(); }
        public BoundsSnapshot Snapshot() => new BoundsSnapshot(this);
        internal void Begin(ulong sequence) { FrameSequence = sequence; Aabb = new BoundsAabb(true, 0, 0, 0, 0); polygons.Clear(); }
        internal BoundsPolygon Acquire(string slot, string attachment, int draw, int count)
        {
            if (pool.Count == polygons.Count) pool.Add(new BoundsPolygon()); BoundsPolygon polygon = pool[polygons.Count];
            polygon.SlotId = slot; polygon.AttachmentId = attachment; polygon.DrawIndex = draw; polygon.Vertices.Resize(count); polygons.Add(polygon); return polygon;
        }
        internal void Include(IReadOnlyList<float> vertices)
        {
            bool empty = Aabb.Empty; float minX = Aabb.MinX, minY = Aabb.MinY, maxX = Aabb.MaxX, maxY = Aabb.MaxY;
            for (int i = 0; i < vertices.Count; i += 2)
            {
                float x = vertices[i], y = vertices[i + 1];
                if (!Numeric.Finite(x) || !Numeric.Finite(y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "writeBounds", "Geometry contains non-finite coordinates.");
                if (empty) { minX = maxX = x; minY = maxY = y; empty = false; }
                else { minX = Math.Min(minX, x); minY = Math.Min(minY, y); maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y); }
            }
            // Finite endpoints can still overflow when their binary32 extent is computed.
            if (!Numeric.Finite(maxX - minX)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "writeBounds", "Geometry bounds width overflowed.", "aabb.width");
            if (!Numeric.Finite(maxY - minY)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "writeBounds", "Geometry bounds height overflowed.", "aabb.height");
            Aabb = new BoundsAabb(empty, minX, minY, maxX, maxY);
        }
        public BoundsPolygon? PolygonForAttachment(string attachmentId)
        {
            if (string.IsNullOrEmpty(attachmentId)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "polygonForAttachment", "Attachment ID is required.", "attachmentId");
            for (int i = polygons.Count - 1; i >= 0; i--) if (polygons[i].AttachmentId == attachmentId) return polygons[i]; return null;
        }
        public BoundsHit? ContainsPoint(double x, double y)
        { PointFinite(x, y, "containsPoint"); for (int i = polygons.Count - 1; i >= 0; i--) if (BoundsMath.Contains(polygons[i].Vertices, x, y)) return new BoundsHit(polygons[i]); return null; }
        public BoundsHit? IntersectsSegment(double x1, double y1, double x2, double y2)
        { SegmentFinite(x1, y1, x2, y2, "intersectsSegment"); for (int i = polygons.Count - 1; i >= 0; i--) if (BoundsMath.Segment(polygons[i].Vertices, x1, y1, x2, y2)) return new BoundsHit(polygons[i]); return null; }
        public int WritePointHits(double x, double y, List<BoundsHit> output)
        {
            PointFinite(x, y, "writePointHits"); Output(output, "writePointHits"); output.Clear();
            for (int i = polygons.Count - 1; i >= 0; i--) if (BoundsMath.Contains(polygons[i].Vertices, x, y)) output.Add(new BoundsHit(polygons[i])); return output.Count;
        }
        public int WriteSegmentHits(double x1, double y1, double x2, double y2, List<BoundsHit> output)
        {
            SegmentFinite(x1, y1, x2, y2, "writeSegmentHits"); Output(output, "writeSegmentHits"); output.Clear();
            for (int i = polygons.Count - 1; i >= 0; i--) if (BoundsMath.Segment(polygons[i].Vertices, x1, y1, x2, y2)) output.Add(new BoundsHit(polygons[i])); return output.Count;
        }
        public bool AabbContainsPoint(double x, double y)
        { PointFinite(x, y, "aabbContainsPoint"); return !Aabb.Empty && x >= Aabb.MinX && x <= Aabb.MaxX && y >= Aabb.MinY && y <= Aabb.MaxY; }
        public bool AabbIntersectsSegment(double x1, double y1, double x2, double y2)
        {
            SegmentFinite(x1, y1, x2, y2, "aabbIntersectsSegment"); if (Aabb.Empty) return false;
            double low = 0, high = 1, dx = x2 - x1, dy = y2 - y1;
            return Clip(-dx, x1 - Aabb.MinX) && Clip(dx, Aabb.MaxX - x1) && Clip(-dy, y1 - Aabb.MinY) && Clip(dy, Aabb.MaxY - y1);
            bool Clip(double p, double q) { if (p == 0) return q >= 0; double r = q / p; if (p < 0) { if (r > high) return false; low = Math.Max(low, r); } else { if (r < low) return false; high = Math.Min(high, r); } return true; }
        }
        public bool AabbIntersectsBounds(RuntimeBounds other)
        {
            Output(other, "aabbIntersectsBounds"); BoundsAabb b = other.Aabb;
            return !Aabb.Empty && !b.Empty && Aabb.MinX <= b.MaxX && Aabb.MaxX >= b.MinX && Aabb.MinY <= b.MaxY && Aabb.MaxY >= b.MinY;
        }
        public bool IntersectsBounds(RuntimeBounds other)
        {
            if (!AabbIntersectsBounds(other)) return false;
            foreach (BoundsPolygon p in polygons) foreach (BoundsPolygon q in other.polygons) if (BoundsMath.Intersects(p.Vertices, q.Vertices)) return true; return false;
        }
        private static void Output(object? output, string op) { if (output == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Output or bounds argument is required."); }
        private static void PointFinite(double x, double y, string op)
        { if (double.IsNaN(x) || double.IsInfinity(x) || double.IsNaN(y) || double.IsInfinity(y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Query coordinates must be finite."); }
        private static void SegmentFinite(double x1, double y1, double x2, double y2, string op) { PointFinite(x1, y1, op); PointFinite(x2, y2, op); }
    }
    public sealed partial class RuntimePlayer
    {
        public BoundsSnapshot QueryBounds(BoundsOptions? options = null) => WriteBounds(new RuntimeBounds(), options).Snapshot();
        public RuntimeBounds WriteBounds(RuntimeBounds output, BoundsOptions? options = null)
        {
            if (output == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "writeBounds", "Bounds output is required.", "output");
            bool render = options?.IncludeRenderGeometry ?? true, boxes = options?.IncludeBoundingBoxes ?? true, transparent = options?.IncludeTransparent ?? false;
            output.Begin(Frame.Sequence);
            if (render) foreach (RenderAttachment attachment in Frame.RenderPacket.Attachments) if (transparent || attachment.Tint.Alpha > 0) output.Include(attachment.WorldVerticesXy);
            if (boxes) for (int draw = 0; draw < publishedPose.Order.Length; draw++)
            {
                int slot = publishedPose.Order[draw], index = publishedPose.Slots[slot].ResolvedAttachment; if (index < 0) continue;
                AttachmentData attachment = data.AttachmentData[index]; if (attachment.Kind != "boundingbox") continue;
                BoundsPolygon polygon = output.Acquire(data.SlotData[slot].Id, attachment.Id, draw, attachment.GeometrySource.Vertices.Length);
                Rendering.WriteWorldVertices(publishedPose, attachment, polygon.Vertices.Buffer.AsSpan(0, polygon.Vertices.Count)); output.Include(polygon.Vertices);
            }
            return output;
        }
    }
}
