using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    public sealed class BoneLocalPatch
    {
        public float? X { get; set; }
        public float? Y { get; set; }
        public float? RotationDegrees { get; set; }
        public float? ScaleX { get; set; }
        public float? ScaleY { get; set; }
        public float? ShearXDegrees { get; set; }
        public float? ShearYDegrees { get; set; }
        internal float?[] Values() => new[] { X, Y, RotationDegrees, ScaleX, ScaleY, ShearXDegrees, ShearYDegrees };
    }
    /// <summary>Ordered, reusable procedural edits. AddBoneLocal interprets every supplied channel as an additive delta.</summary>
    public sealed class PoseModifiers
    {
        internal static readonly string[] Fields = { "x", "y", "rotationDegrees", "scaleX", "scaleY", "shearXDegrees", "shearYDegrees" };
        internal readonly Json Document = new Json(new Dictionary<string, Json> { ["operations"] = new Json(new List<Json>()) });
        public int Count => Document["operations"].Items.Count;
        public void Clear() => Document["operations"].Items.Clear();
        public PoseModifiers ReplaceBoneLocal(string boneId, BoneLocal local)
        { var fields = new Dictionary<string, Json>(); for (int i = 0; i < 7; i++) fields.Add(Fields[i], new Json((double)local.Get(i))); Add("replaceBoneLocal", boneId, "local", new Json(fields)); return this; }
        public PoseModifiers PatchBoneLocal(string boneId, BoneLocalPatch patch) { AddValues("patchBoneLocal", boneId, patch, false); return this; }
        public PoseModifiers AddBoneLocal(string boneId, BoneLocalPatch delta) { AddValues("addBoneLocal", boneId, delta, true); return this; }
        public PoseModifiers PatchConstraint(string constraintId, ConstraintOverride parameters)
        {
            Document["operations"].Items.Add(new Json(new Dictionary<string, Json> { ["operation"] = new Json("patchConstraint"), ["constraintId"] = new Json(constraintId), ["parameters"] = Pose.Clone(parameters.Patch) })); return this;
        }
        private void AddValues(string operation, string boneId, BoneLocalPatch patch, bool additive)
        {
            var fields = new Dictionary<string, Json>(); float?[] values = patch.Values();
            for (int i = 0; i < values.Length; i++) if (values[i].HasValue) fields.Add(Fields[i] + (additive ? "Delta" : ""), new Json((double)values[i]!.Value));
            Add(operation, boneId, additive ? "delta" : "patch", new Json(fields));
        }
        private void Add(string operation, string boneId, string field, Json values)
        { Document["operations"].Items.Add(new Json(new Dictionary<string, Json> { ["operation"] = new Json(operation), ["boneId"] = new Json(boneId), [field] = values })); }
    }
    public sealed class EvaluationStats
    {
        public int AnimationSamples { get; internal set; }
        public int ConstraintGeometrySolves { get; internal set; }
        public int FramesPublished { get; internal set; }
        internal EvaluationStats Copy() => new EvaluationStats { AnimationSamples = AnimationSamples, ConstraintGeometrySolves = ConstraintGeometrySolves, FramesPublished = FramesPublished };
    }
    public sealed partial class RuntimePlayer
    {
        public EvaluationStats LastEvaluationStats => Frame.Stats.Copy();
        public RuntimeFrame ApplyWithModifiers(PoseModifiers modifiers, SamplingOptions sampling = default)
        { if (modifiers == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "applyWithModifiers", "Modifiers are required."); return ApplyWithModifierDocument(modifiers.Document, sampling); }
        internal RuntimeFrame ApplyWithModifierDocument(Json modifiers, SamplingOptions sampling = default)
        {
            const string op = "applyWithModifiers"; sampling.Validate(op);
            try { Playback state = playback.Clone(); RuntimeFrame frame = Evaluate(state, host, NextSequence(op), sampling, out Pose pose, modifiers, op); playback = state; Frame = frame; publishedPose = pose; return frame; }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        public RuntimeStep AdvanceWithModifiers(float deltaSeconds, PoseModifiers modifiers, SamplingOptions sampling = default)
        { if (modifiers == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "advanceWithModifiers", "Modifiers are required."); return AdvanceWithModifierDocument(deltaSeconds, modifiers.Document, sampling); }
        internal RuntimeStep AdvanceWithModifierDocument(float delta, Json modifiers, SamplingOptions sampling = default) => AdvanceInternal(delta, true, sampling, modifiers, "advanceWithModifiers");
        private void ApplyTransient(Pose pose, Json? batch, string op)
        {
            if (batch == null) return;
            Validation.Closed(batch, "operations", "operations"); int index = 0;
            foreach (Json operation in batch["operations"].Items)
            {
                string prefix = "modifiers.operations[" + index++ + "]", kind = operation.S("operation");
                if (kind == "patchConstraint")
                {
                    Validation.Closed(operation, "operation constraintId parameters", "operation constraintId parameters");
                    Json patch = NormalizeConstraintPatch(operation.S("constraintId"), operation["parameters"], op, out int constraint);
                    foreach (var p in patch.Members) pose.Constraints[constraint].Members[p.Key] = Pose.Clone(p.Value); continue;
                }
                if (kind != "replaceBoneLocal" && kind != "patchBoneLocal" && kind != "addBoneLocal") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Unknown modifier operation.", prefix + ".operation");
                bool additive = kind == "addBoneLocal", replace = kind == "replaceBoneLocal"; string field = additive ? "delta" : replace ? "local" : "patch";
                Validation.Closed(operation, "operation boneId " + field, "operation boneId " + field);
                string id = operation.S("boneId"); if (!data.BoneIndex.TryGetValue(id, out int bone)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Modifier bone is missing.", prefix + ".boneId", id);
                Json values = operation[field]; string allowed = ""; foreach (string f in PoseModifiers.Fields) allowed += f + (additive ? "Delta " : " ");
                Validation.Closed(values, allowed, replace ? allowed : ""); BoneLocal local = pose.Locals[bone];
                for (int i = 0; i < 7; i++)
                {
                    string key = PoseModifiers.Fields[i] + (additive ? "Delta" : ""); if (values[key].IsNull) { if (replace) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Replace requires all local channels.", prefix + "." + field + "." + key, id); continue; }
                    float value = values[key].Float; if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Modifier input must be finite.", prefix + "." + field + "." + key, id);
                    if (additive) value = local.Get(i) + value;
                    if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Modifier arithmetic overflowed.", prefix + "." + field + "." + key, id);
                    local = local.With(i, value);
                }
                pose.Locals[bone] = local;
            }
        }
    }
}
