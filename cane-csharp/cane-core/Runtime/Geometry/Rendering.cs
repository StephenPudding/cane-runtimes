using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane.Geometry
{
    internal static class Rendering
    {
        internal static float[] WorldVertices(Pose pose, AttachmentData attachment)
        {
            var result = new float[attachment.GeometrySource.Vertices.Length]; WriteWorldVertices(pose, attachment, result); return result;
        }
        internal static float[] WorldVertices(Pose pose, AttachmentData attachment, float[]? deform)
        {
            var result = new float[attachment.GeometrySource.Vertices.Length]; WriteWorldVertices(pose, attachment, result, deform); return result;
        }
        internal static void WriteWorldVertices(Pose pose, AttachmentData attachment, Span<float> world)
        {
            pose.Deforms.TryGetValue(attachment.DeformSourceId, out float[]? deform);
            WriteWorldVertices(pose, attachment, world, deform);
        }
        private static void WriteWorldVertices(Pose pose, AttachmentData attachment, Span<float> world, float[]? deform)
        {
            var source = attachment.GeometrySource; float[] setup = source.Vertices; var influences = source.Influences;
            if (world.Length != setup.Length) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "writeAttachmentGeometry", "Output length does not match attachment geometry.", "output");
            Affine slot = pose.World[pose.Data.SlotData[attachment.Slot].Bone]; int cursor = 0;
            for (int i = 0; i < setup.Length / 2; i++)
            {
                Point point;
                if (influences.Length == 0) point = slot.Transform(deform == null ? setup[i * 2] : deform[i * 2], deform == null ? setup[i * 2 + 1] : deform[i * 2 + 1]);
                else
                {
                    float x = 0, y = 0, total = 0;
                    for (int influenceIndex = source.InfluenceStarts[i]; influenceIndex < source.InfluenceStarts[i + 1]; influenceIndex++)
                    {
                        AttachmentData.Influence influence = influences[influenceIndex];
                        float dx = deform == null ? 0 : deform[cursor], dy = deform == null ? 0 : deform[cursor + 1]; cursor += 2;
                        float weight = influence.Weight; if (weight == 0) continue;
                        Point value = pose.World[influence.Bone].Transform(influence.X + dx, influence.Y + dy);
                        x += value.X * weight; y += value.Y * weight; total += weight;
                    }
                    if (total <= Numeric.Epsilon) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "apply", "Non-positive weight total.");
                    point = new Point(x / total, y / total);
                }
                if (!Numeric.Finite(point.X) || !Numeric.Finite(point.Y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Attachment geometry overflowed.", "attachments", attachment.Id);
                world[i * 2] = point.X; world[i * 2 + 1] = point.Y;
            }
        }
        internal static RenderPacket Packet(Pose pose, RenderingWorkspace workspace, RenderPacket? previous)
        {
            workspace.Begin(previous);
            try
            {
            var data = pose.Data; var draws = workspace.Draws; ClipPolygon? clip = null;
            for (int order = 0; order < pose.Order.Length; order++)
            {
                int si = pose.Order[order]; var slot = pose.Slots[si]; var setup = data.SlotData[si];
                if (slot.ResolvedAttachment >= 0 && pose.IsActive(data.BoneData[setup.Bone].Id, "boneIds"))
                {
                    var attachment = data.AttachmentData[slot.ResolvedAttachment];
                    if (attachment.Kind == "clipping") clip = Clipping.Prepare(WorldVertices(pose, attachment), attachment.Raw.B("convex"), attachment.Raw.B("inverse"), attachment.Raw["endSlotId"].StringOrNull);
                    else if (attachment.Kind == "region" || attachment.Kind == "mesh")
                    {
                        RenderAttachment? draw = Draw(pose, si, slot.ResolvedAttachment, draws.Count, pose.OrderSampled ? order : setup.ZIndex, clip, workspace);
                        if (draw != null) draws.Add(draw);
                    }
                }
                if (clip != null && clip.EndSlot == setup.Id) clip = null;
            }
            return new RenderPacket(draws.ToArray());
            }
            finally { workspace.End(); }
        }
        private static RenderAttachment? Draw(Pose pose, int si, int ai, int drawIndex, long zIndex, ClipPolygon? clip, RenderingWorkspace workspace)
        {
            var data = pose.Data; var slot = pose.Slots[si]; var slotData = data.SlotData[si]; var attachment = data.AttachmentData[ai]; var raw = attachment.Raw;
            string imageId = raw.S("imageId"); if (!raw["sequence"].IsNull) imageId = raw["sequence"]["imageIds"][pose.SequenceIndices[ai]].String;
            ImageData image = data.Images[imageId]; AtlasProjection? region = image.Atlas; var geometry = workspace.BeginDraw(); Affine sourceAffine = pose.World[slotData.Bone];
            string kind = attachment.Kind == "region" ? "regionQuad" : "meshTriangles";
            if (attachment.Kind == "region")
            {
                sourceAffine *= Affine.FromLocal(pose.Regions[ai]); float left = -image.Width / 2f, right = image.Width / 2f, top = image.Height / 2f, bottom = -image.Height / 2f;
                if (region != null && clip == null)
                {
                    left += region.SourceX; right = left + region.Width;
                    top -= region.SourceY; bottom = top - region.Height;
                }
                Point tl = sourceAffine.Transform(left, top), tr = sourceAffine.Transform(right, top), br = sourceAffine.Transform(right, bottom), bl = sourceAffine.Transform(left, bottom);
                geometry.Vertices.Add(new Vertex(tl.X, tl.Y, 0, 0)); geometry.Vertices.Add(new Vertex(tr.X, tr.Y, 1, 0));
                geometry.Vertices.Add(new Vertex(br.X, br.Y, 1, 1)); geometry.Vertices.Add(new Vertex(bl.X, bl.Y, 0, 1));
                geometry.Indices.Add(0); geometry.Indices.Add(1); geometry.Indices.Add(2); geometry.Indices.Add(0); geometry.Indices.Add(2); geometry.Indices.Add(3);
            }
            else
            {
                var source = attachment.GeometrySource; Span<float> world = workspace.World(source.Vertices.Length); WriteWorldVertices(pose, attachment, world);
                for (int i = 0; i < world.Length; i += 2) geometry.Vertices.Add(new Vertex(world[i], world[i + 1], source.Uvs[i], source.Uvs[i + 1]));
                geometry.Indices.AddRange(source.Indices);
            }
            if (clip != null) { geometry = Clipping.Apply(geometry, clip); kind = "meshTriangles"; }
            if (region != null && (attachment.Kind != "region" || clip != null))
            {
                geometry = Clipping.Trim(geometry, (float)region.SourceX / image.Width, (float)(region.SourceX + region.Width) / image.Width,
                    (float)region.SourceY / image.Height, (float)(region.SourceY + region.Height) / image.Height);
            }
            if (geometry.Indices.Count == 0) return null;
            if (geometry.Vertices.Count > 65536) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "apply", "Rendered attachment exceeds vertex budget.");
            var vertices = workspace.Positions; var uvs = workspace.Uvs; var indices = geometry.Indices; var facing = workspace.Facing;
            for (int i = 0; i < geometry.Vertices.Count; i++)
            {
                Vertex v = geometry.Vertices[i]; vertices.Add(v.X); vertices.Add(v.Y);
                Point uv = new Point(v.U, v.V);
                if (region != null)
                {
                    if (attachment.Kind == "region" && clip == null) uv = region.Corner(i);
                    else uv = region.Map(v.U, v.V);
                }
                if (!Numeric.Finite(v.X) || !Numeric.Finite(v.Y) || !Numeric.Finite(uv.X) || !Numeric.Finite(uv.Y)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Final render geometry is non-finite.");
                uvs.Add(uv.X); uvs.Add(uv.Y);
            }
            for (int i = 0; i < indices.Count; i += 3)
            {
                Vertex a = geometry.Vertices[indices[i]], b = geometry.Vertices[indices[i + 1]], c = geometry.Vertices[indices[i + 2]];
                float area = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
                if (!Numeric.Finite(area)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Final triangle area is non-finite.", "indices", attachment.Id);
                facing.Add(area < 0 ? "towardViewer" : area > 0 ? "awayFromViewer" : "edgeOn");
                if (area < 0) { int swap = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = swap; }
            }
            if (!sourceAffine.TryInverse(out Affine sourceInverse)) sourceAffine = Affine.Identity;
            else foreach (Vertex v in geometry.Vertices)
            {
                Point local = sourceInverse.Transform(v.X, v.Y);
                if (!Numeric.Finite(local.X) || !Numeric.Finite(local.Y)) { sourceAffine = Affine.Identity; break; }
            }
            var tint = new FinalTint(Rgb.Compose(slot.Light, attachment.Color), Numeric.Clamp(slot.Alpha, 0, 1) * Numeric.Clamp(attachment.Alpha, 0, 1), slot.Dark);
            workspace.Previous.TryGetValue(attachment.Id, out RenderAttachment? prior);
            return new RenderAttachment(drawIndex, zIndex, slotData.Id, attachment.Id, kind, slotData.Blend, image.Texture, tint, sourceAffine,
                RenderingWorkspace.Publish(vertices, prior?.WorldVerticesXy), RenderingWorkspace.Publish(uvs, prior?.Uvs),
                RenderingWorkspace.Publish(indices, prior?.Indices), RenderingWorkspace.Publish(facing, prior?.AuthoredTriangleFacing));
        }
    }
}
