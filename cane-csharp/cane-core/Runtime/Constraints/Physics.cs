using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    public readonly struct PhysicsEnvironment
    {
        public readonly float WindX, WindY, GravityX, GravityY;
        public PhysicsEnvironment(float windX, float windY, float gravityX, float gravityY)
        { WindX = windX; WindY = windY; GravityX = gravityX; GravityY = gravityY; }
        public static PhysicsEnvironment Default => new PhysicsEnvironment(1, 0, 0, 1);
    }
}
namespace Cane.Constraints
{
    internal sealed class PhysicsBudget
    {
        internal int Remaining = 1000000;
        internal void Use(string id)
        { if (Remaining == 0) throw Limit(id); Remaining--; }
        internal static RuntimeException Limit(string id) => new RuntimeException(RuntimeErrorCode.ResourceLimit, "apply", "Physics fixed-step budget is exhausted or cannot make progress.");
    }
    internal sealed class PhysicsState
    {
        internal bool Reset = true;
        internal float Ux, Uy, Cx, Cy, TipX, TipY, XOffset, YOffset, XLag, YLag, XVelocity, YVelocity;
        internal float RotateOffset, RotateLag, RotateVelocity, ScaleOffset, ScaleLag, ScaleVelocity, Remaining;
        internal PhysicsState Clone() => (PhysicsState)MemberwiseClone();
        internal bool IsFinite => Numeric.Finite(Ux) && Numeric.Finite(Uy) && Numeric.Finite(Cx) && Numeric.Finite(Cy) && Numeric.Finite(TipX) && Numeric.Finite(TipY)
            && Numeric.Finite(XOffset) && Numeric.Finite(YOffset) && Numeric.Finite(XLag) && Numeric.Finite(YLag) && Numeric.Finite(XVelocity) && Numeric.Finite(YVelocity)
            && Numeric.Finite(RotateOffset) && Numeric.Finite(RotateLag) && Numeric.Finite(RotateVelocity) && Numeric.Finite(ScaleOffset) && Numeric.Finite(ScaleLag) && Numeric.Finite(ScaleVelocity) && Numeric.Finite(Remaining);
    }
    internal sealed partial class PhysicsStore
    {
        internal readonly Dictionary<string, PhysicsState> States = new Dictionary<string, PhysicsState>(StringComparer.Ordinal);
        private string? animation;
        private float? time, rawTime;
        internal PhysicsStore Clone()
        { var result = new PhysicsStore { animation = animation, time = time, rawTime = rawTime }; foreach (var p in States) result.States.Add(p.Key, p.Value.Clone()); return result; }
        internal bool Reset(string? id = null)
        {
            if (id == null) { bool had = States.Count != 0; States.Clear(); animation = null; time = null; rawTime = null; return had; }
            if (!States.ContainsKey(id)) return false; States[id] = new PhysicsState(); return true;
        }
        internal PhysicsState State(string id)
        { if (!States.TryGetValue(id, out PhysicsState? result)) { result = new PhysicsState(); States.Add(id, result); } return result; }
        internal float Advance(Playback state, Pose pose, SamplingOptions sampling)
        {
            Entry? current = state.Tracks.TryGetValue(0, out Track? track) ? track.Current : null;
            float raw = current?.Time ?? state.DetachedTime, now = sampling.Time(raw); string? clip = current?.Clip?.Id;
            bool changed = animation != clip || rawTime.HasValue && raw < rawTime.Value;
            float? previous = changed ? null : time, previousRaw = changed ? null : rawTime;
            if (changed) States.Clear(); float delta = Math.Max(0, previous.HasValue ? now - previous.Value : now);
            animation = clip; time = now; rawTime = raw;
            if (current?.Clip != null && previousRaw.HasValue && raw > previousRaw.Value && current.Alpha * current.Progress >= 0.5f)
            {
                foreach (Json timeline in current.Clip.Raw["constraintTimelines"].Items)
                {
                    if (timeline.S("type") != "physics") continue; bool crossed = false;
                    foreach (Json key in timeline["keys"].Items)
                    {
                        if (!key.B("reset")) continue; float k = key.F("time") - current.Start;
                        if (current.Loop && current.Duration > 0)
                        { crossed |= Math.Floor(((double)previousRaw.Value - k) / current.Duration) < Math.Floor(((double)raw - k) / current.Duration); }
                        else crossed |= k > previousRaw.Value && k <= raw;
                    }
                    if (!crossed) continue; string id = timeline.S("constraintId");
                    if (id != "*") Reset(id);
                    else foreach (Json c in pose.Constraints) if (c.S("type") == "physics" && pose.IsActive(c.S("id"), "constraintIds") && pose.IsActive(c.S("boneId"), "boneIds")) Reset(c.S("id"));
                }
            }
            return delta;
        }
    }
    internal static class Physics
    {
        internal static void Solve(Pose pose, Json c, Affine root, PhysicsStore store, float delta, PhysicsEnvironment env, float rootScaleX, float rootScaleY, PhysicsBudget budget)
        {
            string id = c.S("id"), boneId = c.S("boneId"); if (!pose.IsActive(boneId, "boneIds")) return;
            PhysicsState s = store.State(id);
            float mix = c.F("mix", 1), fps = c.F("fps", 60), reference = pose.Data.ReferenceScale;
            if (mix == 0 || fps == 0 || !(reference > 0)) return;
            int bone = pose.Data.BoneIndex[boneId]; float length = Math.Max(pose.Data.BoneData[bone].Length, 0); Affine m = pose.World[bone];
            float step = 1 / fps, originX = m.Tx, originY = m.Ty, previousRemaining = s.Remaining;
            float remaining = s.Remaining + delta, planned = remaining; int count = 0;
            float x = c.F("x"), y = c.F("y"), rotate = c.F("rotate"), shear = c.F("shearX"), scaleX = c.F("scaleX");
            bool xe = x > 0, ye = y > 0, re = rotate > 0 || shear > 0, se = scaleX > 0;
            if (!s.Reset && (xe || ye || re || se))
            {
                if (!Numeric.Finite(step) || step <= 0 || !Numeric.Finite(remaining)) throw PhysicsBudget.Limit(id);
                while (planned >= step) { budget.Use(id); float next = planned - step; if (next == planned) throw PhysicsBudget.Limit(id); planned = next; count++; }
            }
            float interpolation = 0; s.Remaining = remaining; float? requiredLimit = 0; bool limitSaturated = false;
            if (s.Reset) { s.Reset = false; s.Ux = originX; s.Uy = originY; }
            else
            {
                float inertia = Numeric.Clamp(c.F("inertia", 1), 0, 1), limit = Math.Max(c.F("limit", 5000), 0);
                float xLimit = limit * delta * Math.Abs(rootScaleX), yLimit = limit * delta * Math.Abs(rootScaleY);
                float damping = (float)Math.Pow(Numeric.Clamp(c.F("damping", 1), 0, 1), 60 * step), acceleration = step / Math.Max(c.F("mass", 1), float.Epsilon), strength = Math.Max(c.F("strength", 100), 0);
                if (xe || ye)
                {
                    if (xe) { float movement = (s.Ux - originX) * inertia; ObserveLimit(movement, xLimit, delta * Math.Abs(rootScaleX), ref requiredLimit, ref limitSaturated); s.XOffset += Numeric.Clamp(movement, -xLimit, xLimit); s.Ux = originX; }
                    if (ye) { float movement = (s.Uy - originY) * inertia; ObserveLimit(movement, yLimit, delta * Math.Abs(rootScaleY), ref requiredLimit, ref limitSaturated); s.YOffset += Numeric.Clamp(movement, -yLimit, yLimit); s.Uy = originY; }
                    if (count > 0)
                    {
                        float wind = reference * c.F("wind"), gravity = reference * c.F("gravity");
                        float fx = (wind * env.WindX + gravity * env.GravityX) * rootScaleX, fy = (wind * env.WindY + gravity * env.GravityY) * rootScaleY;
                        float beforeX = s.XOffset, beforeY = s.YOffset;
                        for (int i = 0; i < count; i++)
                        {
                            if (xe) { s.XVelocity += (fx - s.XOffset * strength) * acceleration; s.XOffset += s.XVelocity * step; s.XVelocity *= damping; }
                            if (ye) { s.YVelocity -= (fy + s.YOffset * strength) * acceleration; s.YOffset += s.YVelocity * step; s.YVelocity *= damping; }
                        }
                        s.XLag = s.XOffset - beforeX; s.YLag = s.YOffset - beforeY; remaining = planned;
                    }
                    interpolation = Math.Max(1 - remaining / step, 0);
                    m = new Affine(m.A, m.B, m.C, m.D, m.Tx + (xe ? (s.XOffset - s.XLag * interpolation) * mix * x : 0), m.Ty + (ye ? (s.YOffset - s.YLag * interpolation) * mix * y : 0));
                }
                if (re || se)
                {
                    ObserveLimit(s.Cx - m.Tx, xLimit, delta * Math.Abs(rootScaleX), ref requiredLimit, ref limitSaturated);
                    ObserveLimit(s.Cy - m.Ty, yLimit, delta * Math.Abs(rootScaleY), ref requiredLimit, ref limitSaturated);
                    float axisAngle = Numeric.Atan2(m.B, m.A), tipX = Numeric.Clamp(s.Cx - m.Tx, -xLimit, xLimit), tipY = Numeric.Clamp(s.Cy - m.Ty, -yLimit, yLimit);
                    float rotateMix = (rotate + shear) * mix, co, si;
                    if (re)
                    {
                        float lag = s.RotateLag * Math.Max(1 - previousRemaining / step, 0);
                        float incoming = Numeric.Atan2(tipY + s.TipY, tipX + s.TipX) - axisAngle - (s.RotateOffset - lag) * rotateMix;
                        float wrapped = (incoming + Numeric.Pi) % (Numeric.Pi * 2); if (wrapped < 0) wrapped += Numeric.Pi * 2;
                        s.RotateOffset += (wrapped - Numeric.Pi) * inertia;
                        float angle = (s.RotateOffset - lag) * rotateMix + axisAngle; co = Numeric.Cos(angle); si = Numeric.Sin(angle);
                        if (se) { float worldLength = length * Solvers.Sx(m); if (worldLength > 0) s.ScaleOffset += (tipX * co + tipY * si) * inertia / worldLength; }
                    }
                    else
                    {
                        co = Numeric.Cos(axisAngle); si = Numeric.Sin(axisAngle);
                        float worldLength = length * Solvers.Sx(m) - s.ScaleLag * Math.Max(1 - previousRemaining / step, 0);
                        if (worldLength > 0) s.ScaleOffset += (tipX * co + tipY * si) * inertia / worldLength;
                    }
                    if (count > 0)
                    {
                        float fx = c.F("wind") * env.WindX + c.F("gravity") * env.GravityX, fy = c.F("wind") * env.WindY + c.F("gravity") * env.GravityY;
                        float lengthScale = length / reference, beforeRotate = s.RotateOffset, beforeScale = s.ScaleOffset;
                        for (int i = 0; i < count; i++)
                        {
                            if (se) { s.ScaleVelocity += (fx * co - fy * si - s.ScaleOffset * strength) * acceleration; s.ScaleOffset += s.ScaleVelocity * step; s.ScaleVelocity *= damping; }
                            if (re) { s.RotateVelocity -= ((fx * si + fy * co) * lengthScale + s.RotateOffset * strength) * acceleration; s.RotateOffset += s.RotateVelocity * step; s.RotateVelocity *= damping; }
                            if (re && i + 1 < count) { float angle = s.RotateOffset * rotateMix + axisAngle; co = Numeric.Cos(angle); si = Numeric.Sin(angle); }
                        }
                        s.RotateLag = s.RotateOffset - beforeRotate; s.ScaleLag = s.ScaleOffset - beforeScale; remaining = planned;
                    }
                    interpolation = Math.Max(1 - remaining / step, 0);
                }
                s.Remaining = remaining;
            }
            float rotationOffset = (s.RotateOffset - s.RotateLag * interpolation) * mix;
            if (rotate > 0) m = RotateRadians(m, rotationOffset * rotate, false);
            if (shear > 0) m = RotateRadians(m, rotationOffset * shear, true);
            if (scaleX > 0)
            {
                float scale = 1 + (s.ScaleOffset - s.ScaleLag * interpolation) * mix * scaleX, yScale = 1;
                if (c.S("scaleYMode", "none") == "uniform") yScale = scale;
                else if (c.S("scaleYMode") == "volume") { float absolute = Math.Abs(scale); yScale = absolute >= 0.7f ? 1 / absolute : 4 - 3.67347f * absolute; }
                m = new Affine(m.A * scale, m.B * scale, m.C * yScale, m.D * yScale, m.Tx, m.Ty);
            }
            s.Cx = originX; s.Cy = originY; s.TipX = length * m.A; s.TipY = length * m.B;
            if (!s.IsFinite || !m.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Physics state became non-finite.", entityId: id);
            Solvers.WriteWorld(pose, bone, m, root);
            pose.Diagnostics[id] = new PhysicsConstraintDiagnostic(count, s, c.F("limit", 5000), requiredLimit, limitSaturated);
        }
        private static void ObserveLimit(float movement, float limit, float denominator, ref float? required, ref bool saturated)
        {
            float magnitude = Math.Abs(movement); if (magnitude > limit) saturated = true;
            if (magnitude != 0 && required.HasValue)
            { float candidate = magnitude / denominator; required = denominator == 0 || !Numeric.Finite(candidate) ? (float?)null : Math.Max(required.Value, candidate); }
        }
        private static Affine RotateRadians(Affine m, float angle, bool firstOnly)
        {
            float co = Numeric.Cos(angle), si = Numeric.Sin(angle);
            return new Affine(co * m.A - si * m.B, si * m.A + co * m.B, firstOnly ? m.C : co * m.C - si * m.D, firstOnly ? m.D : si * m.C + co * m.D, m.Tx, m.Ty);
        }
    }
}
