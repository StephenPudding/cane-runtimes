using System;

namespace Cane.Constraints
{
    internal sealed partial class PathSampler
    {
        // The inverse table has 24 subdivisions. Forward sampling retains its independent ten-step lookup.
        internal float? ProjectDistance(Point target)
        {
            double bestSquared = double.PositiveInfinity, bestDistance = 0;
            bool found = false;
            void Consider(double x, double y, double distance)
            {
                double dx = target.X - x, dy = target.Y - y, squared = dx * dx + dy * dy;
                if (double.IsNaN(distance) || double.IsInfinity(distance) || !(squared < bestSquared)) return;
                bestSquared = squared; bestDistance = distance; found = true;
            }
            void Segment(Point from, Point to, double startDistance, double endDistance)
            {
                double dx = (double)to.X - from.X, dy = (double)to.Y - from.Y, squared = dx * dx + dy * dy;
                if (!(squared > 0) || double.IsInfinity(squared)) return;
                double ratio = Math.Max(0, Math.Min(1, (((double)target.X - from.X) * dx + ((double)target.Y - from.Y) * dy) / squared));
                Consider(from.X + dx * ratio, from.Y + dy * ratio, startDistance + (endDistance - startDistance) * ratio);
            }
            for (int i = 0; i < curves.Length; i++)
            {
                Curve curve = curves[i]; double begin = i == 0 ? 0 : lengths[i - 1], span = lengths[i] - begin;
                float[]? localLengths = detailed == null ? null : curve.Lengths(24);
                double localTotal = localLengths == null ? 0 : localLengths[23];
                Point previous = curve.P0; double before = begin;
                for (int subdivision = 0; subdivision < 24; subdivision++)
                {
                    Point next = curve.Point((subdivision + 1) / 24f);
                    double ratio = localLengths == null ? (subdivision + 1) / 24.0 : localTotal > 0 ? localLengths[subdivision] / localTotal : 0;
                    double after = begin + span * ratio;
                    Segment(previous, next, before, after); previous = next; before = after;
                }
            }
            if (!closed && curves.Length != 0)
            {
                void Ray(Point anchor, Point handle, bool start)
                {
                    double dx = start ? (double)handle.X - anchor.X : (double)anchor.X - handle.X;
                    double dy = start ? (double)handle.Y - anchor.Y : (double)anchor.Y - handle.Y;
                    double length = Math.Sqrt(dx * dx + dy * dy);
                    if (!(length > 0) || double.IsInfinity(length)) return;
                    dx /= length; dy /= length;
                    double distance = ((double)target.X - anchor.X) * dx + ((double)target.Y - anchor.Y) * dy;
                    if (start ? distance >= 0 : distance <= 0) return;
                    Consider(anchor.X + dx * distance, anchor.Y + dy * distance, start ? distance : Length + distance);
                }
                Ray(curves[0].P0, curves[0].P1, true);
                Ray(curves[curves.Length - 1].P3, curves[curves.Length - 1].P2, false);
            }
            return found ? (float)bestDistance : (float?)null;
        }
    }
}
