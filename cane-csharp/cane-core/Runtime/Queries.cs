using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;
using Cane.Geometry;

namespace Cane
{
    public sealed class AttachmentGeometry
    {
        public string AttachmentId { get; }
        public string Kind { get; }
        public IReadOnlyList<float> WorldVerticesXy { get; }
        public bool? Closed { get; }
        internal AttachmentGeometry(string id, string kind, float[] vertices, bool? closed)
        { AttachmentId = id; Kind = kind; WorldVerticesXy = Array.AsReadOnly(vertices); Closed = closed; }
    }
    public sealed class SlotState
    {
        public string SlotId { get; }
        public string? AttachmentKey { get; }
        public string? AttachmentId { get; }
        public FinalTint Tint { get; }
        public int DrawIndex { get; }
        internal SlotState(string id, string? key, string? attachment, FinalTint tint, int drawIndex)
        { SlotId = id; AttachmentKey = key; AttachmentId = attachment; Tint = tint; DrawIndex = drawIndex; }
    }
    public readonly struct PointAttachmentPose
    {
        public readonly string AttachmentId;
        public readonly float X, Y, RotationDegrees;
        // SDK conveniences from the same publication; normalized wire fields are unchanged.
        public readonly Affine Matrix;
        public readonly string SlotId;
        public readonly bool Active, Selected;
        internal PointAttachmentPose(string id, float x, float y, float rotation, Affine matrix, string slotId, bool active, bool selected)
        { AttachmentId = id; X = x; Y = y; RotationDegrees = rotation; Matrix = matrix; SlotId = slotId; Active = active; Selected = selected; }
    }
    public sealed class ConstraintOverride
    {
        internal readonly Json Patch;
        public ConstraintOverride(string type) { Patch = new Json(new Dictionary<string, Json>(StringComparer.Ordinal) { ["type"] = new Json(type) }); }
        public ConstraintOverride Set(string property, float value) { Numeric.RequireFinite(value, "setConstraintOverride", property); Patch.Members[property] = new Json((double)value); return this; }
        public ConstraintOverride Set(string property, bool value) { Patch.Members[property] = new Json(value); return this; }
        public ConstraintOverride SetTarget(Point target)
        { Numeric.RequireFinite(target.X, "setConstraintOverride", "target.x"); Numeric.RequireFinite(target.Y, "setConstraintOverride", "target.y"); Patch.Members["target"] = new Json(new Dictionary<string, Json> { ["x"] = new Json((double)target.X), ["y"] = new Json((double)target.Y) }); return this; }
    }
    public sealed partial class RuntimePlayer
    {
        public BonePose QueryBonePose(string boneId)
            => Frame.Bones[Id(data.BoneIndex, boneId, "queryBonePose", null)];
        public bool QueryBoneActive(string boneId)
        {
            int index = Id(data.BoneIndex, boneId, "queryBoneActive", null);
            return publishedPose.IsActive(data.BoneData[index].Id, "boneIds");
        }
        public AttachmentGeometry QueryAttachmentGeometry(string attachmentId)
        {
            const string op = "queryAttachmentGeometry";
            int index = Id(data.AttachmentIndex, attachmentId, op, null);
            var a = data.AttachmentData[index]; if (a.Kind != "path" && a.Kind != "boundingbox" && a.Kind != "clipping") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Attachment has no non-renderable vertex geometry.", "attachmentId", attachmentId);
            try { return new AttachmentGeometry(attachmentId, a.Kind == "boundingbox" ? "boundingBox" : a.Kind, Rendering.WorldVertices(publishedPose, a), a.Kind == "path" ? a.Raw.B("closed") : (bool?)null); }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        public SlotState QuerySlotState(string slotId)
        {
            int index = Id(data.SlotIndex, slotId, "querySlotState", null);
            return PublishedSlotState(index, Array.IndexOf(publishedPose.Order, index));
        }
        // Owned SDK conveniences; no sampling, publication or normative DTO changes.
        public IReadOnlyList<SlotState> QuerySlotStates()
        {
            var result = new SlotState[publishedPose.Order.Length];
            for (int i = 0; i < result.Length; i++) result[i] = PublishedSlotState(publishedPose.Order[i], i);
            return Array.AsReadOnly(result);
        }
        public BonePose QuerySlotBonePose(string slotId)
            => Frame.Bones[data.SlotData[Id(data.SlotIndex, slotId, "querySlotBonePose", null)].Bone];
        private SlotState PublishedSlotState(int index, int drawIndex)
        {
            SlotPose s = publishedPose.Slots[index]; string? attachment = s.ResolvedAttachment < 0 ? null : data.AttachmentData[s.ResolvedAttachment].Id;
            return new SlotState(data.SlotData[index].Id, s.Key, attachment, new FinalTint(s.Light, s.Alpha, s.Dark), drawIndex);
        }
        public PointAttachmentPose QueryPointAttachmentPose(string attachmentId)
        {
            const string op = "queryPointAttachmentPose";
            int index = Id(data.AttachmentIndex, attachmentId, op, null);
            var a = data.AttachmentData[index]; if (a.Kind != "point") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Attachment is not a point.", "attachmentId", attachmentId);
            Affine parent = publishedPose.World[data.SlotData[a.Slot].Bone]; float rotation = a.Raw.F("rotation") * Numeric.DegToRad;
            Point point = parent.Transform(a.Raw.F("x"), a.Raw.F("y")), direction = parent.TransformDirection(Numeric.Cos(rotation), Numeric.Sin(rotation));
            Deformation.Check(point, a, op, "position"); Deformation.Check(direction, a, op, "rotationDegrees");
            float degrees = Numeric.Atan2(direction.Y, direction.X) * Numeric.RadToDeg;
            if (!Numeric.Finite(degrees)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Point rotation is non-finite.", "rotationDegrees", attachmentId);
            Affine matrix = parent * Affine.FromLocal(publishedPose.Regions[index]);
            if (!matrix.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Point matrix is non-finite.", "matrix", attachmentId);
            string boneId = data.BoneData[data.SlotData[a.Slot].Bone].Id;
            return new PointAttachmentPose(a.Id, point.X, point.Y, degrees, matrix, data.SlotData[a.Slot].Id,
                publishedPose.IsActive(boneId, "boneIds"), publishedPose.Slots[a.Slot].ResolvedAttachment == index);
        }
        public RuntimeFrame SetConstraintOverride(string constraintId, ConstraintOverride parameters)
        { if (parameters == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setConstraintOverride", "Parameters are required."); return SetConstraintPatch(constraintId, parameters.Patch); }
        internal RuntimeFrame SetConstraintPatch(string constraintId, Json patch)
        {
            const string op = "setConstraintOverride"; Json normalized = NormalizeConstraintPatch(constraintId, patch, op, out int index);
            return Configure(op, configure: h => h.Constraints[index] = normalized);
        }
        private Json NormalizeConstraintPatch(string constraintId, Json patch, string op, out int index)
        {
            index = -1;
            for (int i = 0; i < data.Constraints.Length; i++) if (data.Constraints[i].S("id") == constraintId) { index = i; break; }
            if (index < 0) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Constraint is missing.", entityId: constraintId);
            Json setup = data.Constraints[index]; if (patch.S("type") != setup.S("type")) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Constraint type does not match.", "type", constraintId);
            string allowed;
            switch (setup.S("type"))
            {
                case "ik": allowed = "target mix bendPositive compress stretch softness"; break;
                case "transform": allowed = "rotationDegrees x y scaleX scaleY shearYDegrees mixRotate mixX mixY mixScaleX mixScaleY mixShearY"; break;
                case "path": allowed = "rotationDegrees position spacing mixRotate mixX mixY"; break;
                case "physics": allowed = "x y rotate scaleX shearX limit fps inertia strength damping mass wind gravity mix"; break;
                case "slider": allowed = "sourceOffset timeOffset timeScale rangeMax time mix"; break;
                default: throw new RuntimeException(RuntimeErrorCode.UnsupportedFeature, op, "Unknown constraint family.");
            }
            var normalized = new Json(new Dictionary<string, Json>(StringComparer.Ordinal));
            foreach (var pair in patch.Members)
            {
                if (pair.Key == "type" || pair.Value.IsNull) continue;
                if (Array.IndexOf(allowed.Split(' '), pair.Key) < 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Unknown constraint parameter.", pair.Key, constraintId);
                string key = pair.Key == "rotationDegrees" ? "rotation" : pair.Key == "shearYDegrees" ? "shearY" : pair.Key;
                normalized.Members[key] = Pose.Clone(pair.Value);
            }
            if (setup.S("type") == "ik" && normalized.Has("target")) normalized.Members["targetBoneId"] = Json.Null;
            Json merged = Pose.Clone(setup); foreach (var p in normalized.Members) merged.Members[p.Key] = p.Value;
            try { Validation.Constraint(merged, data); } catch (RuntimeException e) { throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, e.Message, e.Field, constraintId); }
            return normalized;
        }
        public RuntimeFrame ClearConstraintOverride(string constraintId)
        {
            int index = -1; for (int i = 0; i < data.Constraints.Length; i++) if (data.Constraints[i].S("id") == constraintId) { index = i; break; }
            if (index < 0) throw new RuntimeException(RuntimeErrorCode.NotFound, "clearConstraintOverride", "Constraint is missing.", entityId: constraintId);
            return Configure("clearConstraintOverride", configure: h => h.Constraints.Remove(index));
        }
    }
}
