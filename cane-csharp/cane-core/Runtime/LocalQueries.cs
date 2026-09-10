using System;

namespace Cane
{
    public sealed class BoneLocalState
    {
        public string BoneId { get; }
        public BoneLocal Local { get; }
        public string TransformMode { get; }
        internal BoneLocalState(string id, BoneLocal local, string mode) { BoneId = id; Local = local; TransformMode = mode; }
    }
    public readonly struct RegionLocal
    {
        public readonly float X, Y, RotationDegrees, ScaleX, ScaleY;
        public RegionLocal(float x, float y, float rotationDegrees = 0, float scaleX = 1, float scaleY = 1)
        { X = x; Y = y; RotationDegrees = rotationDegrees; ScaleX = scaleX; ScaleY = scaleY; }
        public static RegionLocal Identity => new RegionLocal(0, 0);
        internal BoneLocal ToBoneLocal() => new BoneLocal(X, Y, RotationDegrees, ScaleX, ScaleY);
    }
    public sealed partial class RuntimePlayer
    {
        public BoneLocal QueryRootTransform() => host.RootLocal;
        public BoneLocal QueryBoneLocal(string boneId) => publishedPose.Locals[Id(data.BoneIndex, boneId, "queryBoneLocal", "boneId")];
        public string QueryBoneTransformMode(string boneId) => publishedPose.Modes[Id(data.BoneIndex, boneId, "queryBoneTransformMode", "boneId")];
        public BoneLocalState QueryBoneLocalState(string boneId)
        { int index = Id(data.BoneIndex, boneId, "queryBoneLocalState", "boneId"); return new BoneLocalState(boneId, publishedPose.Locals[index], publishedPose.Modes[index]); }
        public RegionLocal QueryRegionAttachmentPose(string attachmentId)
        {
            const string op = "queryRegionAttachmentPose"; int index = Id(data.AttachmentIndex, attachmentId, op, "attachmentId");
            if (data.AttachmentData[index].Kind != "region") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Attachment is not a Region.", "attachmentId", attachmentId);
            BoneLocal local = publishedPose.Regions[index]; return new RegionLocal(local.X, local.Y, local.RotationDegrees, local.ScaleX, local.ScaleY);
        }
        public int QuerySequenceIndex(string attachmentId)
        {
            const string op = "querySequenceIndex"; int index = Id(data.AttachmentIndex, attachmentId, op, "attachmentId");
            var sequence = data.AttachmentData[index].Raw["sequence"];
            if (sequence.IsNull) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Attachment has no image sequence.", "attachmentId", attachmentId);
            int value = publishedPose.SequenceIndices[index];
            if (value < 0 || value >= sequence["imageIds"].Items.Count) throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Sampled sequence index is outside its images.", "sequenceIndex", attachmentId);
            return value;
        }
    }
}
