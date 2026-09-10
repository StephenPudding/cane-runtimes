using System;
using Cane.Animation;
using Cane.Format;

namespace Cane.Constraints
{
    internal static class Solvers
    {
        internal static float Degrees(float value) { float r = value % 360; if (r < 0) r += 360; return r > 180 ? r - 360 : r; }
        internal static float Positive(float value) { float r = value % 360; return r < 0 ? r + 360 : r; }
        internal static float Angle(Affine m) => Numeric.Atan2(m.B, m.A) * Numeric.RadToDeg;
        internal static float YAngle(Affine m) => Numeric.Atan2(m.D, m.C) * Numeric.RadToDeg;
        internal static float Sx(Affine m) => Numeric.Hypot(m.A, m.B);
        internal static float Sy(Affine m) => Numeric.Hypot(m.C, m.D);
        internal static float ShearY(Affine m) => Degrees(Numeric.Atan2(-m.C, m.D) * Numeric.RadToDeg - Angle(m));
        internal static void IncludeMax(ref float? maximum, float value) => maximum = maximum.HasValue ? Math.Max(maximum.Value, value) : value;
        internal static bool Inverse(Affine m, out Affine inverse)
        { if (Math.Abs(m.Determinant) <= Numeric.Epsilon) { inverse = default; return false; } return m.TryInverse(out inverse); }
        internal static Affine Parent(Pose pose, int bone, Affine root) => pose.Data.BoneData[bone].Parent < 0 ? root : pose.World[pose.Data.BoneData[bone].Parent];
        internal static void Solve(Pose pose, Affine root, SamplingOptions sampling, PhysicsStore physics, float delta, PhysicsEnvironment environment, float rootScaleX, float rootScaleY, PhysicsBudget budget)
        {
            foreach (Json constraint in pose.Constraints)
            {
                if (!pose.IsActive(constraint.S("id"), "constraintIds")) continue;
                string? target = constraint["targetBoneId"].StringOrNull;
                if (target != null && !pose.IsActive(target, "boneIds")) continue;
                switch (constraint.S("type"))
                {
                    case "ik": if (constraint.F("mix", 1) != 0) Ik.Solve(pose, constraint, root); break;
                    case "transform": Transform.Solve(pose, constraint, root); break;
                    case "path":
                        if (constraint.F("mixRotate", 1) != 0 || constraint.F("mixX", 1) != 0 || constraint.F("mixY", 1) != 0) PathConstraint.Solve(pose, constraint, root);
                        break;
                    case "physics": Physics.Solve(pose, constraint, root, physics, delta, environment, rootScaleX, rootScaleY, budget); break;
                    case "slider": if (constraint.F("mix", 1) != 0) Slider.Solve(pose, Pose.CopyConstraintState(constraint), root, sampling); break;
                }
            }
        }
        internal static void WriteLocal(Pose pose, int bone, BoneLocal local, Affine root)
        {
            pose.Locals[bone] = local; int parent = pose.Data.BoneData[bone].Parent;
            pose.World[bone] = parent < 0 ? root * Affine.FromLocal(local) : Affine.Child(pose.World[parent], local, pose.Modes[bone]);
            RefreshDescendants(pose, bone);
        }
        internal static void WriteWorld(Pose pose, int bone, Affine matrix, Affine root)
        { SetWorld(pose, bone, matrix, root); RefreshDescendants(pose, bone); }
        internal static void SetWorld(Pose pose, int bone, Affine matrix, Affine root)
        {
            if (!matrix.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Constraint produced a non-finite matrix.", "bones", pose.Data.BoneData[bone].Id);
            pose.World[bone] = matrix;
            if (Reconstruct(pose.Locals[bone], matrix, Parent(pose, bone, root), pose.Data.BoneData[bone].Parent < 0 ? "normal" : pose.Modes[bone], out BoneLocal local)) pose.Locals[bone] = local;
        }
        internal static void RefreshDescendants(Pose pose, int start)
        {
            var changed = new bool[pose.World.Length]; changed[start] = true;
            for (int i = start + 1; i < changed.Length; i++)
            {
                int parent = pose.Data.BoneData[i].Parent;
                if (parent >= 0 && changed[parent]) { changed[i] = true; pose.World[i] = Affine.Child(pose.World[parent], pose.Locals[i], pose.Modes[i]); }
            }
            for (int i = start; i < changed.Length; i++) if (changed[i] && !pose.World[i].IsFinite)
                throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Constraint hierarchy overflowed.", "bones", pose.Data.BoneData[i].Id);
        }
        private static bool Reconstruct(BoneLocal previous, Affine world, Affine parent, string mode, out BoneLocal local)
        {
            local = previous; if (!Inverse(parent, out Affine inverse)) return false;
            Point position = inverse.Transform(world.Tx, world.Ty); Affine axes;
            float rotationBase = 0;
            if (mode == "normal") axes = inverse * world;
            else if (mode == "onlyTranslation") axes = world;
            else if (mode == "noRotationOrReflection")
            {
                Affine basis = Affine.Child(parent, BoneLocal.Identity, mode);
                if (!Inverse(basis, out Affine invBasis)) return false; axes = invBasis * world;
            }
            else
            {
                // Only no-scale inheritance depends nonlinearly on the local rotation.
                float desired = Angle(world), rotation = previous.RotationDegrees;
                for (int i = 0; i < 12; i++)
                {
                    Affine current = Affine.Child(parent, previous.With(2, rotation), mode);
                    if (Sx(current) <= 0.00001f) return false;
                    float error = Degrees(desired - Angle(current)); if (Math.Abs(error) <= 0.0001f) break;
                    Affine perturbed = Affine.Child(parent, previous.With(2, rotation + 0.01f), mode);
                    float derivative = Degrees(Angle(perturbed) - Angle(current)) / 0.01f;
                    if (Math.Abs(derivative) <= 0.00001f) return false;
                    rotation += Numeric.Clamp(error / derivative, -45, 45);
                }
                rotationBase = rotation;
                Affine basis = Affine.Child(parent, new BoneLocal(0, 0, rotation), mode);
                if (Sx(basis) <= 0.00001f || !Inverse(basis, out Affine invBasis)) return false;
                axes = invBasis * world;
            }
            float signX = previous.ScaleX < 0 ? -1 : 1, signY = previous.ScaleY < 0 ? -1 : 1;
            float scaleX = Sx(axes) * signX, scaleY = Sy(axes) * signY;
            if (Math.Abs(scaleX) <= Numeric.Epsilon || Math.Abs(scaleY) <= Numeric.Epsilon) return false;
            float rotationLocal = Numeric.Atan2(axes.B * signX, axes.A * signX) * Numeric.RadToDeg - previous.ShearXDegrees;
            float angleY = Numeric.Atan2(-axes.C * signY, axes.D * signY) * Numeric.RadToDeg;
            local = new BoneLocal(position.X, position.Y, Degrees(rotationBase + rotationLocal), scaleX, scaleY, previous.ShearXDegrees, Degrees(angleY - rotationLocal));
            return Affine.FromLocal(local).IsFinite;
        }
        internal static Affine Rotate(Affine m, float angle)
        {
            float co = Numeric.Cos(angle * Numeric.DegToRad), si = Numeric.Sin(angle * Numeric.DegToRad);
            return new Affine(co * m.A - si * m.B, si * m.A + co * m.B, co * m.C - si * m.D, si * m.C + co * m.D, m.Tx, m.Ty);
        }
    }
}
