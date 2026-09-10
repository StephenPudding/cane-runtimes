using System;
using System.Collections.Generic;

namespace Cane.Geometry
{
    internal readonly struct Vertex
    {
        internal readonly float X, Y, U, V;
        internal Vertex(float x, float y, float u = 0, float v = 0) { X = x; Y = y; U = u; V = v; }
        internal static Vertex Lerp(Vertex a, Vertex b, float t) => new Vertex(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.U + (b.U - a.U) * t, a.V + (b.V - a.V) * t);
    }
    internal sealed class GeometryBuffer
    {
        internal readonly List<Vertex> Vertices = new List<Vertex>();
        internal readonly List<int> Indices = new List<int>();
        internal void Append(List<Vertex> polygon)
        {
            if (polygon.Count < 3) return;
            if (Vertices.Count > 65536 - polygon.Count) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "apply", "Clipped attachment exceeds 65536 vertices.");
            int offset = Vertices.Count; Vertices.AddRange(polygon);
            for (int i = 1; i < polygon.Count - 1; i++) { Indices.Add(offset); Indices.Add(offset + i); Indices.Add(offset + i + 1); }
        }
    }
    internal sealed class ClipPolygon
    {
        internal readonly List<List<Vertex>> Pieces;
        internal readonly string? EndSlot;
        internal readonly bool Inverse;
        internal ClipPolygon(List<List<Vertex>> pieces, bool inverse, string? endSlot) { Pieces = pieces; Inverse = inverse; EndSlot = endSlot; }
    }
    internal static class Clipping
    {
        private const float Epsilon = 0.00001f;
        private static float Cross(Vertex a, Vertex b, Vertex p) => (b.X - a.X) * (p.Y - a.Y) - (b.Y - a.Y) * (p.X - a.X);
        private static float Area(List<Vertex> points)
        {
            float sum = 0; for (int i = 0; i < points.Count; i++) { var a = points[i]; var b = points[(i + 1) % points.Count]; sum += a.X * b.Y - b.X * a.Y; } return sum * 0.5f;
        }
        private static bool Valid(List<Vertex> p) => p.Count >= 3 && Math.Abs(Area(p)) > Epsilon;
        internal static ClipPolygon? Prepare(float[] xy, bool convex, bool inverse, string? endSlot)
        {
            var points = new List<Vertex>(); for (int i = 0; i < xy.Length; i += 2) points.Add(new Vertex(xy[i], xy[i + 1]));
            float area = Area(points); if (points.Count < 3 || !Numeric.Finite(area) || Math.Abs(area) <= Epsilon) return null;
            if (area < 0) points.Reverse(); bool isConvex = true;
            for (int i = 0; i < points.Count; i++) if (Cross(points[i], points[(i + 1) % points.Count], points[(i + 2) % points.Count]) < -Epsilon) { isConvex = false; break; }
            if (convex && !isConvex) { points = Hull(points); isConvex = true; }
            if (isConvex) return Valid(points) ? new ClipPolygon(new List<List<Vertex>> { points }, inverse, endSlot) : null;
            var remaining = new List<Vertex>(points); var pieces = new List<List<Vertex>>(); int budget = points.Count * points.Count;
            while (remaining.Count > 3)
            {
                bool found = false;
                for (int i = 0; i < remaining.Count; i++)
                {
                    int previous = (i + remaining.Count - 1) % remaining.Count, next = (i + 1) % remaining.Count;
                    Vertex a = remaining[previous], b = remaining[i], c = remaining[next]; if (Cross(a, b, c) <= Epsilon) continue;
                    bool inside = false;
                    for (int j = 0; j < remaining.Count; j++)
                    { if (j == previous || j == i || j == next) continue; Vertex p = remaining[j]; if (Cross(a, b, p) >= -Epsilon && Cross(b, c, p) >= -Epsilon && Cross(c, a, p) >= -Epsilon) { inside = true; break; } }
                    if (inside) continue;
                    pieces.Add(new List<Vertex> { a, b, c }); remaining.RemoveAt(i); found = true; break;
                }
                if (!found || --budget == 0) return null;
            }
            if (Valid(remaining)) pieces.Add(remaining);
            return new ClipPolygon(pieces, inverse, endSlot);
        }
        private static List<Vertex> Hull(List<Vertex> input)
        {
            var sorted = new List<Vertex>(input); sorted.Sort((a, b) => a.X == b.X ? a.Y.CompareTo(b.Y) : a.X.CompareTo(b.X));
            for (int i = sorted.Count - 1; i > 0; i--) if (sorted[i].X == sorted[i - 1].X && sorted[i].Y == sorted[i - 1].Y) sorted.RemoveAt(i);
            var lower = new List<Vertex>(); var upper = new List<Vertex>();
            foreach (var p in sorted) { while (lower.Count >= 2 && Cross(lower[lower.Count - 2], lower[lower.Count - 1], p) <= Epsilon) lower.RemoveAt(lower.Count - 1); lower.Add(p); }
            for (int i = sorted.Count - 1; i >= 0; i--) { var p = sorted[i]; while (upper.Count >= 2 && Cross(upper[upper.Count - 2], upper[upper.Count - 1], p) <= Epsilon) upper.RemoveAt(upper.Count - 1); upper.Add(p); }
            if (lower.Count != 0) lower.RemoveAt(lower.Count - 1); if (upper.Count != 0) upper.RemoveAt(upper.Count - 1); lower.AddRange(upper); return lower;
        }
        private static List<Vertex> Plane(List<Vertex> input, Func<Vertex, float> distance, float epsilon, bool compareUv)
        {
            var output = new List<Vertex>(); if (input.Count == 0) return output;
            Vertex previous = input[input.Count - 1]; float pd = distance(previous); bool pi = pd >= -epsilon;
            foreach (Vertex current in input)
            {
                float cd = distance(current); bool ci = cd >= -epsilon;
                if (ci != pi)
                {
                    float denominator = pd - cd;
                    if (Math.Abs(denominator) > Numeric.Epsilon) output.Add(Vertex.Lerp(previous, current, Numeric.Clamp(pd / denominator, 0, 1)));
                }
                if (ci) output.Add(current);
                previous = current; pd = cd; pi = ci;
            }
            for (int i = output.Count - 1; i > 0; i--) if (Same(output[i], output[i - 1], epsilon, compareUv)) output.RemoveAt(i);
            if (output.Count > 1 && Same(output[0], output[output.Count - 1], epsilon, compareUv)) output.RemoveAt(output.Count - 1);
            return output;
        }
        private static bool Same(Vertex a, Vertex b, float epsilon, bool uv) => Math.Abs(a.X - b.X) <= epsilon && Math.Abs(a.Y - b.Y) <= epsilon && (!uv || Math.Abs(a.U - b.U) <= epsilon && Math.Abs(a.V - b.V) <= epsilon);
        private static List<Vertex> Intersect(List<Vertex> input, List<Vertex> clip)
        {
            foreach (var edge in Edges(clip)) { input = Plane(input, p => Cross(edge.A, edge.B, p), Epsilon, false); if (!Valid(input)) return new List<Vertex>(); }
            return input;
        }
        private static IEnumerable<(Vertex A, Vertex B)> Edges(List<Vertex> points)
        { for (int i = 0; i < points.Count; i++) yield return (points[i], points[(i + 1) % points.Count]); }
        private static List<List<Vertex>> Subtract(List<Vertex> input, List<Vertex> clip)
        {
            var fragments = new List<List<Vertex>>();
            foreach (var edge in Edges(clip))
            {
                var outside = Plane(input, p => -Cross(edge.A, edge.B, p), Epsilon, false); if (Valid(outside)) fragments.Add(outside);
                input = Plane(input, p => Cross(edge.A, edge.B, p), Epsilon, false); if (!Valid(input)) break;
            }
            return fragments;
        }
        internal static GeometryBuffer Apply(GeometryBuffer source, ClipPolygon clip)
        {
            var output = new GeometryBuffer();
            for (int triangle = 0; triangle < source.Indices.Count; triangle += 3)
            {
                var original = new List<Vertex> { source.Vertices[source.Indices[triangle]], source.Vertices[source.Indices[triangle + 1]], source.Vertices[source.Indices[triangle + 2]] };
                if (!clip.Inverse) { foreach (var piece in clip.Pieces) { var p = Intersect(original, piece); if (Valid(p)) output.Append(p); } }
                else
                {
                    var fragments = new List<List<Vertex>> { original };
                    foreach (var piece in clip.Pieces)
                    {
                        var next = new List<List<Vertex>>(); foreach (var fragment in fragments) next.AddRange(Subtract(fragment, piece)); fragments = next;
                        long count = 0; foreach (var p in fragments) count += p.Count; if (count > 65536) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "apply", "Inverse clipping output exceeds vertex budget.");
                    }
                    foreach (var p in fragments) if (Valid(p)) output.Append(p);
                }
            }
            return output;
        }
        internal static GeometryBuffer Trim(GeometryBuffer source, float minU, float maxU, float minV, float maxV)
        {
            const float epsilon = 0.000001f; bool allInside = true;
            foreach (Vertex p in source.Vertices) if (p.U < minU - epsilon || p.U > maxU + epsilon || p.V < minV - epsilon || p.V > maxV + epsilon) { allInside = false; break; }
            if (allInside) return source;
            var output = new GeometryBuffer();
            for (int i = 0; i < source.Indices.Count; i += 3)
            {
                var p = new List<Vertex> { source.Vertices[source.Indices[i]], source.Vertices[source.Indices[i + 1]], source.Vertices[source.Indices[i + 2]] };
                p = Plane(p, v => v.U - minU, epsilon, true); p = Plane(p, v => maxU - v.U, epsilon, true);
                p = Plane(p, v => v.V - minV, epsilon, true); p = Plane(p, v => maxV - v.V, epsilon, true);
                if (p.Count >= 3) output.Append(p);
            }
            return output;
        }
    }
}
