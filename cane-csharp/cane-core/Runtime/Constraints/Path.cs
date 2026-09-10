using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;
using Cane.Geometry;

namespace Cane.Constraints
{
    internal sealed partial class PathSampler
    {
        private readonly Curve[] curves;
        private readonly float[] lengths;
        private readonly float[][]? detailed;
        private readonly bool closed;
        internal bool Closed => closed;
        internal float Length => lengths.Length == 0 ? 0 : lengths[lengths.Length - 1];
        internal PathSampler(float[] world, Json path)
        {
            closed = path.B("closed"); int knots = world.Length / 6, count = closed ? knots : knots - 1;
            curves = new Curve[count]; lengths = new float[count]; bool constant = path.B("constantSpeed");
            if (constant) detailed = new float[count][];
            Point Read(int knot, int point) { int i = knot * 6 + point * 2; return new Point(world[i], world[i + 1]); }
            bool authored = !constant && path["lengths"].ArrayOrEmpty.Count == knots; float previous = 0;
            foreach (Json value in path["lengths"].ArrayOrEmpty) { float length = value.Float; if (!Numeric.Finite(length) || length < previous) authored = false; previous = length; }
            float sum = 0;
            for (int i = 0; i < count; i++)
            {
                int next = (i + 1) % knots; var c = new Curve(Read(i, 1), Read(i, 2), Read(next, 0), Read(next, 1)); curves[i] = c;
                if (authored) lengths[i] = path["lengths"][i].Float;
                else { float[] sampled = c.Lengths(constant ? 4 : 24); sum += sampled[sampled.Length - 1]; lengths[i] = sum; }
                if (detailed != null) detailed[i] = c.Lengths(10);
            }
        }
        internal Sample? At(float distance)
        {
            if (!Numeric.Finite(distance) || !Numeric.Finite(Length) || Length <= 0) return null;
            if (closed) { distance %= Length; if (distance < 0) distance += Length; }
            else if (distance < 0 || distance > Length)
            {
                bool start = distance < 0; Curve c = start ? curves[0] : curves[curves.Length - 1]; Point end = start ? c.P0 : c.P3, from = start ? c.P1 : c.P2;
                float dx = end.X - from.X, dy = end.Y - from.Y, length = Numeric.Hypot(dx, dy); if (length == 0) return null;
                float amount = start ? -distance : distance - Length; dx /= length; dy /= length;
                return new Sample(new Point(end.X + dx * amount, end.Y + dy * amount), Numeric.Atan2(dy, dx) * Numeric.RadToDeg);
            }
            int index = 0; while (index + 1 < lengths.Length && lengths[index] < distance) index++;
            float before = index == 0 ? 0 : lengths[index - 1], span = lengths[index] - before;
            float t = span == 0 ? 0 : Numeric.Clamp((distance - before) / span, 0, 1);
            if (detailed != null)
            {
                float[] lookup = detailed[index]; float target = t * lookup[lookup.Length - 1]; int segment = 0;
                while (segment + 1 < lookup.Length && lookup[segment] < target) segment++;
                float a = segment == 0 ? 0 : lookup[segment - 1], length = lookup[segment] - a;
                float ratio = length == 0 ? 0 : Numeric.Clamp((target - a) / length, 0, 1); t = (segment + ratio) / 10;
            }
            return new Sample(curves[index].Point(t), curves[index].Angle(t));
        }
        internal readonly struct Sample
        {
            internal readonly Point Position;
            internal readonly float Tangent;
            internal Sample(Point position, float tangent) { Position = position; Tangent = tangent; }
        }
        private readonly struct Curve
        {
            internal readonly Point P0, P1, P2, P3;
            internal Curve(Point p0, Point p1, Point p2, Point p3) { P0 = p0; P1 = p1; P2 = p2; P3 = p3; }
            internal Point Point(float t)
            {
                float u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
                return new Point(a * P0.X + b * P1.X + c * P2.X + d * P3.X, a * P0.Y + b * P1.Y + c * P2.Y + d * P3.Y);
            }
            internal float Angle(float t)
            {
                float u = 1 - t, dx = 3 * u * u * (P1.X - P0.X) + 6 * u * t * (P2.X - P1.X) + 3 * t * t * (P3.X - P2.X);
                float dy = 3 * u * u * (P1.Y - P0.Y) + 6 * u * t * (P2.Y - P1.Y) + 3 * t * t * (P3.Y - P2.Y);
                return (dx != 0 || dy != 0 ? Numeric.Atan2(dy, dx) : Numeric.Atan2(P3.Y - P0.Y, P3.X - P0.X)) * Numeric.RadToDeg;
            }
            internal float[] Lengths(int segments)
            {
                var values = new float[segments]; Point previous = P0; float total = 0;
                for (int i = 0; i < segments; i++) { Point p = Point((float)(i + 1) / segments); total += Numeric.Hypot(p.X - previous.X, p.Y - previous.Y); values[i] = total; previous = p; }
                return values;
            }
        }
    }
    internal static class PathConstraint
    {
        internal static void Solve(Pose pose, Json c, Affine root)
        {
            int slot = pose.Data.SlotIndex[c.S("targetSlotId")], targetBone = pose.Data.SlotData[slot].Bone;
            if (!pose.IsActive(pose.Data.BoneData[targetBone].Id, "boneIds")) return;
            int attachment = pose.Slots[slot].ResolvedAttachment; if (attachment < 0 || pose.Data.AttachmentData[attachment].Kind != "path") return;
            AttachmentData a = pose.Data.AttachmentData[attachment]; var path = new PathSampler(Rendering.WorldVertices(pose, a), a.Raw); if (!(path.Length > 0)) return;
            int count = c["boneIds"].Items.Count; var indices = new int[count]; var lengths = new float[count]; var snapshot = (Affine[])pose.World.Clone();
            bool tangent = c.S("rotateMode") == "tangent", chainScale = c.S("rotateMode") == "chainScale"; int spacesCount = tangent ? count : count + 1;
            float total = 0;
            for (int i = 0; i < count; i++)
            {
                int bone = pose.Data.BoneIndex[c["boneIds"][i].String]; indices[i] = bone; lengths[i] = Math.Max(0, pose.Data.BoneData[bone].Length) * Solvers.Sx(snapshot[bone]);
                if (i < (tangent ? count - 1 : count)) total += lengths[i];
            }
            float spacing = c.F("spacing"), distance = c.F("position") * (c.S("positionMode") == "percent" ? path.Length : 1);
            float rotation = c.F("rotation"), offset = rotation != 0 && snapshot[targetBone].Determinant < 0 ? -rotation : rotation;
            float mr = Numeric.Clamp(c.F("mixRotate", 1), 0, 1), mx = Numeric.Clamp(c.F("mixX", 1), 0, 1), my = Numeric.Clamp(c.F("mixY", 1), 0, 1);
            var desired = new Dictionary<int, Affine>(); PathSampler.Sample? previous = null;
            float? translationResidual = null, rotationResidual = null, scaleResidual = null;
            for (int i = 0; i < count; i++)
            {
                int bone = indices[i]; float setupLength = Math.Max(0, pose.Data.BoneData[bone].Length), increment;
                switch (c.S("spacingMode"))
                {
                    case "length": increment = setupLength > 0 ? Math.Max(setupLength + spacing, 0) * lengths[i] / setupLength : spacing; break;
                    case "fixed": increment = setupLength > 0 ? spacing * lengths[i] / setupLength : spacing; break;
                    case "percent": increment = spacing * path.Length; break;
                    default: increment = total > 0 ? (setupLength > 0 ? lengths[i] : spacing) / total * spacing * path.Length : spacing * path.Length / Math.Max(spacesCount, 1); break;
                }
                PathSampler.Sample? sample = previous ?? path.At(distance), next = path.At(distance + increment); previous = null; distance += increment;
                if (!sample.HasValue || !next.HasValue) continue;
                Point point = sample.Value.Position, ahead = next.Value.Position; Affine current = snapshot[bone]; float oldAngle = Solvers.Angle(current);
                float chainAngle = Numeric.Atan2(ahead.Y - point.Y, ahead.X - point.X) * Numeric.RadToDeg;
                float angle = oldAngle + Numeric.Wrap((tangent ? sample.Value.Tangent : chainAngle) + offset - oldAngle) * mr;
                float scaleX = Solvers.Sx(current), scaleY = Solvers.Sy(current);
                if (chainScale && setupLength != 0) scaleX += (Numeric.Hypot(ahead.X - point.X, ahead.Y - point.Y) / setupLength - scaleX) * mr;
                float shearY = Solvers.YAngle(current) - oldAngle - 90;
                Affine nextWorld = Affine.FromLocal(new BoneLocal(current.Tx + (point.X - current.Tx) * mx, current.Ty + (point.Y - current.Ty) * my, angle, scaleX, scaleY, 0, shearY));
                desired.Add(bone, nextWorld);
                if (mx != 0 || my != 0) Solvers.IncludeMax(ref translationResidual, Numeric.Hypot(mx == 0 ? 0 : nextWorld.Tx - point.X, my == 0 ? 0 : nextWorld.Ty - point.Y));
                if (mr != 0) Solvers.IncludeMax(ref rotationResidual, Math.Abs(Numeric.Wrap(Solvers.Angle(nextWorld) - (tangent ? sample.Value.Tangent : chainAngle) - offset)));
                if (chainScale && mr != 0 && setupLength != 0) Solvers.IncludeMax(ref scaleResidual, Math.Abs(Solvers.Sx(nextWorld) - Numeric.Hypot(ahead.X - point.X, ahead.Y - point.Y) / setupLength));
                if (!tangent && !chainScale && rotation == 0 && mr != 0)
                {
                    Affine rotated = Solvers.Rotate(current, Numeric.Wrap(chainAngle - oldAngle));
                    Point tip = new Point(point.X + setupLength * rotated.A, point.Y + setupLength * rotated.B);
                    previous = new PathSampler.Sample(new Point(ahead.X + (tip.X - ahead.X) * mr, ahead.Y + (tip.Y - ahead.Y) * mr), next.Value.Tangent);
                }
            }
            var affected = new bool[pose.World.Length];
            for (int i = 0; i < affected.Length; i++)
            {
                int parent = pose.Data.BoneData[i].Parent;
                if (desired.TryGetValue(i, out Affine matrix)) { affected[i] = true; Solvers.SetWorld(pose, i, matrix, root); }
                else if (parent >= 0 && affected[parent]) { affected[i] = true; pose.World[i] = Affine.Child(pose.World[parent], pose.Locals[i], pose.Modes[i]); }
            }
            pose.Diagnostics[c.S("id")] = new PathConstraintDiagnostic(desired.Count, mr, mx, my, translationResidual, rotationResidual, scaleResidual);
        }
    }
}
