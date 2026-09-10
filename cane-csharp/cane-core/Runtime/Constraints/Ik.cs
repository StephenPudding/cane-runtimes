using System;
using Cane.Animation;
using Cane.Format;

namespace Cane.Constraints
{
    internal static class Ik
    {
        internal static void Solve(Pose pose, Json c, Affine root)
        {
            var chain = new int[c["chainBoneIds"].Items.Count]; for (int i = 0; i < chain.Length; i++) chain[i] = pose.Data.BoneIndex[c["chainBoneIds"][i].String];
            Point target;
            if (c["targetBoneId"].IsNull) target = new Point(c["target"].F("x"), c["target"].F("y"));
            else { Affine t = pose.World[pose.Data.BoneIndex[c.S("targetBoneId")]]; target = new Point(t.Tx, t.Ty); }
            float mix = Numeric.Clamp(c.F("mix", 1), 0, 1);
            int used;
            if (chain.Length == 1 && One(pose, chain[0], target, c, root, mix)) used = 1;
            else if (chain.Length == 2 && Two(pose, chain[0], chain[1], target, c, root, mix)) used = 1;
            else used = Ccd(pose, chain, target, c, root, mix);
            Point tip = Tip(pose, chain[chain.Length - 1]);
            pose.Diagnostics[c.S("id")] = new IkConstraintDiagnostic(Numeric.Hypot(tip.X - target.X, tip.Y - target.Y), Math.Max(0, c.F("threshold")), used, c.I("iterations"), mix);
        }
        private static Point Tip(Pose pose, int bone) => pose.World[bone].Transform(pose.Data.BoneData[bone].Length, 0);
        private static float ScaleY(float previous, float multiplier, Json uniform)
        {
            if (uniform.Value is bool b) return b ? previous * multiplier : previous;
            return previous / (multiplier < 0.7f ? 0.25f + 0.642857f * multiplier : multiplier);
        }
        private static bool One(Pose pose, int index, Point target, Json c, Affine root, float mix)
        {
            if (!Solvers.Inverse(Solvers.Parent(pose, index, root), out Affine inverse)) return false;
            BoneLocal current = pose.Locals[index]; Point local = inverse.Transform(target.X, target.Y);
            float x = local.X - current.X, y = local.Y - current.Y, distance = Numeric.Hypot(x, y);
            if (distance <= 0.001f) return false;
            float desired = Numeric.Atan2(y, x) * Numeric.RadToDeg - current.ShearXDegrees;
            if (current.ScaleX < 0) desired = Solvers.Degrees(desired + 180);
            BoneLocal next = current.With(2, Solvers.Degrees(current.RotationDegrees + Solvers.Degrees(desired - current.RotationDegrees) * mix));
            float scaledLength = Math.Abs(pose.Data.BoneData[index].Length * current.ScaleX);
            if (scaledLength > 0.001f && ((c.B("compress") && distance < scaledLength) || (c.B("stretch") && distance > scaledLength)))
            {
                float m = (distance / scaledLength - 1) * mix + 1;
                next = next.With(3, current.ScaleX * m).With(4, ScaleY(current.ScaleY, m, c["uniform"]));
            }
            pose.Locals[index] = next; pose.UpdateWorld(root); return true;
        }
        private static float Inherited(Pose pose, int bone, Affine root)
        { string mode = pose.Modes[bone]; return pose.Data.BoneData[bone].Parent < 0 ? Solvers.Angle(root) : mode == "onlyTranslation" || mode == "noRotationOrReflection" ? 0 : Solvers.Angle(Solvers.Parent(pose, bone, root)); }
        private static bool Two(Pose pose, int parent, int child, Point target, Json c, Affine root, float mix)
        {
            BoneLocal p = pose.Locals[parent], b = pose.Locals[child]; bool uniform = Math.Abs(Math.Abs(p.ScaleX) - Math.Abs(p.ScaleY)) <= 0.000001f;
            p = p.With(5, 0).With(6, 0); if (!uniform || c.B("stretch")) b = b.With(1, 0);
            pose.Locals[parent] = p; pose.Locals[child] = b; pose.UpdateWorld(root);
            Affine wp = pose.World[parent], wc = pose.World[child]; Point tip = Tip(pose, child);
            float x1 = wc.Tx - wp.Tx, y1 = wc.Ty - wp.Ty, x2 = tip.X - wc.Tx, y2 = tip.Y - wc.Ty;
            float l1 = Numeric.Hypot(x1, y1), l2 = Numeric.Hypot(x2, y2);
            if (l1 <= 0.001f || l2 <= 0.001f) return One(pose, parent, target, c, root, mix);
            float parentOffset = Solvers.Degrees(Numeric.Atan2(y1, x1) * Numeric.RadToDeg - Solvers.Angle(wp));
            float childOffset = Solvers.Degrees(Numeric.Atan2(y2, x2) * Numeric.RadToDeg - Solvers.Angle(wc));
            float qx = target.X - wp.Tx, qy = target.Y - wp.Ty, distance = Numeric.Hypot(qx, qy), softness = c.F("softness");
            if (distance <= 0.001f) return false;
            if (softness > 0.000001f)
            {
                float scale = Math.Max((Math.Abs(Solvers.Sx(wp)) + Math.Abs(Solvers.Sx(wc))) * 0.5f, 0.000001f);
                float soft = softness * scale, softDelta = distance - l1 - l2 + soft;
                if (softDelta > 0) { float f = Math.Min(softDelta / (soft * 2), 1) - 1; f = (softDelta - soft * (1 - f * f)) / distance; qx -= f * qx; qy -= f * qy; distance = Numeric.Hypot(qx, qy); }
            }
            bool inherits = pose.Modes[child] == "normal" || pose.Modes[child] == "noRotationOrReflection";
            float request = 0, max = l1 + l2, min = Math.Abs(l1 - l2);
            if (c.B("stretch") && uniform && softness <= 0 && distance > max + 0.000001f) request = inherits ? distance / max : (distance - l2) / l1;
            else if (c.B("compress") && distance < min - 0.000001f) request = inherits ? distance / min : l1 >= l2 ? (distance + l2) / l1 : (l2 - distance) / l1;
            if (Numeric.Finite(request) && request > 0.000001f)
            {
                float m = (request - 1) * mix + 1; p = p.With(3, p.ScaleX * m).With(4, ScaleY(p.ScaleY, m, c["uniform"])); l1 *= m; if (inherits) l2 *= m;
            }
            distance = Math.Max(distance, 0.001f);
            float cosine = Numeric.Clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1);
            float angleChild = (float)Math.Acos(cosine) * (c.B("bendPositive", true) ? 1 : -1);
            float angleParent = Numeric.Atan2(qy, qx) - Numeric.Atan2(l2 * Numeric.Sin(angleChild), l1 + l2 * Numeric.Cos(angleChild));
            float desired = Solvers.Degrees(Solvers.Degrees(angleParent * Numeric.RadToDeg - parentOffset) - Inherited(pose, parent, root));
            p = p.With(2, Solvers.Degrees(p.RotationDegrees + Solvers.Degrees(desired - p.RotationDegrees) * mix)); pose.Locals[parent] = p; pose.UpdateWorld(root);
            desired = Solvers.Degrees(Solvers.Degrees((angleParent + angleChild) * Numeric.RadToDeg - childOffset) - Inherited(pose, child, root));
            b = b.With(2, Solvers.Degrees(b.RotationDegrees + Solvers.Degrees(desired - b.RotationDegrees) * mix)); pose.Locals[child] = b; pose.UpdateWorld(root); return true;
        }
        private static int Ccd(Pose pose, int[] chain, Point target, Json c, Affine root, float mix)
        {
            var before = new float[chain.Length]; for (int i = 0; i < chain.Length; i++) before[i] = pose.Locals[chain[i]].RotationDegrees;
            int last = chain[chain.Length - 1], used = 0; float threshold = Math.Max(0, c.F("threshold")); bool done = false;
            for (int iteration = 0; iteration < c.I("iterations"); iteration++)
            {
                Point effector = Tip(pose, last); if (Numeric.Hypot(effector.X - target.X, effector.Y - target.Y) <= threshold) break;
                used = iteration + 1; bool changed = false;
                for (int i = chain.Length - 1; i >= 0; i--)
                {
                    int bone = chain[i]; Affine pivot = pose.World[bone]; effector = Tip(pose, last);
                    float fx = effector.X - pivot.Tx, fy = effector.Y - pivot.Ty, tx = target.X - pivot.Tx, ty = target.Y - pivot.Ty;
                    if (fx * fx + fy * fy <= 0.000001f || tx * tx + ty * ty <= 0.000001f) continue;
                    float delta = Numeric.Atan2(fx * ty - fy * tx, fx * tx + fy * ty) * Numeric.RadToDeg; if (Math.Abs(delta) <= 0.00001f) continue;
                    pose.Locals[bone] = pose.Locals[bone].With(2, pose.Locals[bone].RotationDegrees + delta); pose.UpdateWorld(root); changed = true;
                    effector = Tip(pose, last); if (Numeric.Hypot(effector.X - target.X, effector.Y - target.Y) <= threshold) { done = true; break; }
                }
                if (done || !changed) break;
            }
            if (mix < 1) { for (int i = 0; i < chain.Length; i++) { BoneLocal b = pose.Locals[chain[i]]; pose.Locals[chain[i]] = b.With(2, before[i] + Solvers.Degrees(b.RotationDegrees - before[i]) * mix); } pose.UpdateWorld(root); }
            return used;
        }
    }
}
