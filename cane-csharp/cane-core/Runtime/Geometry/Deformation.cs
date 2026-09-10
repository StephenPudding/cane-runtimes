using System;
using Cane.Animation;
using Cane.Format;

namespace Cane.Geometry
{
    // Shared by animation sampling, authoring overrides, and inverse queries. Inputs are
    // source-order geometry; clipped render vertices never enter this conversion.
    internal static class Deformation
    {
        internal static int OffsetCount(AttachmentData source, string operation)
        {
            var weights = source.Raw["weights"].ArrayOrEmpty;
            if (weights.Count == 0 || weights.Count * 2 != source.Vertices.Length)
                throw Invalid(source, operation, "Attachment is not fully weighted.");
            long count = 0;
            foreach (Json row in weights)
            {
                if (row.Items.Count == 0) throw Invalid(source, operation, "Source vertex has no influences.");
                count += (long)row.Items.Count * 2;
                if (count > int.MaxValue) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, operation, "Weighted offset count overflowed.", "values", source.Id);
            }
            return (int)count;
        }

        internal static float[] PositionsToOffsets(AttachmentData source, float[] positions, string operation)
        {
            var result = new float[OffsetCount(source, operation)]; int cursor = 0;
            if (positions.Length != source.Vertices.Length) throw Invalid(source, operation, "Logical position count differs from source geometry.");
            var weights = source.Raw["weights"].Items;
            for (int i = 0; i < weights.Count; i++)
            {
                Point delta = new Point(positions[i * 2] - source.Vertices[i * 2], positions[i * 2 + 1] - source.Vertices[i * 2 + 1]);
                foreach (Json influence in weights[i].Items)
                {
                    Point offset = InfluenceDelta(source, influence, delta); Check(offset, source, operation, "values");
                    result[cursor++] = offset.X; result[cursor++] = offset.Y;
                }
            }
            return result;
        }

        internal static float[] OffsetsToPositions(AttachmentData source, float[] offsets, string operation)
        {
            if (offsets.Length != OffsetCount(source, operation)) throw Invalid(source, operation, "Weighted offset count differs from source geometry.");
            var result = new float[source.Vertices.Length]; int cursor = 0; var weights = source.Raw["weights"].Items;
            for (int i = 0; i < weights.Count; i++)
            {
                float x = 0, y = 0, total = 0;
                foreach (Json influence in weights[i].Items)
                {
                    Point delta = new Point(offsets[cursor++], offsets[cursor++]); Check(delta, source, operation, "values");
                    float weight = influence.F("weight"); if (weight <= 0) continue;
                    if (influence["x"].IsNull) delta = InverseDelta(Sampling.ReadAffine(source.Raw["bindInverses"][influence.S("boneId")]), delta, source, operation, "values");
                    x += delta.X * weight; y += delta.Y * weight; total += weight;
                }
                if (total <= 0 || !Numeric.Finite(total)) throw Invalid(source, operation, "Weighted position cannot be resolved.");
                Point value = new Point(source.Vertices[i * 2] + x / total, source.Vertices[i * 2 + 1] + y / total);
                Check(value, source, operation, "values"); result[i * 2] = value.X; result[i * 2 + 1] = value.Y;
            }
            return result;
        }

        internal static Point PositionForWorldTarget(Pose pose, AttachmentData attachment, int vertex, Point target, string operation)
        {
            float[] world = Rendering.WorldVertices(pose, attachment, null);
            return PositionForWorldTarget(pose, attachment, vertex, target, world, operation);
        }

        internal static Point PositionForWorldTarget(Pose pose, AttachmentData attachment, int vertex, Point target, float[] setupWorld, string operation)
        {
            AttachmentData source = attachment.GeometrySource;
            Point delta = InverseDelta(WorldLinear(pose, attachment, vertex, operation),
                new Point(target.X - setupWorld[vertex * 2], target.Y - setupWorld[vertex * 2 + 1]), attachment, operation, "targetWorld");
            Point result = new Point(source.Vertices[vertex * 2] + delta.X, source.Vertices[vertex * 2 + 1] + delta.Y);
            Check(result, attachment, operation, "targetWorld"); return result;
        }

        internal static void WriteOffsetsForWorldTarget(Pose pose, AttachmentData attachment, int vertex, Point target, float[] offsets, float[] currentWorld, string operation, int offsetStart = -1)
        {
            Point delta = InverseDelta(WorldLinear(pose, attachment, vertex, operation),
                new Point(target.X - currentWorld[vertex * 2], target.Y - currentWorld[vertex * 2 + 1]), attachment, operation, "targetWorld");
            AttachmentData source = attachment.GeometrySource; var weights = source.Raw["weights"].Items; int cursor = Math.Max(0, offsetStart);
            if (offsetStart < 0) for (int i = 0; i < vertex; i++) cursor += weights[i].Items.Count * 2;
            foreach (Json influence in weights[vertex].Items)
            {
                Point offset = InfluenceDelta(source, influence, delta);
                Point value = new Point(offsets[cursor] + offset.X, offsets[cursor + 1] + offset.Y);
                Check(value, attachment, operation, "targetWorld"); offsets[cursor++] = value.X; offsets[cursor++] = value.Y;
            }
        }

        internal static float[] OffsetsAfterPositionEdit(AttachmentData source, float[] current, float[] before, float[] after, string operation)
        {
            var result = (float[])current.Clone(); int cursor = 0; var weights = source.Raw["weights"].Items;
            for (int i = 0; i < weights.Count; i++)
            {
                Point delta = new Point(after[i * 2] - before[i * 2], after[i * 2 + 1] - before[i * 2 + 1]);
                foreach (Json influence in weights[i].Items)
                {
                    Point offset = InfluenceDelta(source, influence, delta);
                    Point value = new Point(result[cursor] + offset.X, result[cursor + 1] + offset.Y);
                    Check(value, source, operation, "afterPositions"); result[cursor++] = value.X; result[cursor++] = value.Y;
                }
            }
            return result;
        }

        internal static Point InverseDelta(Affine matrix, Point delta, AttachmentData attachment, string operation, string field)
        {
            float determinant = matrix.Determinant;
            // Geometry contract section 13: finite non-zero determinants remain invertible.
            // Direct division avoids overflowing a reciprocal when the resulting point is finite.
            if (!Numeric.Finite(determinant) || determinant == 0)
                throw new RuntimeException(RuntimeErrorCode.InvalidState, operation, "Geometry inverse is singular or invalid.", field, attachment.Id);
            Point result = new Point((matrix.D * delta.X - matrix.C * delta.Y) / determinant, (-matrix.B * delta.X + matrix.A * delta.Y) / determinant);
            Check(result, attachment, operation, field); return result;
        }

        private static Affine WorldLinear(Pose pose, AttachmentData attachment, int vertex, string operation)
        {
            AttachmentData source = attachment.GeometrySource; var weights = source.Raw["weights"].ArrayOrEmpty;
            if (weights.Count == 0) return pose.World[pose.Data.SlotData[attachment.Slot].Bone];
            float a = 0, b = 0, c = 0, d = 0, total = 0;
            foreach (Json influence in weights[vertex].Items)
            {
                float weight = influence.F("weight"); if (weight <= 0) continue;
                Affine matrix = pose.World[pose.Data.BoneIndex[influence.S("boneId")]];
                if (influence["x"].IsNull) matrix *= Sampling.ReadAffine(source.Raw["bindInverses"][influence.S("boneId")]);
                a += matrix.A * weight; b += matrix.B * weight; c += matrix.C * weight; d += matrix.D * weight; total += weight;
            }
            if (!Numeric.Finite(total) || total <= Numeric.Epsilon) throw Invalid(attachment, operation, "Geometry has no usable influences.", "targetWorld");
            return new Affine(a / total, b / total, c / total, d / total, 0, 0);
        }

        private static Point InfluenceDelta(AttachmentData source, Json influence, Point delta) => influence["x"].IsNull
            ? Sampling.ReadAffine(source.Raw["bindInverses"][influence.S("boneId")]).TransformDirection(delta.X, delta.Y) : delta;
        internal static void Check(Point point, AttachmentData attachment, string operation, string field)
        { if (!Numeric.Finite(point.X) || !Numeric.Finite(point.Y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, operation, "Geometry result is non-finite.", field, attachment.Id); }
        private static RuntimeException Invalid(AttachmentData attachment, string operation, string message, string? field = null) => new RuntimeException(RuntimeErrorCode.InvalidState, operation, message, field, attachment.Id);
    }
}
