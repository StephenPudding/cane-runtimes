using Cane.Animation;
using Cane.Format;

namespace Cane.Constraints
{
    internal static class Slider
    {
        internal static void Solve(Pose pose, Json c, Affine root, SamplingOptions sampling)
        {
            if (!pose.Data.Clips.TryGetValue(c.S("animationId"), out Clip? clip)) return;
            float mix = c.F("mix", 1), time = c.F("time"); if (mix == 0 || !Numeric.Finite(mix)) return;
            bool sourced = !c["sourceBoneId"].IsNull; float? sourceValue = null;
            if (sourced)
            {
                string id = c.S("sourceBoneId"); if (!pose.IsActive(id, "boneIds")) return;
                int bone = pose.Data.BoneIndex[id]; string property = c.S("sourceProperty", "rotate"); float value;
                if (c.B("local"))
                {
                    BoneLocal local = pose.Locals[bone];
                    switch (property) { case "x": value = local.X; break; case "y": value = local.Y; break; case "scaleX": value = local.ScaleX; break; case "scaleY": value = local.ScaleY; break; case "shearY": value = local.ShearYDegrees; break; default: value = local.RotationDegrees; break; }
                }
                else
                {
                    if (!root.TryInverse(out Affine inverse)) return; Affine world = inverse * pose.World[bone];
                    switch (property) { case "x": value = world.Tx; break; case "y": value = world.Ty; break; case "scaleX": value = Solvers.Sx(world); break; case "scaleY": value = Solvers.Sy(world); break; case "shearY": value = Solvers.YAngle(world) - Solvers.Angle(world) - 90; break; default: value = Solvers.Positive(Solvers.Angle(world)); break; }
                }
                sourceValue = value; time = c.F("timeOffset") + (value - c.F("sourceOffset")) * c.F("timeScale", 1);
            }
            if (!Numeric.Finite(time)) return;
            float mapped = time; bool looping = c.B("looping") && clip.Duration > 0;
            if (looping) { time %= clip.Duration; if (time < 0) time += clip.Duration; }
            else if (sourced) time = Numeric.Clamp(time, 0, clip.Duration);
            Sampling.Apply(pose, new Layer { Clip = clip, Time = sampling.Time(time), Alpha = mix, Additive = c.B("additive"), Stepped = sampling.Stepped });
            pose.ResolveAttachments(); if (clip.Bones.Count != 0) pose.UpdateWorld(root);
            pose.SliderTimes[c.S("id")] = time;
            pose.Diagnostics[c.S("id")] = new SliderConstraintDiagnostic(sourceValue, mapped, time, clip.Duration, looping && mapped != time, !looping && sourced && mapped != time);
        }
    }
}
