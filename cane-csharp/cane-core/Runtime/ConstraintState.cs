using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    public abstract class ConstraintParameters
    {
        private readonly Json values;
        public string Kind { get; }
        internal ConstraintParameters(Json sampled, string fields)
        {
            Kind = sampled.S("type"); values = new Json(new Dictionary<string, Json> { ["type"] = new Json(Kind) });
            foreach (string field in fields.Split(' '))
            {
                string source = field == "rotationDegrees" ? "rotation" : field == "shearYDegrees" ? "shearY" : field;
                float value = Sampling.ConstraintValue(sampled, source);
                if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "queryConstraintState", "Sampled constraint parameter is non-finite.", field, sampled.S("id"));
                values.Members[field] = new Json((double)value);
            }
            if (Kind == "ik")
            {
                values.Members["target"] = Pose.Clone(sampled["target"]);
                values.Members["bendPositive"] = new Json(sampled.B("bendPositive", true));
                values.Members["compress"] = new Json(sampled.B("compress")); values.Members["stretch"] = new Json(sampled.B("stretch"));
                if (!Numeric.Finite(Target.X) || !Numeric.Finite(Target.Y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "queryConstraintState", "Sampled IK target is non-finite.", "target", sampled.S("id"));
            }
        }
        protected float Number(string field) => values.F(field);
        protected bool Flag(string field) => values.B(field);
        protected Point Target => new Point(values["target"].F("x"), values["target"].F("y"));
        public ConstraintOverride ToOverride()
        {
            var result = new ConstraintOverride(Kind);
            foreach (var pair in values.Members) result.Patch.Members[pair.Key] = Pose.Clone(pair.Value);
            return result;
        }
        internal static ConstraintParameters From(Json sampled)
        {
            switch (sampled.S("type"))
            {
                case "ik": return new IkConstraintParameters(sampled);
                case "transform": return new TransformConstraintParameters(sampled);
                case "path": return new PathConstraintParameters(sampled);
                case "physics": return new PhysicsConstraintParameters(sampled);
                case "slider": return new SliderConstraintParameters(sampled);
                default: throw new RuntimeException(RuntimeErrorCode.InvalidState, "queryConstraintState", "Unknown sampled constraint kind.", entityId: sampled.S("id"));
            }
        }
    }
    public sealed class IkConstraintParameters : ConstraintParameters
    {
        internal IkConstraintParameters(Json c) : base(c, "mix softness") { }
        public new Point Target => base.Target;
        public float Mix => Number("mix");
        public float Softness => Number("softness");
        public bool BendPositive => Flag("bendPositive");
        public bool Compress => Flag("compress");
        public bool Stretch => Flag("stretch");
    }
    public sealed class TransformConstraintParameters : ConstraintParameters
    {
        internal TransformConstraintParameters(Json c) : base(c, "rotationDegrees x y scaleX scaleY shearYDegrees mixRotate mixX mixY mixScaleX mixScaleY mixShearY") { }
        public float RotationDegrees => Number("rotationDegrees");
        public float X => Number("x");
        public float Y => Number("y");
        public float ScaleX => Number("scaleX");
        public float ScaleY => Number("scaleY");
        public float ShearYDegrees => Number("shearYDegrees");
        public float MixRotate => Number("mixRotate");
        public float MixX => Number("mixX");
        public float MixY => Number("mixY");
        public float MixScaleX => Number("mixScaleX");
        public float MixScaleY => Number("mixScaleY");
        public float MixShearY => Number("mixShearY");
    }
    public sealed class PathConstraintParameters : ConstraintParameters
    {
        internal PathConstraintParameters(Json c) : base(c, "rotationDegrees position spacing mixRotate mixX mixY") { }
        public float RotationDegrees => Number("rotationDegrees");
        public float Position => Number("position");
        public float Spacing => Number("spacing");
        public float MixRotate => Number("mixRotate");
        public float MixX => Number("mixX");
        public float MixY => Number("mixY");
    }
    public sealed class PhysicsConstraintParameters : ConstraintParameters
    {
        internal PhysicsConstraintParameters(Json c) : base(c, "x y rotate scaleX shearX limit fps inertia strength damping mass wind gravity mix") { }
        public float X => Number("x");
        public float Y => Number("y");
        public float Rotate => Number("rotate");
        public float ScaleX => Number("scaleX");
        public float ShearX => Number("shearX");
        public float Limit => Number("limit");
        public float Fps => Number("fps");
        public float Inertia => Number("inertia");
        public float Strength => Number("strength");
        public float Damping => Number("damping");
        public float Mass => Number("mass");
        public float Wind => Number("wind");
        public float Gravity => Number("gravity");
        public float Mix => Number("mix");
    }
    public sealed class SliderConstraintParameters : ConstraintParameters
    {
        internal SliderConstraintParameters(Json c) : base(c, "sourceOffset timeOffset timeScale rangeMax time mix") { }
        public float SourceOffset => Number("sourceOffset");
        public float TimeOffset => Number("timeOffset");
        public float TimeScale => Number("timeScale");
        public float RangeMax => Number("rangeMax");
        public float Time => Number("time");
        public float Mix => Number("mix");
    }
    public sealed class ConstraintState
    {
        public string ConstraintId { get; }
        public string Kind => SampledParameters.Kind;
        public ConstraintParameters SampledParameters { get; }
        public float? SampledSliderTimeSeconds { get; }
        public ConstraintDiagnostic? Diagnostic { get; }
        internal ConstraintState(string id, ConstraintParameters parameters, float? sliderTime, ConstraintDiagnostic? diagnostic)
        { ConstraintId = id; SampledParameters = parameters; SampledSliderTimeSeconds = sliderTime; Diagnostic = diagnostic; }
    }
    public sealed partial class RuntimePlayer
    {
        public ConstraintState QueryConstraintState(string constraintId)
        {
            const string op = "queryConstraintState"; Json sampled = SampledConstraint(constraintId, op);
            publishedPose.Diagnostics.TryGetValue(constraintId, out ConstraintDiagnostic? diagnostic);
            if (diagnostic != null && diagnostic.Kind != sampled.S("type")) throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Diagnostic kind differs from sampled constraint.", entityId: constraintId);
            float? time = publishedPose.SliderTimes.TryGetValue(constraintId, out float value) ? value : (float?)null;
            return new ConstraintState(constraintId, ConstraintParameters.From(sampled), time, diagnostic);
        }
        private Json SampledConstraint(string id, string operation, string? kind = null)
        {
            int index = id == null ? -1 : Array.FindIndex(data.Constraints, c => c.S("id") == id);
            if (index < 0) throw new RuntimeException(RuntimeErrorCode.NotFound, operation, "Constraint is missing.", entityId: id);
            Json result = publishedPose.Constraints[index];
            if (kind != null && result.S("type") != kind) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Constraint kind is not " + kind + ".", "constraintId", id);
            return result;
        }
    }
}
