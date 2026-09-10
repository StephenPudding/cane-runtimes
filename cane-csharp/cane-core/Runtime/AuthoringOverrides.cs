using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;
using Cane.Geometry;

namespace Cane
{
    /// <summary>Ordered persistent preview edits. Builders and input buffers are copied before installation.</summary>
    public sealed class RuntimeAuthoringOverrides
    {
        internal readonly List<AuthoringEdit> Edits = new List<AuthoringEdit>();
        public int Count => Edits.Count;
        public void Clear() => Edits.Clear();
        public RuntimeAuthoringOverrides SetBoneLocal(string boneId, BoneLocal local) => Add(new AuthoringEdit(AuthoringKind.Bone, boneId) { Local = local });
        public RuntimeAuthoringOverrides ClearBoneLocal(string boneId) => Add(new AuthoringEdit(AuthoringKind.Bone, boneId, true));
        public RuntimeAuthoringOverrides SetRegionPose(string attachmentId, RegionLocal local) => Add(new AuthoringEdit(AuthoringKind.Region, attachmentId) { Local = local.ToBoneLocal() });
        public RuntimeAuthoringOverrides ClearRegionPose(string attachmentId) => Add(new AuthoringEdit(AuthoringKind.Region, attachmentId, true));
        public RuntimeAuthoringOverrides SetDrawOrder(IReadOnlyList<string> slotIds) => Add(new AuthoringEdit(AuthoringKind.Order, "") { Ids = Copy(slotIds, "slotIds") });
        public RuntimeAuthoringOverrides ClearDrawOrder() => Add(new AuthoringEdit(AuthoringKind.Order, "", true));
        public RuntimeAuthoringOverrides SetVertexDeform(string attachmentId, VertexDeformSpace space, IReadOnlyList<float> values)
            => Add(new AuthoringEdit(AuthoringKind.Deform, attachmentId) { Space = space, Values = Copy(values, "values") });
        public RuntimeAuthoringOverrides ClearVertexDeform(string attachmentId) => Add(new AuthoringEdit(AuthoringKind.Deform, attachmentId, true));
        public RuntimeAuthoringOverrides SetSlotAttachment(string slotId, string? attachmentId) => Add(new AuthoringEdit(AuthoringKind.Attachment, slotId) { AttachmentId = attachmentId });
        public RuntimeAuthoringOverrides ClearSlotAttachment(string slotId) => Add(new AuthoringEdit(AuthoringKind.Attachment, slotId, true));
        public RuntimeAuthoringOverrides SetSlotTint(string slotId, FinalTint tint) => Add(new AuthoringEdit(AuthoringKind.Tint, slotId) { Tint = tint });
        public RuntimeAuthoringOverrides ClearSlotTint(string slotId) => Add(new AuthoringEdit(AuthoringKind.Tint, slotId, true));
        public RuntimeAuthoringOverrides SetConstraint(string constraintId, ConstraintOverride parameters)
        {
            if (parameters == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setAuthoringOverrides", "Constraint parameters are required.", "parameters", constraintId);
            return Add(new AuthoringEdit(AuthoringKind.Constraint, constraintId) { Parameters = Pose.Clone(parameters.Patch) });
        }
        public RuntimeAuthoringOverrides ClearConstraint(string constraintId) => Add(new AuthoringEdit(AuthoringKind.Constraint, constraintId, true));
        private RuntimeAuthoringOverrides Add(AuthoringEdit edit) { Edits.Add(edit); return this; }
        private static T[] Copy<T>(IReadOnlyList<T> values, string field)
        {
            if (values == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setAuthoringOverrides", "A complete buffer is required.", field);
            var result = new T[values.Count]; for (int i = 0; i < result.Length; i++) result[i] = values[i]; return result;
        }
    }

    internal enum AuthoringKind { Bone, Region, Order, Deform, Attachment, Tint, Constraint }
    internal sealed class AuthoringEdit
    {
        internal readonly AuthoringKind Kind;
        internal readonly string Id;
        internal readonly bool Clear;
        internal BoneLocal Local;
        internal VertexDeformSpace Space;
        internal string[] Ids = Array.Empty<string>();
        internal float[] Values = Array.Empty<float>();
        internal string? AttachmentId;
        internal FinalTint Tint;
        internal Json? Parameters;
        internal AuthoringEdit(AuthoringKind kind, string id, bool clear = false) { Kind = kind; Id = id; Clear = clear; }
    }

    public sealed partial class RuntimePlayer
    {
        public RuntimeFrame SetAuthoringOverrides(RuntimeAuthoringOverrides request) => SetAuthoringBatch(request, default, "setAuthoringOverrides");
        public RuntimeFrame SetAuthoringOverridesWithSampling(RuntimeAuthoringOverrides request, SamplingOptions sampling)
            => SetAuthoringBatch(request, sampling, "setAuthoringOverridesWithSampling");
        private RuntimeFrame SetAuthoringBatch(RuntimeAuthoringOverrides request, SamplingOptions sampling, string operation)
        {
            RequireIdle(operation); sampling.Validate(operation);
            if (request == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "An override batch is required.", "request");
            // Edits contain copied buffers. Validation and all modifications target the candidate HostState.
            AuthoringEdit[] edits = request.Edits.ToArray();
            return Configure(operation, configure: h => { foreach (AuthoringEdit edit in edits) StageAuthoring(h, edit, operation); }, sampling: sampling);
        }
        private void StageAuthoring(HostState configuration, AuthoringEdit edit, string operation)
        {
            int index;
            switch (edit.Kind)
            {
                case AuthoringKind.Bone:
                    index = Id(data.BoneIndex, edit.Id, operation, "boneId");
                    if (edit.Clear) configuration.Bones.Remove(index);
                    else { ValidateLocal(edit.Local, operation); configuration.Bones[index] = edit.Local; }
                    break;
                case AuthoringKind.Region:
                    index = Id(data.AttachmentIndex, edit.Id, operation, "attachmentId");
                    if (data.AttachmentData[index].Kind != "region") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Attachment is not a Region.", "attachmentId", edit.Id);
                    if (edit.Clear) configuration.Regions.Remove(index);
                    else { ValidateLocal(edit.Local, operation); configuration.Regions[index] = edit.Local; }
                    break;
                case AuthoringKind.Order:
                    if (edit.Clear) configuration.Order = null;
                    else
                    {
                        if (edit.Ids.Length != data.SlotData.Length) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Draw order must contain every slot exactly once.", "slotIds");
                        var order = new int[edit.Ids.Length]; var seen = new bool[order.Length];
                        for (int i = 0; i < order.Length; i++)
                        {
                            index = Id(data.SlotIndex, edit.Ids[i], operation, "slotIds");
                            if (seen[index]) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Draw order contains a duplicate slot.", "slotIds", edit.Ids[i]);
                            seen[index] = true; order[i] = index;
                        }
                        configuration.Order = order;
                    }
                    break;
                case AuthoringKind.Deform:
                    AttachmentData attachment = VertexAttachment(edit.Id, operation);
                    if (edit.Clear) configuration.Deforms.Remove(attachment.DeformSourceId);
                    else
                    {
                        float[] values = DeformValues(attachment, edit.Space, edit.Values, operation, "values");
                        if (edit.Space == VertexDeformSpace.VertexPositions && attachment.GeometrySource.Raw["weights"].ArrayOrEmpty.Count != 0)
                            values = Deformation.PositionsToOffsets(attachment.GeometrySource, values, operation);
                        configuration.Deforms[attachment.DeformSourceId] = values;
                    }
                    break;
                case AuthoringKind.Attachment:
                    index = Id(data.SlotIndex, edit.Id, operation, "slotId");
                    if (edit.Clear) configuration.Attachments.Remove(index);
                    else
                    {
                        if (edit.AttachmentId != null && (!data.AttachmentIndex.TryGetValue(edit.AttachmentId, out int ai) || data.AttachmentData[ai].Slot != index))
                            throw new RuntimeException(RuntimeErrorCode.NotFound, operation, "Attachment is missing from this slot.", "attachmentId", edit.AttachmentId);
                        configuration.Attachments[index] = edit.AttachmentId;
                    }
                    break;
                case AuthoringKind.Tint:
                    index = Id(data.SlotIndex, edit.Id, operation, "slotId");
                    if (edit.Clear) configuration.Tints.Remove(index);
                    else { Unit(edit.Tint.Alpha, operation, "alpha"); configuration.Tints[index] = edit.Tint; }
                    break;
                case AuthoringKind.Constraint:
                    if (edit.Clear)
                    {
                        index = Array.FindIndex(data.Constraints, c => c.S("id") == edit.Id);
                        if (index < 0) throw new RuntimeException(RuntimeErrorCode.NotFound, operation, "Constraint is missing.", "constraintId", edit.Id);
                        configuration.Constraints.Remove(index);
                    }
                    else
                    {
                        Json patch = NormalizeConstraintPatch(edit.Id, edit.Parameters!, operation, out index);
                        configuration.Constraints[index] = patch;
                    }
                    break;
            }
        }
        private static void ValidateLocal(BoneLocal local, string operation)
        { for (int i = 0; i < 7; i++) Numeric.RequireFinite(local.Get(i), operation, "local"); }
    }
}
