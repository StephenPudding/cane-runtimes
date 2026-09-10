using Cane.Constraints;
using Cane.Format;
using Cane.Geometry;

namespace Cane
{
    public sealed class TransformConstraintOffsets
    {
        public string ConstraintId { get; }
        public float RotationDegrees { get; }
        public float X { get; }
        public float Y { get; }
        public float ScaleX { get; }
        public float ScaleY { get; }
        public float ShearYDegrees { get; }
        internal TransformConstraintOffsets(string id, float rotation, float x, float y, float scaleX, float scaleY, float shearY)
        {
            const string op = "queryMatchedTransformConstraintOffsets";
            float Check(float value, string field)
            { if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Matched offset is non-finite.", field, id); return value; }
            ConstraintId = id; RotationDegrees = Check(rotation, "rotationDegrees"); X = Check(x, "x"); Y = Check(y, "y");
            ScaleX = Check(scaleX, "scaleX"); ScaleY = Check(scaleY, "scaleY"); ShearYDegrees = Check(shearY, "shearYDegrees");
        }
        public ConstraintOverride ToOverride() => new ConstraintOverride("transform").Set("rotationDegrees", RotationDegrees).Set("x", X).Set("y", Y)
            .Set("scaleX", ScaleX).Set("scaleY", ScaleY).Set("shearYDegrees", ShearYDegrees);
    }
    public sealed class PathConstraintPosition
    {
        public string ConstraintId { get; }
        public Point Point { get; }
        public float TangentDegrees { get; }
        public float Distance { get; }
        public float PathLength { get; }
        public Point PathStart { get; }
        public Point PathEnd { get; }
        public bool Closed { get; }
        internal PathConstraintPosition(string id, PathSampler.Sample sample, float distance, float length, Point start, Point end, bool closed)
        {
            const string op = "queryPathConstraintPosition";
            if (!Numeric.Finite(sample.Position.X) || !Numeric.Finite(sample.Position.Y) || !Numeric.Finite(sample.Tangent)
                || !Numeric.Finite(distance) || !Numeric.Finite(length) || !Numeric.Finite(start.X) || !Numeric.Finite(start.Y) || !Numeric.Finite(end.X) || !Numeric.Finite(end.Y))
                throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Path projection is non-finite.", entityId: id);
            ConstraintId = id; Point = sample.Position; TangentDegrees = sample.Tangent; Distance = distance;
            PathLength = length; PathStart = start; PathEnd = end; Closed = closed;
        }
    }
    public sealed partial class RuntimePlayer
    {
        public TransformConstraintOffsets QueryMatchedTransformConstraintOffsets(string constraintId)
            => Transform.Match(publishedPose, SampledConstraint(constraintId, "queryMatchedTransformConstraintOffsets", "transform"));
        private PathSampler ConstraintPath(Json constraint, string operation)
        {
            string id = constraint.S("id");
            int attachment = publishedPose.Slots[data.SlotIndex[constraint.S("targetSlotId")]].ResolvedAttachment;
            if (attachment < 0 || data.AttachmentData[attachment].Kind != "path")
                throw new RuntimeException(RuntimeErrorCode.InvalidState, operation, "The target slot has no active Path attachment.", "targetSlotId", id);
            AttachmentData a = data.AttachmentData[attachment]; PathSampler path;
            try { path = new PathSampler(Rendering.WorldVertices(publishedPose, a), a.Raw); }
            catch (RuntimeException e) { throw Reframe(e, operation); }
            if (!Numeric.Finite(path.Length)) throw new RuntimeException(RuntimeErrorCode.NonFinite, operation, "Path length is non-finite.", "pathLength", id);
            if (path.Length <= 0) throw new RuntimeException(RuntimeErrorCode.InvalidState, operation, "Path has no positive length.", "pathLength", id);
            return path;
        }
        public PathConstraintPosition QueryPathConstraintPosition(string constraintId)
        {
            const string op = "queryPathConstraintPosition"; Json constraint = SampledConstraint(constraintId, op, "path");
            PathSampler path = ConstraintPath(constraint, op);
            float distance = constraint.F("position") * (constraint.S("positionMode") == "percent" ? path.Length : 1);
            if (!Numeric.Finite(distance)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Path distance is non-finite.", "position", constraintId);
            PathSampler.Sample? sample = path.At(distance), start = path.At(0), end = path.At(path.Length);
            if (!sample.HasValue || !start.HasValue || !end.HasValue)
                throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Path has no sample at the requested distance.", "position", constraintId);
            return new PathConstraintPosition(constraintId, sample.Value, distance, path.Length, start.Value.Position, end.Value.Position, path.Closed);
        }
        public float QueryPathConstraintPositionForWorldTarget(string constraintId, Point targetWorld)
        {
            const string op = "queryPathConstraintPositionForWorldTarget"; Json constraint = SampledConstraint(constraintId, op, "path");
            if (!Numeric.Finite(targetWorld.X) || !Numeric.Finite(targetWorld.Y))
                throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Path world target must be finite.", "targetWorld", constraintId);
            PathSampler path = ConstraintPath(constraint, op); float? distance = path.ProjectDistance(targetWorld);
            if (!distance.HasValue) throw new RuntimeException(RuntimeErrorCode.InvalidState, op, "Path has no finite projection candidate.", entityId: constraintId);
            float position = distance.Value / (constraint.S("positionMode") == "percent" ? path.Length : 1);
            if (!Numeric.Finite(position)) throw new RuntimeException(RuntimeErrorCode.NonFinite, op, "Projected Path position is non-finite.", "position", constraintId);
            return position;
        }
    }
}
