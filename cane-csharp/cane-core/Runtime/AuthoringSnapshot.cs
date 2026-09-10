using System;
using System.Collections.Generic;

namespace Cane
{
    public sealed class RuntimeAuthoringSnapshot
    {
        public RuntimeFrame Frame { get; }
        public IReadOnlyList<BoneLocalState> BoneLocalStates { get; }
        public IReadOnlyList<SlotState> SlotStates { get; }
        public IReadOnlyList<ConstraintState> ConstraintStates { get; }
        public IReadOnlyList<PointAttachmentPose> PointAttachmentPoses { get; }
        public IReadOnlyList<AttachmentGeometry> AttachmentGeometries { get; }
        public IReadOnlyList<VertexAttachmentSourceGeometry> VertexAttachmentSourceGeometries { get; }
        public IReadOnlyList<PathConstraintPosition> PathConstraintPositions { get; }
        internal RuntimeAuthoringSnapshot(RuntimeFrame frame, BoneLocalState[] bones, SlotState[] slots, ConstraintState[] constraints,
            PointAttachmentPose[] points, AttachmentGeometry[] geometry, VertexAttachmentSourceGeometry[] vertices, PathConstraintPosition[] paths)
        {
            Frame = frame; BoneLocalStates = Array.AsReadOnly(bones); SlotStates = Array.AsReadOnly(slots); ConstraintStates = Array.AsReadOnly(constraints);
            PointAttachmentPoses = Array.AsReadOnly(points); AttachmentGeometries = Array.AsReadOnly(geometry);
            VertexAttachmentSourceGeometries = Array.AsReadOnly(vertices); PathConstraintPositions = Array.AsReadOnly(paths);
        }
    }
    public sealed partial class RuntimePlayer
    {
        public RuntimeAuthoringSnapshot QueryAuthoringSnapshot()
        {
            try { return CaptureAuthoringSnapshot(); }
            catch (RuntimeException e) { throw Reframe(e, "queryAuthoringSnapshot"); }
        }
        private RuntimeAuthoringSnapshot CaptureAuthoringSnapshot()
        {
            var bones = new BoneLocalState[data.BoneData.Length]; for (int i = 0; i < bones.Length; i++) bones[i] = QueryBoneLocalState(data.BoneData[i].Id);
            var slots = new SlotState[data.SlotData.Length]; for (int i = 0; i < slots.Length; i++) slots[i] = QuerySlotState(data.SlotData[i].Id);
            var constraints = new ConstraintState[data.Constraints.Length];
            var points = new List<PointAttachmentPose>(); var geometry = new List<AttachmentGeometry>();
            var vertices = new List<VertexAttachmentSourceGeometry>(); var paths = new List<PathConstraintPosition>();
            for (int i = 0; i < constraints.Length; i++)
            {
                string id = data.Constraints[i].S("id"); constraints[i] = QueryConstraintState(id);
                if (constraints[i].Kind != "path") continue;
                try { paths.Add(QueryPathConstraintPosition(id)); }
                catch (RuntimeException e) when (e.Code == RuntimeErrorCode.InvalidState) { /* Unresolved Path positions are explicitly optional. */ }
            }
            foreach (AttachmentData attachment in data.AttachmentData)
            {
                string id = attachment.Id, kind = attachment.Kind;
                if (kind == "point") points.Add(QueryPointAttachmentPose(id));
                if (kind == "path" || kind == "boundingbox" || kind == "clipping") geometry.Add(QueryAttachmentGeometry(id));
                if (kind == "mesh" || kind == "path" || kind == "boundingbox" || kind == "clipping") vertices.Add(QueryVertexAttachmentSourceGeometry(id));
            }
            return new RuntimeAuthoringSnapshot(Frame, bones, slots, constraints, points.ToArray(), geometry.ToArray(), vertices.ToArray(), paths.ToArray());
        }
    }
}
