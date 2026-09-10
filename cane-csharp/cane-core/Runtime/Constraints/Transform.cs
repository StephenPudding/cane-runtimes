using System;
using Cane.Animation;
using Cane.Format;

namespace Cane.Constraints
{
    internal static class Transform
    {
        private static readonly string[] Properties = { "rotate", "x", "y", "scaleX", "scaleY", "shearY" };
        private static readonly string[] Mixes = { "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY" };
        private static readonly string[] Offsets = { "rotation", "x", "y", "scaleX", "scaleY", "shearY" };
        private static readonly int[] Components = { 2, 0, 1, 3, 4, 6 };
        internal static void Solve(Pose pose, Json c, Affine root)
        {
            var mixes = new float[6]; bool active = false;
            for (int i = 0; i < 6; i++) { mixes[i] = c.F(Mixes[i], 1); active |= mixes[i] != 0; } if (!active) return;
            int target = pose.Data.BoneIndex[c.S("targetBoneId")]; Affine world = pose.World[target]; BoneLocal local = pose.Locals[target];
            Json mapping = c["mapping"]; bool relative = c.B("relative"); float[]? source = mapping.IsNull ? null : Source(c, local, world, mapping.B("localSource"));
            var fullMixes = new float[6]; for (int i = 0; i < 6; i++) fullMixes[i] = mixes[i] == 0 ? 0 : 1;
            float? translationResidual = null, rotationResidual = null, scaleResidual = null, shearResidual = null; int driven = 0;
            foreach (Json id in c["boneIds"].Items)
            {
                int bone = pose.Data.BoneIndex[id.String]; if (bone == target) continue;
                BoneLocal nextLocal = pose.Locals[bone]; Affine nextWorld = pose.World[bone];
                BoneLocal idealLocal = nextLocal; Affine idealWorld = nextWorld;
                bool localTarget = mapping.IsNull ? c.B("local") : mapping.B("localTarget");
                Project(c, mapping, source, local, world, localTarget, mixes, relative, ref nextLocal, ref nextWorld);
                Project(c, mapping, source, local, world, localTarget, fullMixes, relative, ref idealLocal, ref idealWorld);
                if (localTarget)
                {
                    Affine parent = Solvers.Parent(pose, bone, root);
                    idealWorld = pose.Data.BoneData[bone].Parent < 0 ? parent * Affine.FromLocal(idealLocal) : Affine.Child(parent, idealLocal, pose.Modes[bone]);
                    Solvers.WriteLocal(pose, bone, nextLocal, root);
                }
                else Solvers.WriteWorld(pose, bone, nextWorld, root);
                Affine actual = pose.World[bone]; driven++;
                if (mixes[1] != 0 || mixes[2] != 0) Solvers.IncludeMax(ref translationResidual, Numeric.Hypot(mixes[1] == 0 ? 0 : actual.Tx - idealWorld.Tx, mixes[2] == 0 ? 0 : actual.Ty - idealWorld.Ty));
                if (mixes[0] != 0) Solvers.IncludeMax(ref rotationResidual, Math.Abs(Solvers.Degrees(Solvers.Angle(actual) - Solvers.Angle(idealWorld))));
                if (mixes[3] != 0 || mixes[4] != 0) Solvers.IncludeMax(ref scaleResidual, Math.Max(mixes[3] == 0 ? 0 : Math.Abs(Solvers.Sx(actual) - Solvers.Sx(idealWorld)), mixes[4] == 0 ? 0 : Math.Abs(Solvers.Sy(actual) - Solvers.Sy(idealWorld))));
                if (mixes[5] != 0) Solvers.IncludeMax(ref shearResidual, Math.Abs(Solvers.Degrees(Solvers.ShearY(actual) - Solvers.ShearY(idealWorld))));
            }
            pose.Diagnostics[c.S("id")] = new TransformConstraintDiagnostic(driven, mixes, translationResidual, rotationResidual, scaleResidual, shearResidual);
        }
        private static void Project(Json c, Json mapping, float[]? source, BoneLocal targetLocal, Affine targetWorld, bool localTarget, float[] mixes, bool relative, ref BoneLocal nextLocal, ref Affine nextWorld)
        {
            if (mapping.IsNull)
            {
                if (localTarget) nextLocal = LegacyLocal(c, nextLocal, targetLocal, mixes, relative);
                else nextWorld = LegacyWorld(c, nextWorld, targetWorld, mixes, relative);
                return;
            }
            foreach (Json from in mapping["properties"].Items)
            {
                float s = source![Array.IndexOf(Properties, from.S("property"))] - from.F("offset");
                foreach (Json to in from["targets"].Items)
                {
                    int prop = Array.IndexOf(Properties, to.S("property")); float amount = mixes[prop]; if (amount == 0) continue;
                    float offset = to.F("offset"), value = offset + s * to.F("scale", 1);
                    if (mapping.B("clamp")) value = Numeric.Clamp(value, Math.Min(offset, to.F("max", 1)), Math.Max(offset, to.F("max", 1)));
                    if (localTarget)
                    {
                        int component = Components[prop]; float current = nextLocal.Get(component), next = current;
                        if (prop == 3 || prop == 4) { if (relative) next = current * (1 + (value - 1) * amount); else if (current != 0) next = current + (value - current) * amount; }
                        else next = current + (relative ? value : value - current) * amount;
                        nextLocal = nextLocal.With(component, next);
                    }
                    else nextWorld = MappedWorld(nextWorld, prop, value, amount, relative);
                }
            }
        }
        internal static TransformConstraintOffsets Match(Pose pose, Json c)
        {
            const string op = "queryMatchedTransformConstraintOffsets"; string id = c.S("id"); Json mapping = c["mapping"];
            bool localSource = c.B("local"), localTarget = localSource;
            if (!mapping.IsNull)
            {
                if (!Canonical(mapping)) throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Match requires canonical property routing.", "mapping", id);
                localSource = mapping.B("localSource"); localTarget = mapping.B("localTarget");
            }
            int sourceBone = pose.Data.BoneIndex[c.S("targetBoneId")], constrained = pose.Data.BoneIndex[c["boneIds"][0].String];
            Affine sourceWorld = pose.World[sourceBone];
            float[] desired = c.B("relative") ? new float[] { 0, 0, 0, 1, 1, 0 } : MatchValues(pose, constrained, localTarget);
            float[] source = MatchValues(pose, sourceBone, localSource);
            float x, y, rotation = Solvers.Degrees(desired[0] - source[0]);
            if (localSource) { x = desired[1] - source[1]; y = desired[2] - source[2]; }
            else
            {
                float determinant = sourceWorld.Determinant;
                // Transform Match uses the constraint inverse contract, whose threshold differs from source-vertex inverse authoring.
                if (Math.Abs(determinant) <= Numeric.Epsilon || !Numeric.Finite(determinant)) throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Source transform has no constraint inverse.", "targetBoneId", id);
                float dx = desired[1] - sourceWorld.Tx, dy = desired[2] - sourceWorld.Ty;
                x = (sourceWorld.D * dx - sourceWorld.C * dy) / determinant; y = (-sourceWorld.B * dx + sourceWorld.A * dy) / determinant;
                if (determinant < 0) rotation = -rotation;
            }
            return new TransformConstraintOffsets(id, rotation, x, y, desired[3] - source[3], desired[4] - source[4], Solvers.Degrees(desired[5] - source[5]));
        }
        private static bool Canonical(Json mapping)
        {
            if (mapping.B("clamp") || mapping["properties"].Items.Count != 6) return false;
            var seen = new bool[6];
            foreach (Json from in mapping["properties"].Items)
            {
                int index = Array.IndexOf(Properties, from.S("property"));
                if (index < 0 || seen[index] || from.F("offset") != 0 || from["targets"].Items.Count != 1) return false;
                Json to = from["targets"][0]; if (to.S("property") != from.S("property") || to.F("offset") != 0 || to.F("scale", 1) != 1) return false;
                seen[index] = true;
            }
            return true;
        }
        private static float[] MatchValues(Pose pose, int bone, bool local)
        {
            if (local) { BoneLocal p = pose.Locals[bone]; return new[] { p.RotationDegrees, p.X, p.Y, p.ScaleX, p.ScaleY, p.ShearYDegrees }; }
            Affine world = pose.World[bone]; return new[] { Solvers.Positive(Solvers.Angle(world)), world.Tx, world.Ty, Solvers.Sx(world), Solvers.Sy(world), Solvers.ShearY(world) };
        }
        private static BoneLocal LegacyLocal(Json c, BoneLocal current, BoneLocal target, float[] mix, bool relative)
        {
            BoneLocal next = current;
            for (int i = 0; i < 6; i++)
            {
                float before = current.Get(Components[i]), source = target.Get(Components[i]), offset = c.F(Offsets[i]), amount = mix[i], result;
                if (i == 3 || i == 4)
                    result = relative ? before * ((source - 1 + offset) * amount + 1) : before == 0 || amount == 0 ? before : before + (source - before + offset) * amount;
                else if (i == 0 || i == 5)
                    result = Solvers.Degrees(before + (relative ? source + offset : Solvers.Degrees(source + offset - before)) * amount);
                else result = before + (source + offset - (relative ? 0 : before)) * amount;
                next = next.With(Components[i], result);
            }
            return next;
        }
        private static Affine LegacyWorld(Json c, Affine current, Affine target, float[] mix, bool relative)
        {
            float reflection = target.Determinant < 0 ? -1 : 1;
            if (mix[0] != 0) current = Solvers.Rotate(current, Solvers.Degrees(Solvers.Angle(target) - (relative ? 0 : Solvers.Angle(current)) + c.F("rotation") * reflection) * mix[0]);
            Point translated = target.Transform(c.F("x"), c.F("y"));
            current = new Affine(current.A, current.B, current.C, current.D,
                current.Tx + (translated.X - (relative ? 0 : current.Tx)) * mix[1], current.Ty + (translated.Y - (relative ? 0 : current.Ty)) * mix[2]);
            float sx = Solvers.Sx(current), sy = Solvers.Sy(current), fx = 1, fy = 1;
            if (mix[3] != 0 && sx > Numeric.Epsilon) fx = relative ? (Solvers.Sx(target) - 1 + c.F("scaleX")) * mix[3] + 1 : (sx + (Solvers.Sx(target) - sx + c.F("scaleX")) * mix[3]) / sx;
            if (mix[4] != 0 && sy > Numeric.Epsilon) fy = relative ? (Solvers.Sy(target) - 1 + c.F("scaleY")) * mix[4] + 1 : (sy + (Solvers.Sy(target) - sy + c.F("scaleY")) * mix[4]) / sy;
            current = new Affine(current.A * fx, current.B * fx, current.C * fy, current.D * fy, current.Tx, current.Ty);
            if (mix[5] != 0)
            {
                float y = Solvers.YAngle(current), targetDelta = Solvers.Degrees(Solvers.YAngle(target) - Solvers.Angle(target));
                float delta = targetDelta - (relative ? 90 : Solvers.Degrees(y - Solvers.Angle(current))) + c.F("shearY") * reflection;
                float angle = (y + Solvers.Degrees(delta) * mix[5]) * Numeric.DegToRad, length = Solvers.Sy(current);
                current = new Affine(current.A, current.B, Numeric.Cos(angle) * length, Numeric.Sin(angle) * length, current.Tx, current.Ty);
            }
            return current;
        }
        private static float[] Source(Json c, BoneLocal local, Affine world, bool localSource)
        {
            if (localSource) { var source = new float[6]; for (int i = 0; i < 6; i++) source[i] = local.Get(Components[i]) + c.F(Offsets[i]); return source; }
            Point p = world.Transform(c.F("x"), c.F("y")); float reflection = world.Determinant < 0 ? -1 : 1;
            return new[] { Solvers.Positive(Solvers.Angle(world) + c.F("rotation") * reflection), p.X, p.Y, Solvers.Sx(world) + c.F("scaleX"), Solvers.Sy(world) + c.F("scaleY"), Solvers.Degrees(Solvers.YAngle(world) - Solvers.Angle(world) - 90 + c.F("shearY")) };
        }
        private static Affine MappedWorld(Affine current, int property, float value, float amount, bool relative)
        {
            switch (property)
            {
                case 0: return Solvers.Rotate(current, Solvers.Degrees(relative ? value : value - Solvers.Angle(current)) * amount);
                case 1: return new Affine(current.A, current.B, current.C, current.D, current.Tx + (relative ? value : value - current.Tx) * amount, current.Ty);
                case 2: return new Affine(current.A, current.B, current.C, current.D, current.Tx, current.Ty + (relative ? value : value - current.Ty) * amount);
                case 3: case 4:
                    float length = property == 3 ? Solvers.Sx(current) : Solvers.Sy(current); if (length <= Numeric.Epsilon) return current;
                    float f = relative ? 1 + (value - 1) * amount : 1 + (value - length) * amount / length;
                    return property == 3 ? new Affine(current.A * f, current.B * f, current.C, current.D, current.Tx, current.Ty) : new Affine(current.A, current.B, current.C * f, current.D * f, current.Tx, current.Ty);
                default:
                    float y = Solvers.YAngle(current), delta = relative ? value : value + 90 - Solvers.Degrees(y - Solvers.Angle(current));
                    float angle = (y + Solvers.Degrees(delta) * amount) * Numeric.DegToRad, magnitude = Solvers.Sy(current);
                    return new Affine(current.A, current.B, Numeric.Cos(angle) * magnitude, Numeric.Sin(angle) * magnitude, current.Tx, current.Ty);
            }
        }
    }
}
