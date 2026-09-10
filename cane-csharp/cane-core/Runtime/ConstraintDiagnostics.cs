using System;

namespace Cane
{
    public abstract class ConstraintDiagnostic
    {
        public string Kind { get; }
        internal ConstraintDiagnostic(string kind) { Kind = kind; }
        protected static float Finite(float value)
        { if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Constraint diagnostic is non-finite.", "diagnostic"); return value; }
        protected static float? Finite(float? value) => value.HasValue ? Finite(value.Value) : (float?)null;
    }
    public sealed class IkConstraintDiagnostic : ConstraintDiagnostic
    {
        public float Residual { get; }
        public float Threshold { get; }
        public int IterationsUsed { get; }
        public int IterationLimit { get; }
        public bool Saturated { get; }
        internal IkConstraintDiagnostic(float residual, float threshold, int used, int limit, float mix) : base("ik")
        { Residual = Finite(residual); Threshold = Finite(threshold); IterationsUsed = used; IterationLimit = limit; Saturated = mix >= .999f && residual > Math.Max(threshold, .0001f); }
    }
    public sealed class TransformConstraintDiagnostic : ConstraintDiagnostic
    {
        public int DrivenBoneCount { get; }
        public float MixRotate { get; }
        public float MixX { get; }
        public float MixY { get; }
        public float MixScaleX { get; }
        public float MixScaleY { get; }
        public float MixShearY { get; }
        public float? MaxTranslationResidual { get; }
        public float? MaxRotationResidualDegrees { get; }
        public float? MaxScaleResidual { get; }
        public float? MaxShearResidualDegrees { get; }
        internal TransformConstraintDiagnostic(int count, float[] mixes, float? translation, float? rotation, float? scale, float? shear) : base("transform")
        {
            DrivenBoneCount = count; MixRotate = Finite(mixes[0]); MixX = Finite(mixes[1]); MixY = Finite(mixes[2]); MixScaleX = Finite(mixes[3]); MixScaleY = Finite(mixes[4]); MixShearY = Finite(mixes[5]);
            MaxTranslationResidual = Finite(translation); MaxRotationResidualDegrees = Finite(rotation); MaxScaleResidual = Finite(scale); MaxShearResidualDegrees = Finite(shear);
        }
    }
    public sealed class PathConstraintDiagnostic : ConstraintDiagnostic
    {
        public int DrivenBoneCount { get; }
        public float MixRotate { get; }
        public float MixX { get; }
        public float MixY { get; }
        public float? MaxTranslationResidual { get; }
        public float? MaxRotationResidualDegrees { get; }
        public float? MaxScaleResidual { get; }
        internal PathConstraintDiagnostic(int count, float rotate, float x, float y, float? translation, float? rotation, float? scale) : base("path")
        { DrivenBoneCount = count; MixRotate = Finite(rotate); MixX = Finite(x); MixY = Finite(y); MaxTranslationResidual = Finite(translation); MaxRotationResidualDegrees = Finite(rotation); MaxScaleResidual = Finite(scale); }
    }
    public sealed class PhysicsConstraintDiagnostic : ConstraintDiagnostic
    {
        public int FixedSteps { get; }
        public float TranslationOffset { get; }
        public float TranslationSpeed { get; }
        public float RotationOffsetDegrees { get; }
        public float AngularSpeedDegrees { get; }
        public float ScaleOffset { get; }
        public float ScaleSpeed { get; }
        public float ConfiguredLimit { get; }
        public float? RequiredLimit { get; }
        public bool LimitSaturated { get; }
        internal PhysicsConstraintDiagnostic(int steps, Constraints.PhysicsState s, float limit, float? required, bool saturated) : base("physics")
        {
            FixedSteps = steps; TranslationOffset = Finite(Numeric.Hypot(s.XOffset, s.YOffset)); TranslationSpeed = Finite(Numeric.Hypot(s.XVelocity, s.YVelocity));
            RotationOffsetDegrees = Finite(s.RotateOffset * Numeric.RadToDeg); AngularSpeedDegrees = Finite(s.RotateVelocity * Numeric.RadToDeg);
            ScaleOffset = Finite(s.ScaleOffset); ScaleSpeed = Finite(s.ScaleVelocity); ConfiguredLimit = Finite(limit); RequiredLimit = Finite(required); LimitSaturated = saturated;
        }
    }
    public sealed class SliderConstraintDiagnostic : ConstraintDiagnostic
    {
        public float? SourceValue { get; }
        public float MappedTimeSeconds { get; }
        public float ResolvedTimeSeconds { get; }
        public float TargetDurationSeconds { get; }
        public bool Wrapped { get; }
        public bool Clamped { get; }
        internal SliderConstraintDiagnostic(float? source, float mapped, float resolved, float duration, bool wrapped, bool clamped) : base("slider")
        { SourceValue = Finite(source); MappedTimeSeconds = Finite(mapped); ResolvedTimeSeconds = Finite(resolved); TargetDurationSeconds = Finite(duration); Wrapped = wrapped; Clamped = clamped; }
    }
}
