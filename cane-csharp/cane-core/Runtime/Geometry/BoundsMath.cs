using System;
using System.Collections.Generic;

namespace Cane.Geometry
{
    internal static class BoundsMath
    {
        private static bool OnSegment(double x, double y, double ax, double ay, double bx, double by)
        {
            double scale = Math.Max(1, Math.Max(Math.Max(Math.Abs(x), Math.Abs(y)), Math.Max(Math.Max(Math.Abs(ax), Math.Abs(ay)), Math.Max(Math.Abs(bx), Math.Abs(by)))));
            if (Math.Abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) > 2.2204460492503131e-16 * 32 * scale * scale) return false;
            return x >= Math.Min(ax, bx) && x <= Math.Max(ax, bx) && y >= Math.Min(ay, by) && y <= Math.Max(ay, by);
        }
        internal static bool Contains(IReadOnlyList<float> vertices, double x, double y)
        {
            if (vertices.Count < 6) return false; bool inside = false;
            for (int previous = vertices.Count - 2, current = 0; current < vertices.Count; previous = current, current += 2)
            {
                double ax = vertices[previous], ay = vertices[previous + 1], bx = vertices[current], by = vertices[current + 1];
                if (OnSegment(x, y, ax, ay, bx, by)) return true;
                if ((ay > y) != (by > y) && x < (ax - bx) * (y - by) / (ay - by) + bx) inside = !inside;
            }
            return inside;
        }
        private static double Orientation(double ax, double ay, double bx, double by, double cx, double cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        private static bool Crosses(double ax, double ay, double bx, double by, double cx, double cy, double dx, double dy)
        {
            double a = Orientation(ax, ay, bx, by, cx, cy), b = Orientation(ax, ay, bx, by, dx, dy), c = Orientation(cx, cy, dx, dy, ax, ay), d = Orientation(cx, cy, dx, dy, bx, by);
            if ((a > 0 && b < 0 || a < 0 && b > 0) && (c > 0 && d < 0 || c < 0 && d > 0)) return true;
            return a == 0 && OnSegment(cx, cy, ax, ay, bx, by) || b == 0 && OnSegment(dx, dy, ax, ay, bx, by)
                || c == 0 && OnSegment(ax, ay, cx, cy, dx, dy) || d == 0 && OnSegment(bx, by, cx, cy, dx, dy);
        }
        internal static bool Segment(IReadOnlyList<float> v, double x1, double y1, double x2, double y2)
        {
            if (Contains(v, x1, y1) || Contains(v, x2, y2)) return true;
            for (int p = v.Count - 2, i = 0; i < v.Count; p = i, i += 2) if (Crosses(x1, y1, x2, y2, v[p], v[p + 1], v[i], v[i + 1])) return true; return false;
        }
        internal static bool Intersects(IReadOnlyList<float> a, IReadOnlyList<float> b)
        {
            if (a.Count == 0 || b.Count == 0) return false; if (Contains(a, b[0], b[1]) || Contains(b, a[0], a[1])) return true;
            for (int p = a.Count - 2, i = 0; i < a.Count; p = i, i += 2) if (Segment(b, a[p], a[p + 1], a[i], a[i + 1])) return true; return false;
        }
    }
}
