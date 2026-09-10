using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;
using Cane.Geometry;

namespace Cane
{
    public enum VertexDeformSpace { VertexPositions, WeightedInfluenceOffsets }

    public sealed class VertexAttachmentSourceGeometry
    {
        public string AttachmentId { get; }
        public string SourceAttachmentId { get; }
        public string DeformAttachmentId { get; }
        public string Kind { get; }
        public IReadOnlyList<float> SetupVerticesXy { get; }
        public IReadOnlyList<float> SetupWorldVerticesXy { get; }
        public IReadOnlyList<float> SampledVerticesXy { get; }
        public IReadOnlyList<float> WorldVerticesXy { get; }
        public VertexDeformSpace DeformSpace { get; }
        public IReadOnlyList<float> DeformValues { get; }
        public bool FullyWeighted { get; }
        internal VertexAttachmentSourceGeometry(AttachmentData attachment, float[] setupWorld, float[] sampled, float[] world, VertexDeformSpace space, float[] values, bool weighted)
        {
            AttachmentId = attachment.Id; SourceAttachmentId = attachment.GeometrySource.Id; DeformAttachmentId = attachment.DeformSourceId;
            Kind = attachment.Kind == "boundingbox" ? "boundingBox" : attachment.Kind;
            SetupVerticesXy = Array.AsReadOnly((float[])attachment.GeometrySource.Vertices.Clone());
            SetupWorldVerticesXy = Array.AsReadOnly(setupWorld); SampledVerticesXy = Array.AsReadOnly(sampled); WorldVerticesXy = Array.AsReadOnly(world);
            DeformSpace = space; DeformValues = Array.AsReadOnly(values); FullyWeighted = weighted;
        }
    }

    public sealed class VertexDeform
    {
        public string AttachmentId { get; }
        public string DeformAttachmentId { get; }
        public VertexDeformSpace Space { get; }
        public IReadOnlyList<float> Values { get; }
        internal VertexDeform(AttachmentData attachment, VertexDeformSpace space, float[] values)
        { AttachmentId = attachment.Id; DeformAttachmentId = attachment.DeformSourceId; Space = space; Values = Array.AsReadOnly(values); }
    }

    public sealed partial class RuntimePlayer
    {
        public VertexAttachmentSourceGeometry QueryVertexAttachmentSourceGeometry(string attachmentId, VertexDeformSpace deformSpace = VertexDeformSpace.VertexPositions)
        {
            const string op = "queryVertexAttachmentSourceGeometry";
            try
            {
                AttachmentData attachment = VertexAttachment(attachmentId, op); ValidateSpace(deformSpace, op, "deformSpace");
                AttachmentData source = attachment.GeometrySource; bool weighted = source.Raw["weights"].ArrayOrEmpty.Count != 0;
                float[] values = CurrentDeform(attachment, deformSpace, op);
                publishedPose.Deforms.TryGetValue(attachment.DeformSourceId, out float[]? current);
                float[] sampled = weighted
                    ? Deformation.OffsetsToPositions(source, current ?? new float[Deformation.OffsetCount(source, op)], op)
                    : (float[])(current ?? source.Vertices).Clone();
                return new VertexAttachmentSourceGeometry(attachment, Rendering.WorldVertices(publishedPose, attachment, null), sampled,
                    Rendering.WorldVertices(publishedPose, attachment), deformSpace, values, weighted);
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }

        /// <summary>Returns a complete owned patch. Null currentDeform uses the published pose; a supplied buffer is a complete explicit deform.</summary>
        public VertexDeform VertexAttachmentDeformForWorldTarget(string attachmentId, int sourceVertexIndex, Point targetWorld,
            VertexDeformSpace space = VertexDeformSpace.VertexPositions, IReadOnlyList<float>? currentDeform = null)
        {
            const string op = "vertexAttachmentDeformForWorldTarget";
            try
            {
                AttachmentData attachment = VertexAttachment(attachmentId, op); SourceIndex(attachment, sourceVertexIndex, op);
                Deformation.Check(targetWorld, attachment, op, "targetWorld"); ValidateSpace(space, op, "currentDeform.space");
                float[] values = currentDeform == null ? CurrentDeform(attachment, space, op)
                    : DeformValues(attachment, space, currentDeform, op, "currentDeform.values");
                if (space == VertexDeformSpace.VertexPositions)
                {
                    Point point = Deformation.PositionForWorldTarget(publishedPose, attachment, sourceVertexIndex, targetWorld, op);
                    values[sourceVertexIndex * 2] = point.X; values[sourceVertexIndex * 2 + 1] = point.Y;
                }
                else
                {
                    float[] world = Rendering.WorldVertices(publishedPose, attachment, values);
                    Deformation.WriteOffsetsForWorldTarget(publishedPose, attachment, sourceVertexIndex, targetWorld, values, world, op);
                }
                return new VertexDeform(attachment, space, values);
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }

        public IReadOnlyList<Point> VertexAttachmentWeightLocalPositionsForWorldTarget(string attachmentId, int sourceVertexIndex, Point targetWorld)
        {
            const string op = "vertexAttachmentWeightLocalPositionsForWorldTarget";
            AttachmentData attachment = VertexAttachment(attachmentId, op); SourceIndex(attachment, sourceVertexIndex, op);
            Deformation.Check(targetWorld, attachment, op, "targetWorld"); var weights = attachment.GeometrySource.Raw["weights"].ArrayOrEmpty;
            if (weights.Count <= sourceVertexIndex || weights[sourceVertexIndex].Items.Count == 0)
                throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Source vertex has no weight influences.", "sourceVertexIndex", attachmentId);
            var influences = weights[sourceVertexIndex].Items; var values = new Point[influences.Count];
            for (int i = 0; i < values.Length; i++)
            {
                Affine matrix = publishedPose.World[data.BoneIndex[influences[i].S("boneId")]];
                values[i] = Deformation.InverseDelta(matrix, new Point(targetWorld.X - matrix.Tx, targetWorld.Y - matrix.Ty), attachment, op, "targetWorld");
            }
            return Array.AsReadOnly(values);
        }

        public IReadOnlyList<float> VertexAttachmentWeightedDeformOffsetsAfterPositionEdit(string attachmentId, IReadOnlyList<float> currentWeightedOffsets,
            IReadOnlyList<float> beforePositions, IReadOnlyList<float> afterPositions)
        {
            const string op = "vertexAttachmentWeightedDeformOffsetsAfterPositionEdit";
            AttachmentData attachment = VertexAttachment(attachmentId, op);
            float[] current = DeformValues(attachment, VertexDeformSpace.WeightedInfluenceOffsets, currentWeightedOffsets, op, "currentWeightedOffsets");
            float[] before = DeformValues(attachment, VertexDeformSpace.VertexPositions, beforePositions, op, "beforePositions");
            float[] after = DeformValues(attachment, VertexDeformSpace.VertexPositions, afterPositions, op, "afterPositions");
            return Array.AsReadOnly(Deformation.OffsetsAfterPositionEdit(attachment.GeometrySource, current, before, after, op));
        }

        public IReadOnlyList<float> TranslateWeightedMeshDeform(string attachmentId, VertexDeformSpace space, Point worldDelta)
        {
            const string op = "translateWeightedMeshDeform";
            try
            {
                AttachmentData attachment = VertexAttachment(attachmentId, op);
                if (attachment.Kind != "mesh" || attachment.GeometrySource.Raw["weights"].ArrayOrEmpty.Count == 0)
                    throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Attachment must be a fully weighted Mesh.", "attachmentId", attachmentId);
                ValidateSpace(space, op, "space"); Deformation.Check(worldDelta, attachment, op, "worldDelta");
                float[] values = CurrentDeform(attachment, space, op), currentWorld = Rendering.WorldVertices(publishedPose, attachment);
                float[] setupWorld = space == VertexDeformSpace.VertexPositions ? Rendering.WorldVertices(publishedPose, attachment, null) : Array.Empty<float>();
                int cursor = 0;
                for (int i = 0; i < currentWorld.Length / 2; i++)
                {
                    Point target = new Point(currentWorld[i * 2] + worldDelta.X, currentWorld[i * 2 + 1] + worldDelta.Y);
                    Deformation.Check(target, attachment, op, "worldDelta");
                    if (space == VertexDeformSpace.VertexPositions)
                    {
                        Point point = Deformation.PositionForWorldTarget(publishedPose, attachment, i, target, setupWorld, op);
                        values[i * 2] = point.X; values[i * 2 + 1] = point.Y;
                    }
                    else
                    {
                        Deformation.WriteOffsetsForWorldTarget(publishedPose, attachment, i, target, values, currentWorld, op, cursor);
                        cursor += attachment.GeometrySource.Raw["weights"][i].Items.Count * 2;
                    }
                }
                return Array.AsReadOnly(values);
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }

        private AttachmentData VertexAttachment(string id, string operation)
        {
            AttachmentData attachment = data.AttachmentData[Id(data.AttachmentIndex, id, operation, "attachmentId")];
            if (attachment.Kind == "region" || attachment.Kind == "point")
                throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Attachment has no source vertices.", "attachmentId", id);
            return attachment;
        }
        private static void SourceIndex(AttachmentData attachment, int index, string operation)
        { if (index < 0 || index >= attachment.GeometrySource.Vertices.Length / 2) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Source vertex index is outside the attachment.", "sourceVertexIndex", attachment.Id); }
        private static void ValidateSpace(VertexDeformSpace space, string operation, string field)
        { if (space != VertexDeformSpace.VertexPositions && space != VertexDeformSpace.WeightedInfluenceOffsets) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Unknown deform space.", field); }
        private static float[] DeformValues(AttachmentData attachment, VertexDeformSpace space, IReadOnlyList<float> values, string operation, string field)
        {
            ValidateSpace(space, operation, "space"); AttachmentData source = attachment.GeometrySource;
            int count = source.Vertices.Length;
            if (space == VertexDeformSpace.WeightedInfluenceOffsets)
            {
                if (source.Raw["weights"].ArrayOrEmpty.Count == 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Unweighted geometry has no influence offsets.", "space", attachment.Id);
                count = Deformation.OffsetCount(source, operation);
            }
            if (values == null || values.Count != count) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Deform buffer must match the complete source geometry.", field, attachment.Id);
            var result = new float[count];
            for (int i = 0; i < count; i++)
            { float value = values[i]; if (!Numeric.Finite(value)) throw new RuntimeException(RuntimeErrorCode.NonFinite, operation, "Deform buffer must be finite.", field, attachment.Id); result[i] = value; }
            return result;
        }
        private float[] CurrentDeform(AttachmentData attachment, VertexDeformSpace space, string operation)
        {
            AttachmentData source = attachment.GeometrySource; bool weighted = source.Raw["weights"].ArrayOrEmpty.Count != 0;
            if (!weighted && space == VertexDeformSpace.WeightedInfluenceOffsets)
                throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Unweighted geometry has no influence offsets.", "space", attachment.Id);
            publishedPose.Deforms.TryGetValue(attachment.DeformSourceId, out float[]? current);
            if (!weighted) return (float[])(current ?? source.Vertices).Clone();
            float[] offsets = current ?? new float[Deformation.OffsetCount(source, operation)];
            return space == VertexDeformSpace.VertexPositions ? Deformation.OffsetsToPositions(source, offsets, operation) : (float[])offsets.Clone();
        }
    }
}
